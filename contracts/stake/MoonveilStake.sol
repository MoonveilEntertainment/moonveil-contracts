// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/PausableUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/security/ReentrancyGuardUpgradeable.sol";
import "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import "hardhat/console.sol";
import "../helper/IAavePool.sol";
import "../helper/IAaveWrappedTokenGateway.sol";

contract MoonveilStake is Initializable, AccessControlUpgradeable, PausableUpgradeable, ReentrancyGuardUpgradeable, UUPSUpgradeable {
    bytes32 public constant UPGRADE_MANAGER = keccak256("UPGRADE_MANAGER");
    bytes32 public constant CONFIG_MANAGER = keccak256("CONFIG_MANAGER");

    IAavePool public aavePool;
    IAaveWrappedTokenGateway public aaveWTokenGw;
    IERC20 public aaveWETH;

    // 质押记录结构
    struct StakeInfo {
        uint256 amount;  // 质押金额
        uint256 lockEnd;  // 锁仓结束时间
        uint256 lockFactor;  // 锁仓因子（放大100倍）
        uint256 rewardDebt;  // 奖励债务
        uint256 timestamp;  // 质押时间戳
        uint256 reward; // 这次质押收获的奖励数值
        uint256 withdrawTime; // 提款时间
        uint256 withdrawAmount; // 已提取的金额
    }

    // 质押池结构
    struct Pool {
        IERC20 stakingToken;  // 质押的ERC20代币，如果为address(0)表示ETH
        uint256 tokenDecimal; // 代币精度
        uint256 totalStaked;  // 该池中质押的总金额
        uint256 rewardPerBlock;  // 每个区块的奖励
        uint256 accumulatedRewardPerShare;  // 每份质押的累积奖励
        uint256 lastRewardBlock;  // 上一次计算奖励的区块
        bool disabled; // 质押池是否被禁用，禁止一切操作
        bool blocked; // 质押池是否被屏蔽，只能提取不能继续质押
    }

    struct UserPoolStake {
        uint256 totalStaked;        // 用户总共质押的数量
        uint256 totalWithdrawn;     // 用户已提取的数量
        uint256 totalRewards;       // 用户已获得的奖励
        uint256 currentStaked;      // 当前质押中数量(包含锁仓中+未锁仓中)
        StakeInfo[] stakes;         // 用户的质押记录列表
    }

    // 锁仓周期和因子配置
    mapping(uint256 => uint256) public lockFactors; // 锁仓周期到因子的映射

    // 质押信息
    mapping(address => mapping(uint256 => UserPoolStake)) public userPoolStakes;
    Pool[] public pools;

    event Staked(address indexed user, uint256 indexed poolId, uint256 amount, uint256 lockWeeks);
    event Withdrawn(address indexed user, uint256 indexed poolId, uint256 amount);
    event RewardClaimed(address indexed user, uint256 indexed poolId, uint256 reward);
    event LockFactorsUpdated(uint256[] lockWeeks, uint256[] lockFactors);
    event PoolCreated(uint256 indexed poolId, address indexed stakingToken, uint256 tokenDecimal, uint256 rewardPerBlock);
    event AavePoolUpdated(address indexed newAddress);
    event AaveWEthUpdated(address indexed newAddress);
    event AaveWrappedTokenGatewayUpdated(address indexed newAddress);
    event PoolDisabled(uint256 indexed poolId);
    event PoolBlocked(uint256 indexed poolId);
    event PoolEnabled(uint256 indexed poolId);
    event PoolUnblocked(uint256 indexed poolId);

    function initialize(address _aavePool, address _aaveWTokenGateway, address _aaveWETH) public initializer {
        __AccessControl_init();
        __Pausable_init();
        __ReentrancyGuard_init();
        __UUPSUpgradeable_init();

        aavePool = IAavePool(_aavePool);
        aaveWTokenGw = IAaveWrappedTokenGateway(_aaveWTokenGateway);
        aaveWETH = IERC20(_aaveWETH);

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(UPGRADE_MANAGER, msg.sender);
        _grantRole(CONFIG_MANAGER, msg.sender);
    }

    function _authorizeUpgrade(address newImplementation) internal onlyRole(UPGRADE_MANAGER) override {}

    function setAavePool(address _aavePool) external onlyRole(CONFIG_MANAGER) {
        aavePool = IAavePool(_aavePool);
        emit AavePoolUpdated(_aavePool);
    }

    function setAaveWTokenGateway(address _aaveWTokenGateway) external onlyRole(CONFIG_MANAGER) {
        aaveWTokenGw = IAaveWrappedTokenGateway(_aaveWTokenGateway);
        emit AaveWrappedTokenGatewayUpdated(_aaveWTokenGateway);
    }

    function setAaveWEth(address _aaveWETH) external onlyRole(CONFIG_MANAGER) {
        aaveWETH = IERC20(_aaveWETH);
        emit AaveWEthUpdated(_aaveWETH);
    }

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }

    function getUserPoolStake(address user, uint256 poolId) external view returns (UserPoolStake memory) {
        UserPoolStake storage userStakeData = userPoolStakes[user][poolId];
        uint256 predictedTotalRewards = userStakeData.totalRewards + pendingReward(user, poolId);
        return UserPoolStake({
        totalStaked : userStakeData.totalStaked,
        totalWithdrawn : userStakeData.totalWithdrawn,
        totalRewards : predictedTotalRewards,
        currentStaked : userStakeData.currentStaked,
        stakes : userStakeData.stakes
        });
    }

    // 添加新的质押池
    function addPool(IERC20 _stakingToken, uint256 _tokenDecimal, uint256 _rewardPerBlock) external onlyRole(DEFAULT_ADMIN_ROLE) {
        pools.push(Pool({
        stakingToken : _stakingToken,
        tokenDecimal : _tokenDecimal,
        totalStaked : 0,
        rewardPerBlock : _rewardPerBlock,
        accumulatedRewardPerShare : 0,
        lastRewardBlock : block.number,
        disabled : false,
        blocked : false
        }));
        emit PoolCreated(pools.length - 1, address(_stakingToken), _tokenDecimal, _rewardPerBlock);
    }

    // 设置锁仓因子
    function setLockFactors(uint256[] calldata _lockWeeks, uint256[] calldata _lockFactors) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_lockWeeks.length == _lockFactors.length, "Lock factor length mismatch");
        for (uint256 i = 0; i < _lockWeeks.length; i++) {
            require(_lockFactors[i] > 0, "Lock factor must be greater than 0");
            lockFactors[_lockWeeks[i]] = _lockFactors[i];
        }
        emit LockFactorsUpdated(_lockWeeks, _lockFactors);
    }

    // 禁用池子
    function disablePool(uint256 _poolId) external onlyRole(CONFIG_MANAGER) {
        require(_poolId < pools.length, "Invalid pool");
        pools[_poolId].disabled = true;
        emit PoolDisabled(_poolId);
    }

    // 启用池子
    function enablePool(uint256 _poolId) external onlyRole(CONFIG_MANAGER) {
        require(_poolId < pools.length, "Invalid pool");
        pools[_poolId].disabled = false;
        emit PoolEnabled(_poolId);
    }

    // 屏蔽池子
    function blockPool(uint256 _poolId) external onlyRole(CONFIG_MANAGER) {
        require(_poolId < pools.length, "Invalid pool");
        pools[_poolId].blocked = true;
        emit PoolBlocked(_poolId);
    }

    // 解除屏蔽池子
    function unblockPool(uint256 _poolId) external onlyRole(CONFIG_MANAGER) {
        require(_poolId < pools.length, "Invalid pool");
        pools[_poolId].blocked = false;
        emit PoolUnblocked(_poolId);
    }

    // 更新池子的累积奖励
    function updatePool(uint256 _poolId) internal {
        Pool storage pool = pools[_poolId];
        if (block.number <= pool.lastRewardBlock) {
            return;
        }
        if (pool.totalStaked == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }
        uint256 blocks = block.number - pool.lastRewardBlock;
        uint256 rewards = blocks * pool.rewardPerBlock;
        pool.accumulatedRewardPerShare += rewards * 1e18 / pool.totalStaked;
        pool.lastRewardBlock = block.number;
    }

    // 获取对应周期的锁仓因子
    function getLockFactor(uint256 _weeks) public view returns (uint256) {
        return lockFactors[_weeks];
    }

    // 用户质押函数
    function stake(uint256 _poolId, uint256 _amount, uint256 _lockWeeks) external payable nonReentrant whenNotPaused {
        require(_poolId < pools.length, "Invalid pool");
        require(_amount > 0, "Amount must be greater than 0");

        uint256 lockFactor = getLockFactor(_lockWeeks);
        require(lockFactor > 0, "Not ready for staking");
        Pool storage pool = pools[_poolId];
        require(!pool.disabled, "Pool is disabled");
        require(!pool.blocked, "Pool is blocked");

        updatePool(_poolId);

        if (address(pool.stakingToken) == address(0)) {
            // ETH质押
            require(msg.value == _amount, "ETH amount mismatch");
            aaveWTokenGw.depositETH{value : _amount}(address(aavePool), address(this), 0);
        } else {
            // ERC20质押
            pool.stakingToken.transferFrom(msg.sender, address(this), _amount);
            pool.stakingToken.approve(address(aavePool), _amount);
            aavePool.supply(address(pool.stakingToken), _amount, address(this), 0);
        }

        UserPoolStake storage userStakeData = userPoolStakes[msg.sender][_poolId];

        // 记录质押信息
        userStakeData.stakes.push(StakeInfo({
        amount : _amount,
        lockEnd : block.timestamp + _lockWeeks * 1 weeks,
        lockFactor : lockFactor,
        rewardDebt : pool.accumulatedRewardPerShare * _amount * lockFactor / 1e20,
        timestamp : block.timestamp,
        reward : 0,
        withdrawTime : 0,
        withdrawAmount : 0
        }));

        userStakeData.totalStaked += _amount;
        userStakeData.currentStaked += _amount;

        pool.totalStaked += _amount;
        emit Staked(msg.sender, _poolId, _amount, _lockWeeks);
    }

    function pendingReward(address _user, uint256 _poolId) public view returns (uint256) {
        Pool storage pool = pools[_poolId];
        StakeInfo[] storage userStakes = userPoolStakes[_user][_poolId].stakes;
        uint256 accumulatedRewardPerShare = pool.accumulatedRewardPerShare;
        if (block.number > pool.lastRewardBlock && pool.totalStaked != 0) {
            uint256 blocks = block.number - pool.lastRewardBlock;
            uint256 rewards = blocks * pool.rewardPerBlock;
            accumulatedRewardPerShare += rewards * 1e18 / pool.totalStaked;
        }
        uint256 totalPending = 0;
        for (uint256 i = 0; i < userStakes.length; i++) {
            StakeInfo storage userStake = userStakes[i];
            uint256 remainingAmount = userStake.amount - userStake.withdrawAmount;
            if (remainingAmount == 0) {
                continue;
            }
            uint256 accruedReward = (remainingAmount * accumulatedRewardPerShare * userStake.lockFactor / 1e20) - userStake.rewardDebt;
            totalPending += accruedReward;
        }
        return totalPending;
    }

    function withdraw(uint256 _poolId, uint256 _amount) external nonReentrant whenNotPaused {
        require(_poolId < pools.length, "Invalid pool");
        require(_amount > 0, "Amount must be greater than 0");

        Pool storage pool = pools[_poolId];
        require(!pool.disabled, "Pool is disabled");

        UserPoolStake storage userStakeData = userPoolStakes[msg.sender][_poolId];
        require(userStakeData.totalStaked > 0, "No stake found");
        require(userStakeData.currentStaked >= _amount, "Insufficient staked amount");

        updatePool(_poolId);

        uint256 remainingAmount = _amount;
        uint256 totalReward = 0;

        for (uint256 i = 0; i < userStakeData.stakes.length && remainingAmount > 0; i++) {
            StakeInfo storage userStake = userStakeData.stakes[i];
            if (block.timestamp < userStake.lockEnd || userStake.withdrawAmount >= userStake.amount) {
                continue;
            }
            uint256 availableAmount = userStake.amount - userStake.withdrawAmount;
            uint256 amountToWithdraw = remainingAmount > availableAmount ? availableAmount : remainingAmount;
            uint256 rewardDebtPortion = userStake.amount > 0 ? userStake.rewardDebt * amountToWithdraw / userStake.amount : 0;
            uint256 pendingRewardForStake = (amountToWithdraw * pool.accumulatedRewardPerShare * userStake.lockFactor / 1e20) - rewardDebtPortion;

            userStake.withdrawAmount += amountToWithdraw;
            userStake.rewardDebt -= rewardDebtPortion;
            remainingAmount -= amountToWithdraw;
            totalReward += pendingRewardForStake;

            // 保存用户提取部分的质押奖励
            userStake.reward += pendingRewardForStake;

            if (userStake.amount == userStake.withdrawAmount) {
                userStake.withdrawTime = block.timestamp;
            }

            userStakeData.totalWithdrawn += amountToWithdraw;
            userStakeData.totalRewards += pendingRewardForStake;
            userStakeData.currentStaked -= amountToWithdraw;
            pool.totalStaked -= amountToWithdraw;

            if (address(pool.stakingToken) == address(0)) {
                aaveWETH.approve(address(aaveWTokenGw), amountToWithdraw);
                aaveWTokenGw.withdrawETH(address(aavePool), amountToWithdraw, msg.sender);
            } else {
                aavePool.withdraw(address(pool.stakingToken), amountToWithdraw, msg.sender);
            }

            emit Withdrawn(msg.sender, _poolId, amountToWithdraw);
            emit RewardClaimed(msg.sender, _poolId, pendingRewardForStake);
        }
        require(remainingAmount == 0, "Some stakes are still locked and cannot be withdrawn yet");
    }

}
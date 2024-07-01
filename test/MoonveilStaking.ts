import {expect} from "chai";
import {ethers} from "hardhat";
import hre from 'hardhat';
import {mine} from "@nomicfoundation/hardhat-network-helpers";

describe("MoonveilStake", function () {
    let staking: any;
    let mockAavePool: any;
    let mockAaveWTokenGateway: any;
    let mockWETH: any;
    let owner: any;
    let addr1: any;
    let addr2: any;
    let rewardPerBlk = 100;

    beforeEach(async function () {
        // 获取测试账户
        [owner, addr1, addr2] = await ethers.getSigners();

        // 获取合约工厂
        // 获取合约工厂
        const MockAavePool = await ethers.getContractFactory("MockAavePool");
        mockAavePool = await MockAavePool.deploy();

        const MockAaveWrappedTokenGateway = await ethers.getContractFactory("MockAaveWrappedTokenGateway");
        mockAaveWTokenGateway = await MockAaveWrappedTokenGateway.deploy();

        const MockWETH = await ethers.getContractFactory("MockWETH");
        mockWETH = await MockWETH.deploy();

        const impl = await ethers.getContractFactory("MoonveilStake");
        const proxy = await ethers.getContractFactory("MoonveilStakeProxy");

        // 部署合约
        const logicCtrt = await impl.deploy();
        // 准备初始化合约的数据
        const initData = logicCtrt.interface.encodeFunctionData("initialize", [await mockAavePool.getAddress(), await mockAaveWTokenGateway.getAddress(), await mockWETH.getAddress()]);
        // 部署代理合约
        const proxyCtrt = await proxy.deploy(await logicCtrt.getAddress(), initData);

        // 使用代理地址获取 DestinyTetra 合约的实例
        staking = await impl.attach(await proxyCtrt.getAddress());

        // 添加奖励因子
        const weeks = [0,1];
        const factors = [100, 200];
        await staking.setLockFactors(weeks, factors);
        // 添加质押池
        await staking.addPool("0x0000000000000000000000000000000000000000", 18, rewardPerBlk);
    });
    describe("Permission tests", function () {
        it("Should set the right owner", async function () {
            expect(await staking.hasRole(await staking.DEFAULT_ADMIN_ROLE(), owner.address)).to.be.true;
            expect(await staking.hasRole(await staking.UPGRADE_MANAGER(), owner.address)).to.be.true;
            expect(await staking.hasRole(await staking.CONFIG_MANAGER(), owner.address)).to.be.true;
        });

        it("should allow only DEFAULT_ADMIN_ROLE to pause and unpause", async function () {
            await expect(staking.connect(addr1).pause()).to.be.revertedWith(
                "AccessControl: account " + addr1.address.toLowerCase() + " is missing role " + await staking.DEFAULT_ADMIN_ROLE()
            );

            await staking.pause();
            expect(await staking.paused()).to.be.true;

            await expect(staking.connect(addr1).unpause()).to.be.revertedWith(
                "AccessControl: account " + addr1.address.toLowerCase() + " is missing role " + await staking.DEFAULT_ADMIN_ROLE()
            );

            await staking.unpause();
            expect(await staking.paused()).to.be.false;
        });

        it("should allow only UPGRADE_MANAGER to upgrade contract", async function () {
            const newFactory = await ethers.getContractFactory("MoonveilStake");
            const newImpl = await newFactory.deploy();

            await expect(staking.connect(addr1).upgradeTo(await newImpl.getAddress())).to.be.revertedWith(
                "AccessControl: account " + addr1.address.toLowerCase() + " is missing role " + await staking.UPGRADE_MANAGER()
            );

            await staking.grantRole(await staking.UPGRADE_MANAGER(), addr1.address);
            await expect(staking.connect(addr1).upgradeTo(await newImpl.getAddress())).to.not.be.reverted;
        });

        it("should allow only CONFIG_MANAGER to set Aave addresses and manage pools", async function () {
            const newAavePool = ethers.Wallet.createRandom().address;
            const newAaveWTokenGateway = ethers.Wallet.createRandom().address;
            const newAaveWETH = ethers.Wallet.createRandom().address;

            await expect(staking.connect(addr1).setAavePool(newAavePool)).to.be.revertedWith(
                "AccessControl: account " + addr1.address.toLowerCase() + " is missing role " + ethers.id("CONFIG_MANAGER")
            );

            await expect(staking.connect(addr1).setAaveWTokenGateway(newAaveWTokenGateway)).to.be.revertedWith(
                "AccessControl: account " + addr1.address.toLowerCase() + " is missing role " + ethers.id("CONFIG_MANAGER")
            );

            await expect(staking.connect(addr1).setAaveWEth(newAaveWETH)).to.be.revertedWith(
                "AccessControl: account " + addr1.address.toLowerCase() + " is missing role " + ethers.id("CONFIG_MANAGER")
            );

            await expect(staking.connect(addr1).disablePool(0)).to.be.revertedWith(
                "AccessControl: account " + addr1.address.toLowerCase() + " is missing role " + ethers.id("CONFIG_MANAGER")
            );

            await staking.grantRole(ethers.id("CONFIG_MANAGER"), addr1.address);

            await staking.connect(addr1).setAavePool(newAavePool);
            await staking.connect(addr1).setAaveWTokenGateway(newAaveWTokenGateway);
            await staking.connect(addr1).setAaveWEth(newAaveWETH);

            expect(await staking.aavePool()).to.equal(newAavePool);
            expect(await staking.aaveWTokenGw()).to.equal(newAaveWTokenGateway);
            expect(await staking.aaveWETH()).to.equal(newAaveWETH);

            await staking.connect(addr1).disablePool(0);
            const pool = await staking.pools(0);
            expect(pool.disabled).to.be.true;
        });

        it("should allow only CONFIG_MANAGER to disable and enable pool", async function () {
            await expect(staking.connect(addr1).disablePool(0)).to.be.revertedWith(
                "AccessControl: account " + addr1.address.toLowerCase() + " is missing role " + await staking.CONFIG_MANAGER()
            );

            await staking.grantRole(await staking.CONFIG_MANAGER(), addr1.address);
            await expect(staking.connect(addr1).disablePool(0)).to.not.be.reverted;
            await expect(staking.connect(addr1).enablePool(0)).to.not.be.reverted;
        });

        it("should allow only CONFIG_MANAGER to block and unblock pool", async function () {
            await expect(staking.connect(addr1).blockPool(0)).to.be.revertedWith(
                "AccessControl: account " + addr1.address.toLowerCase() + " is missing role " + await staking.CONFIG_MANAGER()
            );

            await staking.grantRole(await staking.CONFIG_MANAGER(), addr1.address);
            await expect(staking.connect(addr1).blockPool(0)).to.not.be.reverted;
            await expect(staking.connect(addr1).unblockPool(0)).to.not.be.reverted;
        });
    });

    describe("Stake Tests", function () {
        it("should calculate pending rewards correctly", async function () {
            await staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, {value: ethers.parseEther("100")});
            // 模拟区块增长到100个块
            await mine(99);
            const reward1 = await staking.pendingReward(addr1.address, 0);
            expect(reward1).to.equal(99 * rewardPerBlk);
            await staking.connect(addr2).stake(0, ethers.parseEther("100"), 0, {value: ethers.parseEther("100")});
            await mine(100);
            // 断言地址1与地址2的奖励
            expect(await staking.pendingReward(addr1.address, 0)).to.equal(15000);
            expect(await staking.pendingReward(addr2.address, 0)).to.equal(5000);
            // 提现
            await staking.connect(addr1).withdraw(0, ethers.parseEther("100"));
            await staking.connect(addr2).withdraw(0, ethers.parseEther("100"));
            // 断言提现后的奖励
            expect(await staking.pendingReward(addr1.address, 0)).to.equal(0);
            expect(await staking.pendingReward(addr2.address, 0)).to.equal(0);
            const user1PoolStake = await staking.getUserPoolStake(addr1.address, 0);
            expect(user1PoolStake.totalRewards).to.equal(user1PoolStake.stakes[0].reward);
            expect(user1PoolStake.totalStaked).to.equal(ethers.parseEther("100"));
            expect(user1PoolStake.currentStaked).to.equal(0);
            expect(user1PoolStake.stakes[0].withdrawAmount).to.equal(ethers.parseEther("100"));

        });
        it("should stake multiple times and accumulate correctly", async function () {
            await staking.connect(addr1).stake(0, ethers.parseEther("50"), 0, {value: ethers.parseEther("50")});
            const start = await hre.ethers.provider.getBlock("latest");
            await mine(10);
            await staking.connect(addr1).stake(0, ethers.parseEther("50"), 0, {value: ethers.parseEther("50")});
            await mine(9);
            const end = await hre.ethers.provider.getBlock("latest");
            const wantReward = (end?.number! - start?.number!) * rewardPerBlk;
            const reward = await staking.pendingReward(addr1.address, 0);
            expect(reward).to.equal(wantReward);
        });``

        it("should stake with different lock periods", async function () {
            await staking.connect(addr1).stake(0, ethers.parseEther("100"), 1, {value: ethers.parseEther("100")});
            await mine(100);
            const reward = await staking.pendingReward(addr1.address, 0);
            const wantReward = 100 * rewardPerBlk * 2;
            expect(reward).to.equal(wantReward); // 锁仓因子为200
        });

    });

    describe("Withdraw Tests", function () {
        it("should allow full withdrawal successfully", async function () {
            await staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, {value: ethers.parseEther("100")});
            await mine(100);
            await expect(staking.connect(addr1).withdraw(0, ethers.parseEther("100")))
                .to.emit(staking, "Withdrawn")
                .withArgs(addr1.address, 0, ethers.parseEther("100"));
            const userPoolStake = await staking.getUserPoolStake(addr1.address, 0);
            expect(userPoolStake.currentStaked).to.equal(ethers.parseEther("0"));
        });

        it("should revert if amount is greater than staked balance", async function () {
            await staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, {value: ethers.parseEther("100")});
            await mine(50);
            await expect(staking.connect(addr1).withdraw(0, ethers.parseEther("200"))).to.be.revertedWith("Insufficient staked amount");
        });

        it("should allow partial withdrawal successfully", async function () {
            await staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, {value: ethers.parseEther("100")});
            await mine(50);
            await expect(staking.connect(addr1).withdraw(0, ethers.parseEther("50")))
                .to.emit(staking, "Withdrawn")
                .withArgs(addr1.address, 0, ethers.parseEther("50"));
            const userPoolStake = await staking.getUserPoolStake(addr1.address, 0);
            expect(userPoolStake.currentStaked).to.equal(ethers.parseEther("50"));
            expect(userPoolStake.stakes[0].withdrawAmount).to.equal(ethers.parseEther("50"));
        });

        it("should calculate rewards correctly after partial withdrawal", async function () {
            await staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, {value: ethers.parseEther("100")});
            await mine(50);
            const wantReward = 50 * rewardPerBlk;
            expect(await staking.pendingReward(addr1.address, 0)).to.equal(wantReward);
            await expect(staking.connect(addr1).withdraw(0, ethers.parseEther("50")))
                .to.emit(staking, "Withdrawn")
                .withArgs(addr1.address, 0, ethers.parseEther("50"));
            await mine(50);
            const pendingRewardAfterWithdraw = await staking.pendingReward(addr1.address, 0);
            expect(pendingRewardAfterWithdraw).to.be.gt(0);
            // 累计奖励应该正确
            let stake = await staking.getUserPoolStake(addr1.address, 0);
            let totalReward = stake.stakes[0].reward + pendingRewardAfterWithdraw;
            expect(totalReward).to.equal(101 * rewardPerBlk);
        });

        it("should revert if no staked balance and trying to withdraw", async function () {
            await expect(staking.connect(addr1).withdraw(0, ethers.parseEther("100"))).to.be.revertedWith("No stake found");
        });

        it("should revert if trying to withdraw before lock period ends", async function () {
            await staking.connect(addr1).stake(0, ethers.parseEther("100"), 1, {value: ethers.parseEther("100")});
            await mine(50);
            await expect(staking.connect(addr1).withdraw(0, ethers.parseEther("100"))).to.be.revertedWith("Some stakes are still locked and cannot be withdrawn yet");
        });

        it("should allow multiple partial withdrawals successfully", async function () {
            await staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, {value: ethers.parseEther("100")});
            await mine(50);
            await expect(staking.connect(addr1).withdraw(0, ethers.parseEther("30")))
                .to.emit(staking, "Withdrawn")
                .withArgs(addr1.address, 0, ethers.parseEther("30"));
            await mine(10);
            await expect(staking.connect(addr1).withdraw(0, ethers.parseEther("20")))
                .to.emit(staking, "Withdrawn")
                .withArgs(addr1.address, 0, ethers.parseEther("20"));
            const userPoolStake = await staking.getUserPoolStake(addr1.address, 0);
            expect(userPoolStake.currentStaked).to.equal(ethers.parseEther("50"));
            expect(userPoolStake.stakes[0].withdrawAmount).to.equal(ethers.parseEther("50"));
        });
    });

    describe("Additional Tests", function () {
        it("should handle multiple users staking and withdrawing correctly", async function () {
            await staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, { value: ethers.parseEther("100") });
            await staking.connect(addr2).stake(0, ethers.parseEther("200"), 0, { value: ethers.parseEther("200") });
            await mine(50);

            const reward1 = await staking.pendingReward(addr1.address, 0);
            const reward2 = await staking.pendingReward(addr2.address, 0);
            expect(reward1).to.be.gt(0);
            expect(reward2).to.be.gt(0);

            await staking.connect(addr1).withdraw(0, ethers.parseEther("50"));
            await staking.connect(addr2).withdraw(0, ethers.parseEther("100"));

            const newReward1 = await staking.pendingReward(addr1.address, 0);
            const newReward2 = await staking.pendingReward(addr2.address, 0);
            expect(newReward1).to.be.gt(0);
            expect(newReward2).to.be.gt(0);
        });

        it("should prevent staking after pool is disabled", async function () {
            await staking.disablePool(0);
            await expect(staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, { value: ethers.parseEther("100") }))
                .to.be.revertedWith("Pool is disabled");
        });

        it("should not allow withdrawals after pool is disabled", async function () {
            await staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, { value: ethers.parseEther("100") });
            await staking.disablePool(0);
            await mine(50);
            await expect( staking.connect(addr1).withdraw(0, ethers.parseEther("50"))).to.revertedWith("Pool is disabled");
        });

        it("should prevent staking after pool is blocked", async function () {
            await staking.blockPool(0);
            await expect(staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, { value: ethers.parseEther("100") }))
                .to.be.revertedWith("Pool is blocked");
        });

        it("should allow withdrawals after pool is blocked", async function () {
            await staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, { value: ethers.parseEther("100") });
            await staking.blockPool(0);
            await mine(50);
            await staking.connect(addr1).withdraw(0, ethers.parseEther("50"));
            const userPoolStake = await staking.getUserPoolStake(addr1.address, 0);
            expect(userPoolStake.currentStaked).to.equal(ethers.parseEther("50"));
        });

        it("should correctly handle partial withdrawals during lock period", async function () {
            await staking.connect(addr1).stake(0, ethers.parseEther("100"), 1, { value: ethers.parseEther("100") });
            await mine(50);
            await expect(staking.connect(addr1).withdraw(0, ethers.parseEther("50")))
                .to.be.revertedWith("Some stakes are still locked and cannot be withdrawn yet");
        });

        it("should allow withdraw after lock ended", async function () {
            await staking.connect(addr1).stake(0, ethers.parseEther("100"), 1, { value: ethers.parseEther("100") });
            // 增加一周时间，使得锁定期结束
            const oneWeek = 7 * 24 * 60 * 60;
            await ethers.provider.send('evm_increaseTime', [oneWeek]);
            await ethers.provider.send('evm_mine', []);
            await expect(staking.connect(addr1).withdraw(0, ethers.parseEther("100")))
                .to.not.be.reverted;
        });

        it("should emit events correctly on staking and withdrawing", async function () {
            await expect(staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, { value: ethers.parseEther("100") }))
                .to.emit(staking, "Staked")
                .withArgs(addr1.address, 0, ethers.parseEther("100"), 0);

            await mine(50);

            await expect(staking.connect(addr1).withdraw(0, ethers.parseEther("50")))
                .to.emit(staking, "Withdrawn")
                .withArgs(addr1.address, 0, ethers.parseEther("50"));
        });

        it("should allow staking after pool is re-enabled", async function () {
            await staking.disablePool(0);
            await expect(staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, { value: ethers.parseEther("100") }))
                .to.be.revertedWith("Pool is disabled");

            await staking.enablePool(0);
            await expect(staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, { value: ethers.parseEther("100") }))
                .to.emit(staking, "Staked")
                .withArgs(addr1.address, 0, ethers.parseEther("100"), 0);
        });

        it("should allow staking after pool is unblocked", async function () {
            await staking.blockPool(0);
            await expect(staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, { value: ethers.parseEther("100") }))
                .to.be.revertedWith("Pool is blocked");

            await staking.unblockPool(0);
            await expect(staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, { value: ethers.parseEther("100") }))
                .to.emit(staking, "Staked")
                .withArgs(addr1.address, 0, ethers.parseEther("100"), 0);
        });

        it("should handle multiple stakes and withdrawals correctly", async function () {
            await staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, { value: ethers.parseEther("100") });
            await mine(50);
            await staking.connect(addr1).stake(0, ethers.parseEther("50"), 0, { value: ethers.parseEther("50") });
            await mine(50);
            await staking.connect(addr1).withdraw(0, ethers.parseEther("50"));
            await mine(50);
            await staking.connect(addr1).withdraw(0, ethers.parseEther("100"));

            const userPoolStake = await staking.getUserPoolStake(addr1.address, 0);
            expect(userPoolStake.currentStaked).to.equal(ethers.parseEther("0"));
        });

        it("should handle concurrent staking and withdrawing by multiple users", async function () {
            await staking.connect(addr1).stake(0, ethers.parseEther("100"), 0, { value: ethers.parseEther("100") });
            await staking.connect(addr2).stake(0, ethers.parseEther("200"), 0, { value: ethers.parseEther("200") });
            await mine(50);
            await staking.connect(addr1).withdraw(0, ethers.parseEther("50"));
            await staking.connect(addr2).withdraw(0, ethers.parseEther("100"));
            await mine(50);
            const reward1 = await staking.pendingReward(addr1.address, 0);
            const reward2 = await staking.pendingReward(addr2.address, 0);
            expect(reward1).to.be.gt(0);
            expect(reward2).to.be.gt(0);

            await staking.connect(addr1).withdraw(0, ethers.parseEther("50"));
            await staking.connect(addr2).withdraw(0, ethers.parseEther("100"));
            const user1PoolStake = await staking.getUserPoolStake(addr1.address, 0);
            const user2PoolStake = await staking.getUserPoolStake(addr2.address, 0);
            expect(user1PoolStake.currentStaked).to.equal(ethers.parseEther("0"));
            expect(user2PoolStake.currentStaked).to.equal(ethers.parseEther("0"));
        });

    });

});

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

contract MockWETH is ERC20 {
    constructor() ERC20("Mock Wrapped Ether", "WETH") {}

    function mint(address to, uint256 amount) public {
        _mint(to, amount);
    }

    function burn(address from, uint256 amount) public {
        _burn(from, amount);
    }
}

contract MockAavePool {
    mapping(address => uint256) public balances;

    function supply(address asset, uint256 amount, address onBehalfOf, uint16 referralCode) external {
        balances[onBehalfOf] += amount;
    }

    function withdraw(address asset, uint256 amount, address to) external returns (uint256) {
        uint256 balance = balances[msg.sender];
        uint256 withdrawAmount = amount > balance ? balance : amount;
        balances[msg.sender] -= withdrawAmount;
        if (asset == address(0)) {
            payable(to).transfer(withdrawAmount);
        } else {
            IERC20(asset).transfer(to, withdrawAmount);
        }
        return withdrawAmount;
    }
}

contract MockAaveWrappedTokenGateway {
    mapping(address => uint256) public balances;

    function depositETH(address onBehalfOf, uint16 referralCode) external payable {
        balances[onBehalfOf] += msg.value;
    }

    function withdrawETH(address, uint256 amount, address to) external returns (uint256) {
        uint256 balance = balances[msg.sender];
        uint256 withdrawAmount = amount > balance ? balance : amount;
        balances[msg.sender] -= withdrawAmount;
        payable(to).transfer(withdrawAmount);
        return withdrawAmount;
    }

    fallback() external payable {}
}

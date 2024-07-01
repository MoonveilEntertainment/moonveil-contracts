// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;

// https://sepolia.etherscan.io/address/0x0562453c3dafbb5e625483af58f4e6d668c44e19#code#F17#L467
interface IAaveWrappedTokenGateway {
    /**
    * @dev deposits WETH into the reserve, using native ETH. A corresponding amount of the overlying asset (aTokens)
    * is minted.
    * @param onBehalfOf address of the user who will receive the aTokens representing the deposit
    * @param referralCode integrators are assigned a referral code and can potentially receive rewards.
    **/
    function depositETH(
        address,
        address onBehalfOf,
        uint16 referralCode
    ) external payable;

    /**
    * @dev withdraws the WETH _reserves of msg.sender.
    * @param amount amount of aWETH to withdraw and receive native ETH
    * @param to address of the user who will receive native ETH
    */
    function withdrawETH(
        address,
        uint256 amount,
        address to
    ) external;
}

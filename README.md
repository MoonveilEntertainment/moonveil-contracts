# moonveil-contracts

## 运行项目

1. 安装依赖

```bash
npm install
```

2. 运行测试

```bash
npx hardhat test
```

## 质押合约

### 概述

MoonveilStake 合约允许用户质押他们的代币以赚取质押点奖励。 该合约集成了 Aave，支持质押 ETH 和 ERC20 代币。

合约具有暂停、禁用和屏蔽池子、升级合约等功能。以下是主要特性和功能：

1. 质押:
    - 用户可以将 ETH 或 ERC20 代币质押到对应的池子中。
    - 支持具有不同锁仓期的质押，按周计算，0代表不锁仓质押。
2. 奖励计算:
    - 每个区块固定产出配置数量的质押点数。
    - 不同的锁仓周期对应不同的锁仓(奖励)因子。
    - 用户在某个池中每区块获得质押点数 = 用户资产占比 * 该池每区块产生的质押点 * 锁仓因子
    - 奖励累积并可在提取时领取。

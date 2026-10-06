# All Perps Research - Market Engine

## Milestone

Completed:
- Market state model
- Market configuration
- Skew-based pricing
- Capacity model
- Trade simulation


## 1. Problem Statement

A perpetual protocol needs a mechanism to price trades while managing:

1. Directional imbalance
2. Market capacity risk


## 2. Architecture

MarketConfig
- maxCapacity
- skewCoefficient
- capacityCoefficient


MarketState
- indexPrice
- longOpenInterest
- shortOpenInterest


Flow:

Trader
 |
 v
Trade Simulator
 |
 v
Pricing Engine
 |
 +---- Skew Impact
 |
 +---- Capacity Impact
 |
 v
Execution Price


## 3. Market State

MarketState represents current market conditions.

Example:

{
 indexPrice: 100,
 longOpenInterest: 20000,
 shortOpenInterest: 20000
}


## 4. Market Configuration

MarketConfig represents protocol parameters.

Example:

{
 maxCapacity: 100000,
 skewCoefficient:0.2,
 capacityCoefficient:0.05
}


## 5. Skew Model

Problem:

If traders heavily favor one side, protocol takes directional risk.


Solution:

Calculate imbalance between long and short exposure.

Effect:

More LONG demand:

LONG execution price increases.


## 6. Capacity Model

Problem:

Unlimited exposure can create protocol risk.


Solution:

Limit total market exposure.

Formula:

Total Exposure <= Max Capacity


## 7. Trade Simulation

Large trades are split into multiple steps.

Each step:

1. Check capacity
2. Calculate execution price
3. Update exposure


## 8. Current Limitations

Not implemented:

- Positions
- PnL
- Margin
- Liquidation
- Funding
- Oracle
- Smart contracts


## 9. Next Milestone

Position System

Goal:

Track individual trader positions.
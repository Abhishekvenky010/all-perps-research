# Architecture

This is the architecture of the current TypeScript reference implementation.
It is not a deployed-service or smart-contract architecture.

## Canonical paths

### Opening

```text
TradeSimulator
  -> capacity and leverage validation
  -> progressive OI staging
  -> average execution quote (Pricing / ImpactModel)
  -> PositionManager registration and OI commit
```

`TradeSimulator` is the supported open path. It obtains a stepwise average
entry price; capacity impact and skew are reflected in those step quotes.
`PositionManager` tracks position lifecycle and reconciles OI.

### Reference price and TWAP

```text
ReferencePriceSource interface
  -> ReferencePriceService validates/ingests observations
  -> TWAPOracle computes the complete 900-second arithmetic TWAP
  -> market reference/TWAP state
```

The observation interface and local processing are implemented. An
authenticated external provider and the mapping from an external AMM price
to observations are not.

### Voluntary settlement

```text
SettleAndClosePosition
  -> SettlementPrice (exclude this position's own OI)
  -> PnL calculation
  -> vault backing/accounting preparation
  -> position, OI, and vault commit
```

### Liquidation

```text
LiquidationEngine / settlement entry point
  -> canonical SettlementPrice
  -> PositionMark and strict maintenance-margin test
  -> backing/accounting checks
  -> position, OI, and vault transition
```

The liquidation threshold is strict: a position is liquidatable when its
margin ratio is below maintenance margin, not equal to it.

## Main module map

| Concern | Main modules |
|---|---|
| Market state and configuration | `src/market/MarketState.ts`, `src/config/MarketConfig.ts` |
| Capacity and pricing | `src/amm/Capacity.ts`, `src/amm/Pricing.ts`, `src/amm/ImpactModel.ts` |
| Reference observations and TWAP | `src/oracle/ReferencePriceSource.ts`, `src/oracle/ReferencePriceService.ts`, `src/oracle/TWAPOracle.ts` |
| Positions and OI | `src/position/Position.ts`, `src/position/PositionManager.ts` |
| Margin, PnL, marks, liquidation | `src/risk/` |
| Settlement | `src/settlement/SettlementPrice.ts`, `src/settlement/SettleAndClosePosition.ts`, `src/settlement/SettleAndLiquidatePosition.ts` |
| Vault accounting | `src/liquidity/LiquidityVault.ts` |
| Trade/simulation entry | `src/simulation/TradeSimulator.ts` |

Simulation helpers remain in the source tree where current tests require
them. Caller-priced `ExperimentalSettlement.ts` and alternative
`SkewCurves.ts` are preserved under `experiments/archive/`; neither is part of
the canonical settlement or pricing path.

## State and trust boundaries

The prototype uses mutable in-memory TypeScript state. It does not implement
transaction authorization, authenticated price-source selection, persistent
state, token custody, or transfers. A caller must not treat a local
simulation boundary as a production security boundary.

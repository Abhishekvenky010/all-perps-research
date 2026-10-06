# 1. Protocol Actors

- Trader
  - Provides: trade side, size, margin, and a trader identifier to `simulateTrade` in `src/simulation/TradeSimulator.ts`.
  - Receives: a `Position` record with entry price, plus settlement value `margin + pnl` on close in `calculatePositionSettlement`.
  - Economic risk: price movement against the position reduces equity and can make the position liquidatable. Losses are not capped at margin in `calculatePositionSettlement`; liquidation settlement floors the returned `remainingMargin` at zero.
  - Classification: EXPLICIT PROJECT ASSUMPTION for margin and settlement; OUR INFERENCE for trader economic role.

- LP
  - Provides: capital through `createLiquidityVault` and `depositLP` in `src/liquidity/LiquidityVault.ts`.
  - Receives: premiums through `addPremium`, and gains when trader PnL is negative through `recordTraderPnL`.
  - Economic risk: positive trader PnL reduces `availableCapital`; realized settlement is rejected atomically if it would make backing negative. Open-position liabilities and actual cash custody remain unreserved/unmodeled.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- Protocol/market
  - Provides: market state, capacity gate, AMM execution price, position storage, risk marking, and settlement functions.
  - Receives: no explicit protocol fees are implemented. Premiums exist as vault accounting, but no trade path currently collects them.
  - Economic risk: the project models market exposure and LP capital risk, but the protocol entity itself has no balance sheet in code.
  - Classification: EXPLICIT PROJECT ASSUMPTION for state functions; UNDEFINED for protocol revenue or backstop capital.

- External AMM / oracle source
  - Provides: `ammTwapPrice` in `MarketState`, observations in `TWAPOracle`, and mark price inputs to risk and settlement functions.
  - Receives: nothing modeled.
  - Economic risk: not modeled. Manipulation cost is studied in experiments/tests, but no source-level actor balance sheet exists.
  - Classification: EXPLICIT PROJECT ASSUMPTION for TWAP source; UNDEFINED for oracle/AMM economic incentives.

# 2. Core Economic Objects

- Market
  - Meaning: a `MarketState` with `symbol`, `indexPrice`, `ammTwapPrice`, `longOpenInterest`, and `shortOpenInterest` in `src/market/MarketState.ts`.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- Open Interest
  - Meaning: side-specific total open exposure: `longOpenInterest` and `shortOpenInterest`. Total OI is their sum in `getTotalOpenInterest`.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- Skew
  - Meaning: `longOpenInterest - shortOpenInterest` in `getSkew`.
  - Classification: PAPER-SUPPORTED as a directional imbalance concept; EXPLICIT PROJECT ASSUMPTION for this exact formula.

- Capacity
  - Meaning: `config.maxCapacity` bounds total OI. `canIncreaseExposure` checks `getTotalOpenInterest(state) + size <= maxCapacity + tolerance`.
  - Classification: PAPER-SUPPORTED as capacity risk; EXPLICIT PROJECT ASSUMPTION for total-OI capacity rule.

- Position
  - Meaning: `{ id, trader, market, side, size, entryPrice, margin }` in `src/position/Position.ts`.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- Margin
  - Meaning: position-level margin stored inside `Position`. Equity is `position.margin + pnl`.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- Entry Price
  - Meaning: average execution price assigned at open in `simulateTrade` after stepwise pricing.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- Mark/TWAP Price
  - Meaning: `ammTwapPrice` is the 900-second arithmetic TWAP of validated reference observations. `getCurrentAmmPrice` computes the skew-adjusted protocol mark; production close and liquidation derive it through `getSettlementPrice`.
  - Classification: EXPLICIT PROJECT ASSUMPTION. Reference-source authentication and live external integration remain absent.

- Trader PnL
  - Meaning: `calculateUnrealizedPnL(position, currentPrice)`, LONG = `(currentPrice - entryPrice) * size`, SHORT = `(entryPrice - currentPrice) * size`.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- LP Capital
  - Meaning: `LiquidityVault.availableCapital`, increased by deposits, negative trader PnL, and premiums; decreased by positive trader PnL.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- LP Equity
  - Meaning: `totalDeposited - traderPnL + premiums` from `getLpEquity`.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- Trader Settlement
  - Meaning: voluntary close settlement is `position.margin + pnl`; liquidation settlement returns `max(equity, 0)`.
  - Classification: EXPLICIT PROJECT ASSUMPTION, with ambiguity between close and liquidation behavior when equity is negative.

# 3. Position Lifecycle

OPEN -> ACTIVE

- State changes: `simulateTrade` first checks leverage, simulates capacity and price on a copied market state, then commits `Object.assign(state, workingState)` and calls `positionManager.openPosition(position)`.
- OI: increased by `size` on the side being opened through `applyExposure`.
- Trader margin: stored in the new `Position`.
- LP capital: unchanged. No opening premium or margin transfer into `LiquidityVault` occurs in the trade path.
- Position record: created with generated id, trader, market, side, total filled size, average entry price, and margin.
- Undefined: margin custody is only represented as a field on `Position`; there is no separate margin vault implementation.

ACTIVE -> PROFITABLE / LOSING

- State changes: no mutation is required. `markPosition` is read-only.
- OI: unchanged.
- Trader margin: unchanged as a stored field.
- LP capital: unchanged until settlement.
- Position record: unchanged.
- Undefined: no continuous funding, premium accrual, or periodic realization is implemented.

PROFITABLE / LOSING -> CLOSE

- State changes: `settleAndClosePosition` calculates PnL at supplied `currentPrice`, records PnL in vault, then calls `closePosition`.
- OI: released by subtracting position size from same-side OI.
- Trader margin: returned settlement is `margin + pnl`; negative settlement is possible from `calculatePositionSettlement`.
- LP capital: positive trader PnL reduces vault capital; negative trader PnL increases it.
- Position record: removed from `PositionManager`.
- Undefined: no check ensures settlement is non-negative or payable by the vault.

PROFITABLE / LOSING -> LIQUIDATE

- State changes: `settleAndLiquidatePosition` marks the position, requires `mark.liquidatable`, records PnL in vault, closes the position, and returns settlement fields.
- OI: released by `closePosition`.
- Trader margin: remaining margin returned as `max(equity, 0)`.
- LP capital: positive trader PnL reduces vault capital; negative trader PnL increases it.
- Position record: removed.
- Undefined: no liquidation penalty, liquidator reward, insurance fund, or solvency guard.

CLOSE or LIQUIDATE -> SETTLED

- State changes: settlement has been recorded in the vault and the position has been removed.
- OI: released.
- Trader margin: settlement result returned from function; no cash ledger exists for the trader.
- LP capital: updated through `recordTraderPnL`.
- Position record: removed.
- Undefined: actual transfer mechanics are not modeled.

# 4. Trade Opening

Current flow:

Trader -> capacity check -> price calculation -> execution -> OI update -> position creation

- Trader input enters `simulateTrade(state, side, size, steps, config, trader, margin, positionManager)`.
- Leverage is checked first by creating a temporary position and calling `isLeverageAllowed` in `src/risk/Leverage.ts`.
- Capacity is checked on each step with `canIncreaseExposure(workingState, config, stepSize)` in `src/amm/Capacity.ts`.
- Price calculation uses `getAverageExecutionPrice(workingState, config, side)` from `src/amm/Pricing.ts`. Although `getExecutionPrice` also exists, `simulateTrade` currently uses average execution price.
- Execution is simulation behavior: each step records a price and applies exposure only to `workingState`.
- OI mutation occurs in `applyExposure` on `workingState`, then all market changes are committed at once through `Object.assign(state, workingState)`.
- Position creation occurs after successful execution through `positionManager.openPosition(position)`.
- Authoritative implementation for opening is `simulateTrade`.
- Merely simulation behavior: step splitting, price history, and average price calculation. The project documentation describes this as an off-chain prototype, not an on-chain protocol implementation.
- Duplicated responsibility: pricing has `getExecutionPrice`, `getAverageExecutionPrice`, `getBoundedExecutionPrice`, and `getConvexExecutionPrice`; opening uses only `getAverageExecutionPrice`. Capacity also appears both as a hard gate in `canIncreaseExposure` and a price impact through `getCapacityImpact`.

# 5. Position Closing

Closing is not implemented as an opposite-side AMM trade.

The direct close helper `closePosition(positionId, market, positionManager)`:

- loads the existing position;
- rejects missing positions with `POSITION_NOT_FOUND`;
- rejects market mismatch with `POSITION_MARKET_MISMATCH`;
- subtracts `position.size` from same-side OI;
- rejects insufficient side OI with `INVALID_LONG_OPEN_INTEREST` or `INVALID_SHORT_OPEN_INTEREST`;
- removes the position record.

The settlement close flow `settleAndClosePosition`:

- loads and validates the position;
- calculates settlement at supplied `currentPrice` through `calculatePositionSettlement`;
- calls `recordTraderPnL(vault, settlement.pnl)`;
- calls `closePosition` to release OI and remove the record.

Exact behavior: close settles directly at a supplied price and releases same-side OI. It does not call `simulateTrade`, does not call `getExecutionPrice`, and does not execute an opposite-side AMM trade.

UNDEFINED: the authoritative close price source is not fixed by this function. Callers supply `currentPrice`.

# 6. Liquidation

Implemented liquidation path:

mark price -> PnL -> equity -> margin ratio -> liquidation decision -> settlement -> OI release

- Mark price: `markPosition(position, markPrice, maintenanceMargin)` accepts a supplied mark price. `runLiquidationSweep` derives mark price from `getCurrentAmmPrice(state, config)`.
- PnL: `calculateUnrealizedPnL`.
- Equity: `calculateEquity(position, pnl) = position.margin + pnl`.
- Margin ratio: `calculateMarginRatio(position, pnl) = equity / position.size`.
- Liquidation decision: `isLiquidatable` returns `marginRatio < maintenanceMargin`. Equality is healthy.
- Settlement: `settleAndLiquidatePosition` records PnL in the vault and returns `remainingMargin = max(equity, 0)` and `traderSettlement = remainingMargin`.
- OI release: `closePosition` subtracts same-side OI and removes the position.

Explicitly implemented:

- read-only marking in `PositionMark`;
- strict liquidation boundary in `Liquidation`;
- liquidation close in `LiquidationEngine`;
- combined liquidation plus vault settlement in `SettleAndLiquidatePosition`;
- market-level liquidation sweep in `LiquidationSweep`.

Undefined:

- liquidation incentive;
- penalty;
- insurance fund;
- keeper/liquidator actor;
- treatment of profitable but below-threshold cases beyond the formula;
- hard solvency check before paying profitable liquidations;
- oracle source policy for `currentPrice` outside `runLiquidationSweep`.

# 7. LP Economics

`LiquidityVault` is an accounting object:

- LP capital enters through `createLiquidityVault(initialDeposit)` or `depositLP(vault, amount)`.
- Trader profit affects LP capital through `recordTraderPnL(vault, pnl)`: positive `pnl` increases `vault.traderPnL` and subtracts from `availableCapital`.
- Trader loss affects LP capital through the same function: negative `pnl` increases `availableCapital`.
- Premiums are separate positive amounts added through `addPremium`; they increase both `premiums` and `availableCapital`.
- LP equity is `totalDeposited - traderPnL + premiums`.
- LP equity can become negative. `tests/endToEndSettlement.test.ts` expects a profitable trader settlement to make `availableCapital` and `getLpEquity` equal `-50_000`.
- There is no hard solvency invariant in `LiquidityVault`, settlement, or trade opening. `recordTraderPnL` validates only that PnL is finite.

# 8. State Transition Table

| Transition | Preconditions | State Changes | Trader Effect | LP Effect | OI Effect | Defined? |
|---|---|---|---|---|---|---|
| Open long | Leverage allowed; every step passes `canIncreaseExposure` | `simulateTrade` commits `workingState`; opens position | Receives LONG position with average entry price and stored margin | None | Long OI increases by filled size | Yes |
| Open short | Leverage allowed; every step passes `canIncreaseExposure` | Same as long, side SHORT | Receives SHORT position with average entry price and stored margin | None | Short OI increases by filled size | Yes |
| Hold position | Position exists | No mutation | Unrealized PnL may change with supplied mark price | None until settlement | No change | Partly; funding/premiums undefined |
| Mark position | Valid positive mark price; valid maintenance margin | No mutation | Computes PnL, equity, margin ratio, liquidatable flag | None | No change | Yes |
| Close profitable | Position exists; market matches; same-side OI sufficient; caller supplies close price | Vault records positive PnL; position closes | Settlement = margin + positive PnL | Available capital decreases | Same-side OI decreases by size | Yes, except price source and solvency |
| Close losing | Same as close profitable | Vault records negative PnL; position closes | Settlement = margin + negative PnL, possibly negative | Available capital increases | Same-side OI decreases by size | Yes, except negative payout semantics |
| Liquidate profitable/impossible cases if relevant | Formula allows liquidation if margin ratio below maintenance margin; profitable positions normally raise equity, so liquidation is unlikely unless margin/size/threshold makes ratio low | If liquidatable, vault records PnL and position closes | Trader receives `max(equity, 0)` | Positive PnL reduces capital | Same-side OI decreases | Formula defined; economic intent UNDEFINED |
| Liquidate losing | Position exists; market matches; `marginRatio < maintenanceMargin` | Vault records negative PnL; position closes | Trader receives remaining margin floored at zero | Available capital increases | Same-side OI decreases | Yes, except incentives/penalties |
| Capacity rejection | `getTotalOpenInterest + stepSize > maxCapacity + tolerance` during open simulation | `simulateTrade` throws before commit | No position opened | None | No OI change | Yes |

# 9. Invariants Already Present

- Total OI cannot exceed configured capacity through `simulateTrade`.
  - Source: `canIncreaseExposure` in `src/amm/Capacity.ts`; `simulateTrade` in `src/simulation/TradeSimulator.ts`.
  - Tests: `tests/protocolInvariants.test.ts`, `tests/capacityBoundary.test.ts`, `tests/capacityIntegration.test.ts`, `tests/failedTrade.test.ts`.

- Failed capacity trade does not partially mutate market state or create a position.
  - Source: `simulateTrade` uses `workingState` and commits only after all steps pass.
  - Tests: `tests/failedTrade.test.ts`, `tests/capacityBoundary.test.ts`.

- Closing releases same-side OI and removes the position.
  - Source: `closePosition` in `src/position/ClosePosition.ts`.
  - Tests: `tests/closePosition.test.ts`, `tests/protocolInvariants.test.ts`, `tests/positionOiConsistency.test.ts`.

- Closing cannot release more same-side OI than exists.
  - Source: `closePosition` checks `market.longOpenInterest < position.size` and `market.shortOpenInterest < position.size`.
  - Tests: `tests/closePosition.test.ts`.

- Settlement cannot happen for a missing position in the combined close path.
  - Source: `settleAndClosePosition`.
  - Tests: `tests/settleAndClosePosition.test.ts`.

- Market mismatch is rejected for close and combined settlement paths.
  - Source: `closePosition`, `settleAndClosePosition`, `settleAndLiquidatePosition`.
  - Tests: direct coverage appears incomplete for the settlement functions; close behavior is established in source.

- Liquidation requires strict margin ratio below maintenance margin.
  - Source: `isLiquidatable` in `src/risk/Liquidation.ts`.
  - Tests: `tests/liquidation.test.ts`, `tests/liquidationBoundary.test.ts`.

- Healthy liquidation attempts do not close the position.
  - Source: `liquidatePosition`, `settleAndLiquidatePosition`.
  - Tests: `tests/liquidationExecution.test.ts`, `tests/settleAndLiquidatePosition.test.ts`.

- Liquidation releases OI and removes the position.
  - Source: `liquidatePosition`, `settleAndLiquidatePosition`, both via `closePosition`.
  - Tests: `tests/liquidationExecution.test.ts`, `tests/liquidationSettlement.test.ts`, `tests/settleAndLiquidatePosition.test.ts`, `tests/positionOiConsistency.test.ts`.

- Vault accounting identity is maintained: `availableCapital == totalDeposited - traderPnL + premiums`.
  - Source: `recordTraderPnL`, `depositLP`, `addPremium`, `getLpEquity`.
  - Tests: `tests/liquidityVault.test.ts`, `tests/liquidityVaultInvariant.test.ts`.

- TWAP requires complete 15-minute history and rejects invalid observations.
  - Source: `calculateTWAP`, `recordPriceObservation`, `SimulatedPriceFeed`.
  - Tests: `tests/protocolInvariants.test.ts`, `tests/twap.test.ts`, `tests/priceFeedService.test.ts`.

# 10. Missing Economic Invariants

- Protocol invariant: realized positive trader PnL <= available LP backing.
  - Status: ENFORCED for close/liquidation commits and direct `recordTraderPnL` updates.
  - Evidence: `prepareTraderPnL` rejects negative resulting `availableCapital`; `tests/endToEndSettlement.test.ts` and `tests/vaultSolvency.test.ts` verify atomic rejection and exact-backing success.
- Protocol invariant: all liabilities from open positions are reserved against LP backing.
  - Status: NOT ENFORCED.
  - Evidence: no unrealized-liability reserve or global liability aggregation is implemented.

- Protocol invariant: settlement payout cannot be negative to trader on voluntary close.
  - Status: NOT ENFORCED.
  - Evidence: `calculatePositionSettlement` returns `position.margin + pnl` without flooring.

- Protocol invariant: opening a position should validate `size > 0`, `steps > 0`, and `margin > 0`.
  - Status: NOT ENFORCED in `simulateTrade`.
  - Evidence: no explicit validation before `stepSize = size / steps` and leverage calculation.

- Protocol invariant: a position id must be unique or opening the same id must be rejected.
  - Status: NOT ENFORCED.
  - Evidence: `PositionManager.openPosition` overwrites map entries.

- Protocol invariant: total market OI should equal sum of open position sizes by side.
  - Status: PARTIALLY ESTABLISHED BY TESTS, NOT CENTRALLY ENFORCED.
  - Evidence: `PositionManager.openPosition` does not update OI, and market OI can be manually assigned.

- Protocol invariant: LP capital should be debited only after settlement is payable.
  - Status: NOT ENFORCED.
  - Evidence: settlement functions call `recordTraderPnL` without checking vault capital.

- Economic security condition: TWAP manipulation cost > maximum extractable profit.
  - Status: NOT ENFORCED.
  - Evidence: experiments and tests such as `tests/attackEconomics.test.ts`, `tests/twapExtractionIntegration.test.ts`, and experiment scripts study manipulation economics, but no opening, closing, or settlement gate enforces this inequality.

- Economic security condition: capacity pricing and max capacity should jointly bound insolvency.
  - Status: EXPERIMENTAL OBSERVATION ONLY.
  - Evidence: docs and experiments describe capacity stress and parameter sweeps; current settlement accepts insolvency.

# 11. Contradictions / Ambiguities

- Documentation in `docs/research-report.md` originally describes LONG price as `indexPrice * (1 + totalImpact)` and SHORT price as `indexPrice * (1 - totalImpact)`, while current `ImpactModel` separates skew into fair value and capacity into a symmetric spread around fair value.

- `docs/01-market-engine.md` lists positions, PnL, margin, liquidation, and oracle as "Not implemented", but the current source now implements prototype versions of all of these.

- `src/market/Market.ts` defines a separate `Market` class with `indexPrice`, `markPrice`, and `fundingRate`, while the rest of the economic engine uses `src/market/MarketState.ts` with `indexPrice`, `ammTwapPrice`, and side OI. The authoritative market representation is ambiguous.

- `PositionSettlement.calculatePositionSettlement` returns negative `traderSettlement` when losses exceed margin, while `settleAndLiquidatePosition` floors liquidation settlement at zero.

- `LiquidationEngine.liquidatePosition` closes and returns liquidation results but does not update the LP vault; `SettleAndLiquidatePosition` performs both liquidation and vault accounting. Tests cover both styles, so responsibility is split.

- Opening uses `getAverageExecutionPrice`, while other code exposes `getExecutionPrice`, `getBoundedExecutionPrice`, and `getConvexExecutionPrice`. The canonical execution formula is ambiguous outside `simulateTrade`.

- `simulateTrade` imports `getExecutionPrice` but does not use it.

- `LiquidityVault.addPremium` exists and tests it, but trade opening and settlement flows do not collect premiums. The source of premiums is undefined.

- The close flow takes a supplied `currentPrice`; liquidation sweep uses skew-adjusted AMM price. The canonical close mark price is undefined.

# 12. Decisions Required Before Implementation

- P0: Define the solvency invariant: whether `maximum LP liability <= available LP capital` must be enforced at open, close, liquidation, or by capacity configuration.

- P0: Define the authoritative price source for close and liquidation settlement: supplied current price, AMM TWAP, skew-adjusted AMM price, index price, or another explicitly modeled source.

- P0: Decide whether voluntary close settlement can be negative or must be floored at zero like liquidation settlement.

- P0: Decide the canonical market state type: `MarketState` with AMM TWAP and OI, or `Market` with mark price/funding, or a merged model.

- P1: Choose the canonical execution pricing function for opening trades and retire or classify the experimental alternatives.

- P1: Define premium collection: whether premiums exist economically, when they are charged, and whether they are part of execution price, LP accounting, or both.

- P1: Define whether `PositionManager.openPosition` is allowed to overwrite ids and whether opening validates size, margin, and step count.

- P1: Define whether liquidation settlement is only a close action or also a vault settlement action; currently both styles exist.

- P2: Decide whether funding rate in `Market.ts` is in scope for this prototype.

- P2: Decide how experimental manipulation results should be represented: protocol invariant, economic security condition, or research-only metric.

# 13. Final State Machine

```text
Trader
  |
  v
Open request
  |
  v
Leverage check
  |
  v
Capacity check per step
  |\
  | \-- reject -> no OI change, no position
  v
Average execution price
  |
  v
Commit OI increase
  |
  v
Create Position
  |
  v
Position Active
  |
  v
Mark / PnL / equity / margin ratio
  |\
  | \-- Healthy -> Continue or Voluntary Close
  |                  |
  |                  v
  |             Settle at supplied price
  |                  |
  |                  v
  |             Record trader PnL in LP vault
  |                  |
  |                  v
  |             Release same-side OI
  |                  |
  |                  v
  |             Remove position
  |
  \-- Liquidatable
        |
        v
   Record trader PnL in LP vault
        |
        v
   Release same-side OI
        |
        v
   Remove position
        |
        v
   Trader receives max(equity, 0)
```

# 1. List Every Price

- External/index price
  - Meaning: the repository sometimes describes a reference external price called index price.
  - Status: PARTIALLY DEFINED.
  - Classification: PAPER-SUPPORTED as a general oracle/reference concept; EXPLICIT PROJECT ASSUMPTION for the `indexPrice` field.

- `indexPrice`
  - Meaning: latest reference observation applied by `updateMarketFromReferencePrice`; test fixtures and experiments may also set it directly.
  - Status: defined for the reference-price pipeline, but not a production settlement input.
  - Classification: EXPLICIT PROJECT ASSUMPTION; UNDEFINED as an authoritative protocol price.

- AMM spot/current price
  - Meaning: in current source, this is represented by `getCurrentAmmPrice`, not by a stored pool reserve spot.
  - Status: PARTIALLY DEFINED.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- `ammTwapPrice`
  - Meaning: field on `MarketState` containing the 15-minute arithmetic TWAP of reference observations.
  - Status: DEFINED in code.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- `getCurrentAmmPrice`
  - Meaning: skew-adjusted protocol mark derived from the reference TWAP in `ammTwapPrice`.
  - Status: DEFINED in code.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- Execution price
  - Meaning: price quoted for a trade step. Several functions produce execution-like prices.
  - Status: PARTIALLY DEFINED. `simulateTrade` canonically uses `getAverageExecutionPrice`.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- Average execution price
  - Meaning: for each step, `getAverageExecutionPrice`; for the final position, `totalCost / totalSize`.
  - Status: DEFINED for opening.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- Bounded execution price
  - Meaning: alternative function `getBoundedExecutionPrice` using bounded linear capacity impact.
  - Status: experimental/unused by opening.
  - Classification: EXPLICIT PROJECT ASSUMPTION for code existence; UNDEFINED as protocol authority.

- Convex execution price
  - Meaning: alternative function `getConvexExecutionPrice` using `indexPrice` and squared absolute skew ratio.
  - Status: experimental/unused by opening.
  - Classification: EXPLICIT PROJECT ASSUMPTION for code existence; UNDEFINED as protocol authority.

- Entry price
  - Meaning: `Position.entryPrice`; set to the final average execution price in `simulateTrade`.
  - Status: DEFINED for positions opened through `simulateTrade`.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- Mark price
  - Meaning: price passed to `markPosition`; source depends on caller. `runLiquidationSweep` uses `getCurrentAmmPrice`.
  - Status: PARTIALLY DEFINED.
  - Classification: EXPLICIT PROJECT ASSUMPTION for function behavior; UNDEFINED as global authority.

- Close price
  - Meaning: `getSettlementPrice(market, config)`, delegating to `getCurrentAmmPrice`.
  - Status: canonical production settlement source.
  - Classification: UNDEFINED.

- Liquidation price
  - Meaning: `getSettlementPrice(market, config)`, snapshotted before OI release.
  - Status: same canonical production source as voluntary close.
  - Classification: EXPLICIT PROJECT ASSUMPTION for sweep behavior; UNDEFINED globally.

- Recovery price
  - Meaning: experiment variable used as mark/settlement price after manipulated TWAP recovers.
  - Status: experimental input.
  - Classification: EXPLICIT PROJECT ASSUMPTION inside experiments; UNDEFINED as protocol authority.

- Supplied `currentPrice`
  - Meaning: raw function argument used for PnL in settlement and liquidation functions.
  - Status: caller-defined.
  - Classification: EXPLICIT PROJECT ASSUMPTION for current implementation; UNDEFINED as safe price authority.

# 2. External Price

`indexPrice` stores the latest reference observation when using
`updateMarketFromReferencePrice`; direct assignments in tests/experiments are
not an oracle update. Production settlement/liquidation price comes from the
TWAP-backed protocol mark, not directly from `indexPrice`.

- Is it the external asset price?
  - It is the latest validated reference observation provided by an abstract source.
  - Classification: EXPLICIT PROJECT ASSUMPTION; the real source is not integrated/authenticated.

- Is it the external AMM price?
  - No production external AMM is implemented. `ammTwapPrice` stores the TWAP of reference observations.
  - Classification: OUR INFERENCE.

- Is it merely a reference variable?
  - Yes in most current economic paths. `simulateTrade` uses `state.indexPrice` only when building the temporary leverage-check position; the actual execution price uses `ammTwapPrice`.
  - Classification: OUR INFERENCE.

- Is it used during execution?
  - Not in canonical opening execution. `simulateTrade` imports `getExecutionPrice` but uses `getAverageExecutionPrice`, which reads `ammTwapPrice`. The unused `getConvexExecutionPrice` uses `indexPrice`.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- Is it used during settlement?
  - No. Settlement derives a protocol mark from `ammTwapPrice` and OI skew.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

- Is it used during liquidation?
  - No. Liquidation derives the same protocol mark as settlement.
  - Classification: EXPLICIT PROJECT ASSUMPTION.

# 3. AMM TWAP

Production reference path:

```text
ReferencePriceSource.getLatestObservation()
  -> validate and recordPriceObservation
  -> calculateTWAP
  -> update indexPrice and (only when complete) ammTwapPrice
  -> MarketState.ammTwapPrice
```

The protocol mark and settlement path is:

```text
ammTwapPrice + current OI skew
  -> getCurrentAmmPrice
  -> getSettlementPrice
  -> close / liquidation
```

Simulation-only sources:

- `SimulatedPriceFeed` and `SimulatedPriceFeedService.ts` are in-memory test/research adapters implementing `ReferencePriceSource`; they are not authenticated production external oracles.
- `SimulatedProtocolMarkObservation.ts` exports `recordSimulatedProtocolMarkObservation`, which intentionally records a protocol-derived mark to study the feedback loop. It is never used by production settlement as an oracle source.
- `advanceSimulation` is a simulation loop and deliberately uses that adapter.

Observation history uses `recordPriceObservation`, a pure operation that
returns a sorted/pruned copy. Invalid updates do not mutate the old history
or market. At a repeated timestamp, the latest value replaces the existing
point; backward timestamps are rejected.

How production TWAP is calculated:

```text
windowStart = now - 900
weightedPrice = sum(observation.price * intervalDuration)
TWAP = weightedPrice / 900
```

It is arithmetic, not geometric. The tests in `tests/twapExtractionIntegration.test.ts` explicitly use arithmetic examples such as 840 seconds at 100 plus 60 seconds at 1000 producing TWAP 160.

Window length:

```text
TWAP_WINDOW = 15 * 60 = 900 seconds
```

Whether observations are time-weighted:

- Yes. Each observation contributes over the interval until the next observation or `now`.
- Classification: EXPLICIT PROJECT ASSUMPTION.

Incomplete history:

- `calculateTWAP` returns `null` when no observation exists at or before `windowStart`.
- `updateAmmTwap` leaves the market state unchanged when TWAP is `null`.

Can TWAP move arbitrarily in the current model?

- Inputs reject non-finite and non-positive prices, but there is no upper bound. Therefore TWAP can become arbitrarily large if supplied observations are arbitrarily large and sustained long enough.
- Classification: OUR INFERENCE.

# 4. Current AMM Price

`getCurrentAmmPrice` equation:

```text
skew = longOpenInterest - shortOpenInterest
skewRatio = skew / maxCapacity
skewImpact = skewCoefficient * skewRatio

currentAmmPrice = ammTwapPrice * (1 + skewImpact)
```

What it represents:

- A. oracle/TWAP value: no. It is derived from TWAP but includes skew.
- B. execution price: no. It lacks capacity spread and side-specific bid/ask behavior.
- C. mark price: yes. Production close, liquidation, and the liquidation sweep use it through `getSettlementPrice`.
- D. skew-adjusted protocol price: yes.
- E. something else: `recordSimulatedProtocolMarkObservation` records it only in a clearly named research simulation adapter; it is not a production reference observation.

Classification: EXPLICIT PROJECT ASSUMPTION.

# 5. Execution Price

Actual opening path:

```text
simulateTrade
  -> canIncreaseExposure
  -> getAverageExecutionPrice
  -> applyExposure on workingState
  -> averagePrice = totalCost / totalSize
  -> Position.entryPrice = averagePrice
```

Inputs:

- `MarketState`
- side: `LONG` or `SHORT`
- size and step count
- `MarketConfig`

Formula used by `simulateTrade`:

```text
skew = longOpenInterest - shortOpenInterest
skewRatio = skew / maxCapacity
totalOI = longOpenInterest + shortOpenInterest
capacityUsage = totalOI / maxCapacity

fairValue = ammTwapPrice * (1 + skewCoefficient * skewRatio)
capacityImpact = capacityCoefficient * (capacityUsage / (1 - capacityUsage)) / 2

LONG step price = fairValue * (1 + capacityImpact)
SHORT step price = fairValue * (1 - capacityImpact)
```

Pre-trade or post-trade OI:

- Each step is priced from the current `workingState` before that step's exposure is applied.
- The next step sees the updated OI.
- Classification: EXPLICIT PROJECT ASSUMPTION.

Capacity:

- Capacity affects price through `capacityImpact`.
- Capacity also rejects trades through `canIncreaseExposure`.

Skew:

- Skew affects fair value through signed `skewRatio`.

Step behavior:

- Price changes step-by-step as `workingState` OI changes.

Average entry:

```text
totalCost = sum(stepPrice * stepSize)
averagePrice = totalCost / totalSize
Position.entryPrice = averagePrice
```

Alternative pricing functions:

| Function | Classification | Reason |
|---|---|---|
| `getAverageExecutionPrice` | canonical for opening | Used by `simulateTrade`. |
| `getExecutionPrice` | unclear / unused by opening | Full capacity spread around fair value; used in older experiments/tests, not canonical open path. |
| `getBoundedExecutionPrice` | experimental | Bounded linear capacity impact; not used by opening. |
| `getConvexExecutionPrice` | experimental / unused | Uses `indexPrice` and convex skew; not used by opening. |
| `getCurrentAmmPrice` | not execution price | Canonical protocol mark; used by production settlement. A separate named simulation adapter may record it for experiments. |

# 6. Entry Price

`Position.entryPrice` is the average execution price from opening through `simulateTrade`.

It is not:

- the mark price;
- the raw TWAP;
- the oracle/index price;
- `getCurrentAmmPrice`.

It is later used by PnL:

```text
LONG PnL = (currentPrice - entryPrice) * size
SHORT PnL = (entryPrice - currentPrice) * size
```

Source: `calculateUnrealizedPnL`.

Classification: EXPLICIT PROJECT ASSUMPTION.

# 7. Mark Price

`markPosition(position, markPrice, maintenanceMargin)` remains a pure
calculation helper that accepts an already-derived price. Production
liquidation obtains the price internally from `getSettlementPrice`, which
delegates to `getCurrentAmmPrice`; `runLiquidationSweep` snapshots the same
helper's price once for eligibility and the batch transition. Callers cannot
set a production close/liquidation price.

# 8. Voluntary Close

`settleAndClosePosition(positionId, market, config, positionManager, vault)`
loads the OPEN position and snapshots `getSettlementPrice(market, config)`
before preparing the atomic close. The PnL calculation therefore uses the
pre-OI-release mark. The production caller cannot provide a price. Research
code that needs explicit scenario prices uses the separately named
`settleAndClosePositionAtPriceForSimulation`.

# 9. Liquidation

Production trace:

```text
settleAndLiquidatePosition / runLiquidationSweep
  -> getSettlementPrice(market, config)
  -> getCurrentAmmPrice(ammTwapPrice, OI skew)
  -> markPosition
  -> atomic liquidation settlement
```

Liquidation uses the same canonical mark as voluntary close. It is a mark,
not an opposite-side AMM execution price.

Does liquidation change AMM price?

- It changes OI through `closePosition`; after OI changes, a fresh `getCurrentAmmPrice` can differ because skew changed.
- `runLiquidationSweep` snapshots `capacityAfter.markPrice` after liquidations.

Does liquidation affect TWAP observations?

- The production reference-price updater does not observe protocol marks. The explicitly simulation-only `advanceSimulation` can feed a protocol mark into `recordSimulatedProtocolMarkObservation` to study feedback behavior.

# 10. Recovery Price

Recovery experiments use `recoveryPrice` or `RECOVERY_TWAP` as a scenario input.

Examples:

- `experiments/survivalRecovery.ts`
  - `RECOVERY_PRICE = 100`
  - It linearly checks marks from `TARGET_TWAP` to `RECOVERY_PRICE`.
  - It passes `RECOVERY_PRICE` directly to `settleAndClosePosition`.

- `experiments/perpsAttackSimulation.ts`
  - `RECOVERY_TWAP = 100`
  - Comments say "The oracle recovers from 95 -> 100."
  - It passes `RECOVERY_TWAP` directly as close settlement price.

- `experiments/recoverySensitivity.ts`
  - `RECOVERY_PRICES = [80, 85, 90, 95, 100, 105, 110, 120]`
  - Each `recoveryPrice` is passed to `settleAndClosePosition`.

Meaning:

- In narrative, recovery price often means external market/TWAP recovery.
- In implementation, it is a direct protocol settlement price input.
- It is not derived through `TWAPOracle` in these recovery experiments.

Classification: EXPLICIT PROJECT ASSUMPTION inside experiments; UNDEFINED as final protocol semantics.

# 11. Price Dependency Graph

Production implementation:

```text
Abstract reference price source
      |
      v
updateMarketFromReferencePrice
      |
      v
validated observation history
      |
      v
arithmetic 900-second TWAP
      |
      +--> MarketState.indexPrice (latest reference)
      +--> MarketState.ammTwapPrice (only on complete history)
                         |
                         v
                  getCurrentAmmPrice
                         |
                         v
                 getSettlementPrice
                    /          \
                   v            v
                close       liquidation
```

`recordSimulatedProtocolMarkObservation` is not in the production graph. It
intentionally models the feedback path for experiments only.

```text
protocol mark -> simulated observation -> simulated TWAP
```

An actual external provider and authentication are not implemented; the
production-facing abstraction accepts a reference observation and validates
its value and timestamp.

The repository does not fully specify whether settlement should use index price, TWAP, skew-adjusted AMM price, or another source.

# 12. Price Authority Table

| Price | Meaning | Source | Used By | Mutable By | Canonical? | Status |
|---|---|---|---|---|---|---|
| external/reference price | Latest input from abstract source | `ReferencePriceSource` observation | TWAP input; `indexPrice` update | Source implementation not provided | Input authority abstract | Defined pipeline, source absent |
| `indexPrice` | Latest validated reference observation | `updateMarketFromReferencePrice` | A few legacy/experimental consumers | Oracle service or direct test/experiment setup | No | Defined as reference |
| `Market.markPrice` | Separate class mark field | `src/market/Market.ts` | `Market` getters/setters only | `setMarkPrice` | No | AMBIGUOUS |
| `ammTwapPrice` | 900-second arithmetic TWAP of reference observations | `updateMarketFromReferencePrice` / `updateAmmTwap` | execution pricing and protocol mark | TWAP update or direct test/experiment setup | Yes as opening base | DEFINED |
| observation price | Raw time-stamped external/reference value | abstract source; simulated feed in tests | TWAP calculation | source adapter | No | Validated input |
| `getCurrentAmmPrice` | skew-adjusted reference TWAP | `ammTwapPrice`, OI, config | production settlement/liquidation mark | market OI/TWAP/config | Yes, via shared helper | DEFINED |
| `getAverageExecutionPrice` | canonical opening step quote | `ammTwapPrice`, OI, config | `simulateTrade` | market/config | Yes for open | DEFINED |
| `getExecutionPrice` | alternate execution quote | `ammTwapPrice`, OI, config | experiments/tests | market/config | No | UNCLEAR |
| `getBoundedExecutionPrice` | bounded capacity quote | `ammTwapPrice`, OI, config | experiments/tests | market/config | No | EXPERIMENTAL |
| `getConvexExecutionPrice` | convex skew quote | `indexPrice`, OI, config | experiments/tests | market/config | No | EXPERIMENTAL |
| `Position.entryPrice` | average opening price | `simulateTrade` | PnL | created at open | Yes for PnL basis | DEFINED |
| mark price | PnL/risk marking input | canonical `getSettlementPrice` in production | `markPosition`, liquidation | market OI/TWAP/config | Yes | DEFINED |
| close price | voluntary settlement input | `getSettlementPrice` | `settleAndClosePosition` | market OI/TWAP/config | Yes | DEFINED |
| liquidation price | liquidation mark input | `getSettlementPrice` | liquidation settlement/sweep | market OI/TWAP/config | Yes | DEFINED |
| recovery price | experiment scenario settlement/mark price | constants/loops in experiments | recovery experiments | experiment author | No | EXPERIMENTAL |
| supplied `currentPrice` | explicit price in research simulation APIs | experiment code | named simulation settlement | experiment author | No | SIMULATION ONLY |

# 13. Critical Contradictions

- `indexPrice` vs `ammTwapPrice`
  - `indexPrice` holds the latest reference observation; production execution and mark use `ammTwapPrice`, the complete-window TWAP.

- TWAP vs skew-adjusted AMM price
  - `ammTwapPrice` is the time-weighted base. `getCurrentAmmPrice` adds skew. Tests sometimes have them equal only when skew is zero.

- Mark vs close price
  - Production liquidation and voluntary close both use the shared canonical `getSettlementPrice`.

- Execution vs settlement
  - Opening executes through stepwise AMM pricing. Closing does not execute an opposite AMM trade and does not use an execution price.

- Protocol mark observations
  - `recordSimulatedProtocolMarkObservation` creates a feedback loop only in explicit simulation/research; production reference observation ingestion does not consume protocol state.

- Different pricing functions
  - `getAverageExecutionPrice` is canonical for opening, but `getExecutionPrice`, `getBoundedExecutionPrice`, and `getConvexExecutionPrice` remain available and used by experiments/tests.

- Different market state types
  - `src/market/Market.ts` has `indexPrice`, `markPrice`, and `fundingRate`; `src/market/MarketState.ts` has `indexPrice`, `ammTwapPrice`, and OI. The economic engine mostly uses `MarketState.ts`.

- Production source authentication
  - `ReferencePriceSource` is an abstraction only. No external source implementation, signing, or authentication is present. Simulation can separately feed the protocol mark back into its observations.

# 14. Solvency Implication

The production price authority path is now defined in code as a validated
reference observation, complete-window arithmetic TWAP, then skew-adjusted
protocol mark for settlement and liquidation. This does not authenticate or
connect an actual external source, define stale/outage recovery, bound
settlement movement, or prove solvency for all allowed price paths.

# 15. Final Verdict

1. What is the canonical external reference price?

An observation returned by the abstract `ReferencePriceSource`; no actual or authenticated provider is implemented.

2. What is the canonical TWAP?

`MarketState.ammTwapPrice`, updated from an arithmetic 900-second reference-observation TWAP when complete. Experiments/tests may directly set state.

3. What is the canonical execution price?

For opening through `simulateTrade`, canonical execution is `getAverageExecutionPrice` step-by-step, with position entry as `totalCost / totalSize`.

4. What is the canonical mark price?

`getCurrentAmmPrice`, used via `getSettlementPrice` for production close, liquidation, and sweep.

5. What is the canonical settlement price?

`getSettlementPrice`, delegating to `getCurrentAmmPrice`.

6. Are voluntary close and liquidation using the same price semantics?

Yes. Both snapshot the same canonical protocol mark before lifecycle/OI mutation.

7. Can settlement price currently be controlled by the caller?

No. Production close/liquidation APIs derive the price internally. Explicit prices remain in clearly named simulation helpers.

8. Is the price model sufficiently defined to proceed to solvency design?

No. Opening price is defined, but settlement and mark price authority are only partially defined or undefined.

```text
PRICE SEMANTICS STATUS:
PRODUCTION PIPELINE DEFINED; SOURCE AUTHENTICATION / LIVENESS DEFERRED
```

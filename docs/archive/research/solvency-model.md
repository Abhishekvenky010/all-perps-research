# 1. Existing Economic Model

- IMPLEMENTED CHECKPOINT: realized settlement PnL is now rejected before commit if applying it would make `availableCapital` negative. This is an accounting guard for close/liquidation, not a reserve for unrealized positions or proof of actual asset custody. `Position.margin` remains outside LP backing; negative PnL still credits available capital without proving collection. Historical counterexamples below describe the pre-guard behavior unless explicitly marked otherwise.
- PAPER-SUPPORTED: the research goal is to make oracle/TWAP manipulation economically unprofitable, expressed in the repository as `attack cost > attacker profit`.
- EXPLICIT PROJECT ASSUMPTION: LP capital is the sole implemented backstop. `LiquidityVault` is the only capital pool used by settlement.
- EXPLICIT PROJECT ASSUMPTION: trader profits are paid by the LP vault. `recordTraderPnL(vault, pnl)` subtracts positive trader PnL from `availableCapital`.
- EXPLICIT PROJECT ASSUMPTION: trader losses increase LP equity. Negative trader PnL increases `availableCapital`.
- EXPLICIT PROJECT ASSUMPTION: Open Interest is bounded by `maxCapacity` through `canIncreaseExposure`.
- EXPLICIT PROJECT ASSUMPTION: progressive skew/capacity pricing increases execution cost as skew and capacity usage rise.
- EXPLICIT PROJECT ASSUMPTION: TWAP manipulation cost must exceed extractable profit. Existing experiments model this with an external constant-product cost assumption.
- UNDEFINED: the All Perps paper/research in this repository does not define an LP vault capital formula, insurance fund, payout cap, or capital-to-capacity ratio.

# 2. Current Mathematical Model

Implementation sources: `src/market/MarketMath.ts`, `src/amm/Pricing.ts`, `src/amm/ImpactModel.ts`, `src/risk/PnL.ts`, `src/risk/Margin.ts`, `src/risk/Liquidation.ts`, `src/liquidity/LiquidityVault.ts`, and `src/simulation/TradeSimulator.ts`.

Current market equations:

```text
skew = longOI - shortOI

totalOI = longOI + shortOI

skewRatio = skew / maxCapacity

capacityUsage = totalOI / maxCapacity
```

Capacity check:

```text
totalOI + tradeStepSize <= maxCapacity + tolerance
```

Canonical opening execution formula used by `simulateTrade`:

```text
fairValue = ammTwapPrice * (1 + skewCoefficient * skewRatio)

capacityImpact = capacityCoefficient * (capacityUsage / (1 - capacityUsage)) / 2

LONG average-step price = fairValue * (1 + capacityImpact)

SHORT average-step price = fairValue * (1 - capacityImpact)
```

`simulateTrade` splits a trade into steps, prices each step with `getAverageExecutionPrice`, mutates a copied market state, then commits the final OI and creates the position. Classification: EXPLICIT PROJECT ASSUMPTION.

Other implemented pricing formulas:

```text
getExecutionPrice:
  fairValue = ammTwapPrice * (1 + skewCoefficient * skewRatio)
  capacityImpact = capacityCoefficient * (capacityUsage / (1 - capacityUsage))
  LONG = fairValue * (1 + capacityImpact)
  SHORT = fairValue * (1 - capacityImpact)

getBoundedExecutionPrice:
  fairValue = ammTwapPrice * (1 + skewCoefficient * skewRatio)
  boundedCapacityImpact = maxImpact * capacityUsage
  LONG = fairValue * (1 + boundedCapacityImpact)
  SHORT = fairValue * (1 - boundedCapacityImpact)

getConvexExecutionPrice:
  impact = skewCoefficient * abs(skewRatio)^2
  LONG = indexPrice * (1 + impact)
  SHORT = indexPrice * (1 - impact)

getCurrentAmmPrice:
  ammTwapPrice * (1 + skewCoefficient * skewRatio)
```

Classification: EXPLICIT PROJECT ASSUMPTION for their existence; only `getAverageExecutionPrice` is canonical for `simulateTrade`.

Risk and settlement equations:

```text
LONG PnL = (currentPrice - entryPrice) * size

SHORT PnL = (entryPrice - currentPrice) * size

traderEquity = margin + PnL

marginRatio = traderEquity / size

liquidatable = marginRatio < maintenanceMargin

voluntaryCloseTraderSettlement = margin + PnL

liquidationTraderSettlement = max(margin + PnL, 0)

LP equity = totalDeposited - traderPnL + premiums

availableCapital is updated by:
  availableCapital -= traderPnL
```

Classification: EXPLICIT PROJECT ASSUMPTION.

# 3. Why OI Capacity Is Not Enough

The capacity invariant is:

```text
totalOI <= maxCapacity
```

The solvency condition is:

```text
trader payout <= LP capital
```

These are not the same type of statement. `totalOI` bounds notional position size. Trader payout depends on price movement after entry:

```text
traderProfit = size * favorablePriceMove
```

So even if:

```text
size <= maxCapacity
```

there is no solvency conclusion unless favorable price movement is also bounded.

Concrete repository example: `experiments/perpsAttackSimulation.ts` and `experiments/survivalRecovery.ts`.

The scenario uses:

```text
LP capital = 50,000
maxCapacity = 100,000
attacker size = 30,000
manipulated TWAP = 95
recovery price = 100
```

The position is only 30% of capacity:

```text
30,000 <= 100,000
```

Using the current five-step `getAverageExecutionPrice` path, the approximate LONG entry prices are:

```text
95.00, 96.29, 97.61, 98.96, 100.35
```

So:

```text
averageEntryPrice ≈ 97.64
traderProfit at 100 ≈ (100 - 97.64) * 30,000
traderProfit ≈ 70,700
```

That profit exceeds the 50,000 LP vault:

```text
70,700 > 50,000
```

Classification: EXPLICIT PROJECT ASSUMPTION for the equations and scenario parameters; OUR INFERENCE for the solvency conclusion.

The capacity bound prevented the position from exceeding 100,000 OI. It did not bound the price recovery term. Therefore it did not prevent trader profit from exceeding LP capital.

# 4. Maximum Liability Function

A useful liability expression for one open position is:

```text
L = max(PnL, 0)
```

For a LONG:

```text
L_long(size, entryPrice, closePrice)
  = max((closePrice - entryPrice) * size, 0)
```

For a SHORT:

```text
L_short(size, entryPrice, closePrice)
  = max((entryPrice - closePrice) * size, 0)
```

With capacity:

```text
size <= C
```

So a generic upper expression is:

```text
L(C, P, parameters)
  <= C * max(favorablePriceMove(P, parameters), 0)
```

This becomes finite only if the model supplies a finite bound on favorable price movement. Production settlement now derives a canonical price from the reference TWAP and protocol skew, but there is no protocol-level maximum close price, minimum close price, TWAP movement bound, or oracle range bound.

Therefore:

```text
The current mechanism does not mathematically bound LP liability.
```

Classification: OUR INFERENCE from EXPLICIT PROJECT ASSUMPTION equations.

If an external price movement bound were explicitly fixed, then a conditional bound could be written. Example:

```text
If LONG closePrice <= Pmax:
  L_long <= C * max(Pmax - minEntryPrice, 0)

If SHORT closePrice >= Pmin:
  L_short <= C * max(maxEntryPrice - Pmin, 0)
```

But `Pmax`, `Pmin`, and a canonical settlement price source are currently UNDEFINED.

# 5. Relationship Between LP Capital and Capacity

The project has an explicit prototype idea that LP capital and `maxCapacity` must be related, but the current implementation does not define the relation.

A safe relationship would need a proof of the form:

```text
maxLiability(maxCapacity, priceBounds, parameters) <= LP capital
```

The current experiments show observed ratios under selected scenarios. For example, `experiments/capacityLpRequirement.ts`, `experiments/twapSeverityCapacitySweep.ts`, and `experiments/recoverySensitivity.ts` measure required LP capital under selected TWAP and recovery assumptions.

Those sweeps are empirical observations. They do not define:

```text
maxCapacity <= f(LP capital)
```

because the missing term is the maximum favorable settlement price movement.

Classification: EXPLICIT PROJECT ASSUMPTION that a relationship is needed; OUR INFERENCE that no defensible function can be derived from current equations alone.

No 2:1, 1:2, or other fixed ratio is defensible from the current mechanism without adding a bound on settlement price movement and the canonical settlement price source.

# 6. Role of Margin

Current leverage check:

```text
leverage = size / margin
leverage <= maxLeverage
```

This implies:

```text
margin >= size / maxLeverage
```

Current liquidation check:

```text
equity = margin + PnL
marginRatio = equity / size
liquidatable = marginRatio < maintenanceMargin
```

For a LONG at mark price `M`:

```text
equity = margin + (M - entryPrice) * size
```

The position survives if:

```text
(margin + (M - entryPrice) * size) / size >= maintenanceMargin
```

Rearranged:

```text
margin >= maintenanceMargin * size - (M - entryPrice) * size
```

This can prevent a low-margin position from surviving an adverse mark. It does not bound LP liability if the trader can post enough margin to survive and later close at a favorable price.

The recovery experiments intentionally compute or choose enough margin to survive the manipulated TWAP. `experiments/recoverySensitivity.ts` calculates required margin with a survival buffer. `experiments/perpsAttackSimulation.ts` uses 80,800 margin for a 30,000 position, far above the minimum leverage requirement.

Margin plus liquidation bounds liability only under extra assumptions:

```text
1. marks are checked continuously or before recovery close;
2. the adverse path forces liquidation before favorable settlement;
3. margin is capped or otherwise economically constrained;
4. settlement prices cannot jump around liquidation checks.
```

Those assumptions are not fully implemented as protocol invariants.

Conclusion: margin/liquidation can reject some scenarios, but it does not mathematically guarantee solvency under the current equations. Classification: OUR INFERENCE.

# 7. Role of Progressive Skew

Progressive skew/capacity pricing affects entry price. It does not directly cap close settlement.

Entry cost:

```text
entryPrice = stepwise average of getAverageExecutionPrice
```

Mark price:

```text
getCurrentAmmPrice = ammTwapPrice * (1 + skewCoefficient * skewRatio)
```

Closing settlement:

```text
settleAndClosePosition(positionId, currentPrice, ...)
PnL = calculateUnrealizedPnL(position, currentPrice)
```

The close path does not execute an opposite-side AMM trade. It does not call `simulateTrade`, `getAverageExecutionPrice`, or `getExecutionPrice`. It settles directly at a supplied `currentPrice`.

For a LONG:

```text
profit = (closePrice - entryPrice) * size
```

Progressive skew can raise `entryPrice`, reducing profit for a given `closePrice`. But unless `closePrice - entryPrice` is bounded, profit is unbounded with respect to the price dimension.

Even with:

```text
size <= maxCapacity
```

there is no equation in the current implementation that enforces:

```text
closePrice - entryPrice <= LP capital / size
```

Classification: EXPLICIT PROJECT ASSUMPTION for pricing behavior; OUR INFERENCE that it does not prove solvency.

# 8. Worst-Case Position Analysis

Consider a trader who:

1. opens a position;
2. experiences an adverse price movement;
3. survives liquidation;
4. experiences recovery;
5. closes at a favorable price.

Current constraints:

- Position size: bounded by remaining capacity through `canIncreaseExposure`.
- Margin: lower-bounded by `maxLeverage`, but not upper-bounded.
- Leverage: must satisfy `size / margin <= maxLeverage`.
- Target TWAP: not bounded by protocol equations; experiments model manipulation cost externally.
- Recovery price: supplied to settlement; no protocol-level maximum is defined.

Protocol payout liability for one LONG:

```text
payoutLiability = max((recoveryPrice - entryPrice) * size, 0)
```

Under current constraints:

```text
size <= maxCapacity
recoveryPrice is UNDEFINED above
```

Therefore maximum protocol payout is not finite in the current mathematical model.

The attacker/trader cannot be assumed to manipulate the oracle for free. That is a separate cost model:

```text
externalManipulationCost = cost to move and sustain external AMM/TWAP
```

The protocol liability and external manipulation cost are different quantities:

```text
Protocol payout liability = amount LP vault must pay if settlement occurs

Economic attack profit = protocol payout liability - external manipulation cost - other costs
```

Classification: OUR INFERENCE. Existing attack-economics experiments study the second quantity, but solvency requires bounding the first.

# 9. Two Separate Security Conditions

Solvency:

```text
Maximum LP liability <= LP capital
```

Economic security:

```text
Cost of TWAP manipulation > extractable trader profit
```

Satisfying solvency does not automatically prove economic security. A solvent protocol could still allow a profitable oracle manipulation if the attacker extracts less than LP capital but more than manipulation cost.

Satisfying economic security does not automatically prove solvency. An attack may be unprofitable after external costs, while the raw protocol payout in a successful settlement can still exceed LP capital.

Existing tests such as `tests/attackEconomics.test.ts` assert that modeled manipulation cost exceeds modeled extraction for reachable scenarios. The comments in `experiments/solvencyBoundary.ts` explicitly state this does not prove arbitrary LP capital is sufficient or complete protocol solvency.

Classification: PAPER-SUPPORTED for the attack-cost condition as represented in repository research; OUR INFERENCE for the separation from solvency.

# 10. Can Current Mechanism Be Made Solvent?

Conclusion: C.

The existing mechanism is insufficient to establish solvency.

The missing mathematical property is a finite bound on maximum favorable settlement movement per unit of open interest, connected to LP capital:

```text
for all open positions:
  maxPositivePnL(position, allowedSettlementPrices) <= available LP capital
```

The current model has:

```text
size <= maxCapacity
```

but lacks:

```text
allowedSettlementPriceRange is finite and protocol-defined
```

and lacks:

```text
maxCapacity chosen from LP capital and price bounds
```

No mechanism is designed here. Classification: OUR INFERENCE.

# 11. Required Parameters

Minimum parameters needed before a solvency guarantee can be stated:

- `maxCapacity`: already implemented, relevant because it bounds size.
- LP capital / `availableCapital`: already implemented, relevant because it is the backstop.
- Canonical settlement price source: UNDEFINED, required because liability depends on close/liquidation price.
- Maximum favorable price movement or explicit settlement price bounds: UNDEFINED, required to make liability finite.
- Maximum leverage: implemented, relevant to survival and liquidation, but insufficient alone.
- Maintenance margin: implemented, relevant to liquidation boundary.
- Position size constraints beyond total capacity: partially implemented through capacity, but per-position limits are not separately defined.
- Pricing curve used for entry: implemented but ambiguous outside `simulateTrade`; required to compute entry price.
- TWAP window and observation rules: implemented for TWAP math, relevant to economic security and mark movement.
- External manipulation cost model parameters: experimental only, relevant to economic security but not sufficient for solvency.

# 12. Current Evidence

| Experiment | Question | Result | What it proves | What it does NOT prove |
|---|---|---|---|---|
| `tests/endToEndSettlement.test.ts` | Can a profitable settlement exceed LP vault capital? | The scenario attempts 100,000 profit against 50,000 backing and is now rejected atomically; the position and vault remain unchanged. | Realized accounting settlements cannot consume more than current `availableCapital`. | It does not reserve backing for other open positions or quantify global solvency. |
| `experiments/perpsAttackSimulation.ts` / `experiments/survivalRecovery.ts` | Can a 30,000 position survive a manipulated mark and close after recovery for about 70,000 profit against a 50,000 vault? | Yes under the chosen high-margin scenario. | OI below capacity can still create LP liability above vault capital. | It does not prove the attack is externally profitable or generally feasible. |
| `experiments/recoverySensitivity.ts` | How does liability change across TWAP targets, utilization, and recovery prices? | It reports maximum LP liability over a finite grid and intentionally uses a large vault so LP capital does not truncate measurement. | Liability is sensitive to recovery price, TWAP target, and utilization. | It is an empirical sweep, not a proof or safe capital formula. |
| `experiments/capacityLpRequirement.ts` | What LP capital would be required under selected utilization scenarios? | It reports required LP capital for selected rows. | A capital-to-capacity relationship is scenario-dependent. | It does not derive a defensible global function `maxCapacity <= f(LP capital)`. |
| `experiments/twapSeverityCapacitySweep.ts` | How do TWAP severity and capacity utilization affect realized PnL? | It reports realized PnL/required LP capital for selected TWAP targets and utilizations. | Deeper or different TWAP assumptions can change liability. | It does not prove safety outside the grid. |
| `experiments/solvencyBoundary.ts` | Does modeled manipulation cost exceed modeled extraction? | It can pass the attack-cost condition under explicit prototype assumptions. | Economic security can be tested under a chosen external AMM cost model. | It explicitly does not prove arbitrary LP capital is sufficient or complete protocol solvency. |
| `tests/attackEconomics.test.ts` | Do reachable attack scenarios cost more to sustain than they extract? | Yes under the modeled sweep; positive headline PnL is not realizable in those rows because liquidation occurs. | The selected economic attack model passes its tested condition. | It does not prove LP solvency, and empirical sweeps are not mathematical proofs. |
| `tests/capacityBoundary.test.ts` / `tests/protocolInvariants.test.ts` | Is OI bounded by capacity? | Yes for the tested opening path. | The capacity gate works for current trade opening. | It does not bound price movement or LP payout. |

# 13. Final Verdict

1. Does bounded OI currently guarantee bounded LP liability?

No. Bounded OI gives `size <= maxCapacity`, but LP liability also depends on favorable settlement price movement. Classification: OUR INFERENCE.

2. Does margin/liquidation currently guarantee solvency?

No. Margin and liquidation can reject or close some unsafe paths, but a trader can post enough margin to survive selected adverse marks, and current settlement can still exceed LP capital. Classification: OUR INFERENCE.

3. Does progressive skew currently guarantee solvency?

No. It raises entry cost as skew/capacity usage increase, but the close path settles directly at a supplied price and does not execute an opposite AMM trade. Classification: OUR INFERENCE.

4. Can LP capital -> capacity be derived from current equations?

No defensible global function can be derived without a bound on settlement price movement and a canonical settlement price source. Classification: OUR INFERENCE.

5. What exact mathematical relationship is still missing?

The missing relationship is:

```text
For all allowed positions and all allowed settlement prices:
  maxPositivePnL(position) <= available LP capital
```

Equivalently:

```text
maxCapacity * maximumFavorablePriceMove(parameters)
  <= available LP capital
```

but `maximumFavorablePriceMove(parameters)` is currently UNDEFINED.

```text
SOLVENCY STATUS:
UNPROVEN
```

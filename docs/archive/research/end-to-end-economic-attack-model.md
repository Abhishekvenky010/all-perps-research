# End-to-End Economic Attack Model Audit

## Executive conclusion

The repository can trace a **modeled** path from a selected manipulated
price input through arithmetic TWAP observations, protocol execution,
position PnL, and vault bookkeeping. It also contains an external
constant-product formula and finite experiments comparing its modeled cost
with selected extraction measures.

It does **not** implement or prove one complete economic attack lifecycle:

- no actual external AMM/source implementation is connected; production TWAP ingestion is an abstract validated reference-source interface;
- experiment drivers commonly set `ammTwapPrice` directly instead of deriving
  it from a simulated external pool;
- attack cost is an experiment-only slippage/loss proxy with a repeated
  per-block multiplier, not a measured complete attacker cost;
- some experiments call an opposite-side `simulateTrade` a close even though
  that call opens a second position and increases OI;
- other experiments use a direct caller-supplied recovery price, not a
  production-authoritative settlement source;
- vault PnL is accounting, not a transfer, and it can make capital negative;
- the modeled experiment grids and tests cover finite scenarios, not the
  maximum extraction over all possible attacks.

The strongest support is local and conditional: the code defines an
arithmetic TWAP; it defines a canonical stepped execution-price function and
PnL equation; and configured experiment models calculate comparisons between
their chosen attack-cost and extraction values. Those facts do not show that
**maximum** protocol extraction is always below **actual** attack cost.

Solvency and economic attack resistance remain distinct:

```text
SOLVENCY:
  maximum protocol payout <= available LP backing

ECONOMIC SECURITY:
  cost of manipulating external price/TWAP
    > maximum extractable profit
```

Neither is enforced as a general protocol invariant by the current
repository. This audit does not resolve settlement-boundary behavior,
position/OI defects, vault accounting defects, or any other previously
unresolved protocol decision.

## Classification convention

- **PAPER-SUPPORTED**: the All Perps research principle as represented in
  this repository's research framing. The checked-in material does not
  provide the complete paper or a citation that would justify attributing
  the prototype's detailed formulas to it.
- **REPOSITORY IMPLEMENTATION**: behavior implemented in `src/`, with its
  exact function and input scope.
- **PROJECT ASSUMPTION**: a protocol choice or meaning not established by the
  paper or implemented as an invariant.
- **EMPIRICAL EXPERIMENT**: a result from a selected model/configuration/grid.
  It is not a proof outside those tested cases.

`docs/solvency-model.md` records the research framing as
**PAPER-SUPPORTED** for the high-level cost-versus-extractable-profit
condition, and records external constant-product reserves, the vault
accounting, and the prototype capacity formula as project choices. The
tracked research report calls this an All Perps-inspired prototype and says
its pricing formulas are not the paper's exact formulas. Accordingly, this
document does not attribute the prototype attack-cost formula, numeric
parameters, settlement path, or capacity identity to the paper.

## 1. Intended economic chain: implementation and gaps

| Chain link | Repository implementation / equation | Inputs and outputs | Classification and enforcement |
|---|---|---|---|
| External AMM reserves → external spot | No external-AMM production component exists. Attack experiments assume a constant-product pool with configured reserves; `spot = quoteReserve / baseReserve`. | Reserves are experiment constants; resulting manipulated spot is an experiment variable. | External pool is **PROJECT ASSUMPTION / EMPIRICAL EXPERIMENT**. Not connected to `src/`. |
| Reference source → observation | `updateMarketFromReferencePrice` reads a `ReferencePriceSource` observation and validates/stores it. The interface has no real source/authentication implementation. `recordSimulatedProtocolMarkObservation` is explicitly simulation-only and may feed back `getCurrentAmmPrice`. | Source, timestamp → `{timestamp, price}`. | Validated production-facing abstraction; actual source is absent. Protocol-mark feedback is **SIMULATION / EXPERIMENT** only. |
| Observations → `ammTwapPrice` | `calculateTWAP` weights each reference observation over a complete 900-second window; `updateMarketFromReferencePrice` updates `ammTwapPrice` only when complete. | Ordered/pruned observations and `now` → arithmetic time-weighted mean. | **REPOSITORY IMPLEMENTATION**. Incomplete history does not fabricate a TWAP. |
| `ammTwapPrice` and OI → raw AMM mark | `getCurrentAmmPrice = ammTwapPrice * (1 + skewCoefficient * (longOI-shortOI)/maxCapacity)`. | TWAP, skew, capacity, skew coefficient → one skew-adjusted mark. | **REPOSITORY IMPLEMENTATION**. This is the proposed raw mark source in prior design, not a settlement authority decision. |
| `ammTwapPrice`, skew, capacity → execution price | `getAverageExecutionPrice` computes fair value and a symmetric capacity spread per step. | Current working OI, `maxCapacity`, `skewCoefficient`, `capacityCoefficient`, side → step price. | Canonical `simulateTrade` opening path is **REPOSITORY IMPLEMENTATION**. Exact model is a prototype choice, not attributed to paper. |
| Execution steps → position | `simulateTrade` accumulates step cost/size; final `Position.entryPrice = totalCost / totalSize`. OI is staged and then committed before manager insertion. | Side, size, steps, margin, state/config → position, prices, updated OI. | **REPOSITORY IMPLEMENTATION**, subject to the previously audited malformed-input, duplicate-ID, and atomicity limitations. |
| Position size → capacity | `totalOI = longOI+shortOI`; each step checks `totalOI + stepSize <= maxCapacity + tolerance`. | Recorded market OI, config, step size → allow/reject. | **REPOSITORY IMPLEMENTATION**, but capacity trusts OI and admits a tiny tolerance over the nominal maximum. It does not prove position-ledger equality. |
| Attack → TWAP evolution | Attack model analytically derives a spot needed for a target arithmetic TWAP, then replays observations; many other experiments set target `ammTwapPrice` directly. | Initial price, target, duration, and optionally modeled self-flow → spot/TWAP path. | Arithmetic inversion/replay is **EMPIRICAL EXPERIMENT** using repo TWAP functions. The external pool is not in the loop. |
| Settlement/recovery price → PnL | Production close/liquidation derive the canonical `getCurrentAmmPrice` snapshot; named simulation helpers may still use explicit research prices. LONG PnL is `(settlementPrice-entryPrice)*size`; SHORT PnL is `(entryPrice-settlementPrice)*size`. | Position and production mark or explicit experimental price → signed PnL. | PnL equation is **REPOSITORY IMPLEMENTATION**. Production settlement no longer grants the caller price authority; experiments preserve explicit-price controls. |
| PnL → vault | `prepareTraderPnL` calculates `traderPnL += pnl`, `availableCapital -= pnl`, and rejects a negative resulting `availableCapital` before commit. | Signed realized PnL → prepared accounting update. | **REPOSITORY IMPLEMENTATION** as an accounting solvency check. It does not move cash or reserve for unrealized liabilities. |
| Position close/liquidation → final trader claim | Voluntary close reports `margin+pnl`; financial liquidation reports `max(margin+pnl,0)`. Both commit position lifecycle, OI, and prepared vault accounting atomically. | Position, internally derived production price, and for liquidation maintenance margin → result fields. | **REPOSITORY IMPLEMENTATION** within the in-memory state boundary. A returned claim is not evidence of cash transfer; bare risk marking remains read-only. |
| Attack cost + trader extraction → attacker net profit | Experiments sometimes calculate `attackCost / headlinePnl` or `attackCost / realizedPnl`. No production attacker balance sheet or net-profit state exists. | Experiment proxy cost and selected PnL metric → ratio. | **EMPIRICAL EXPERIMENT**. Unit comparability and cost completeness are assumptions; no protocol enforcement. |

No missing arrow is supplied by the paper simply because adjacent arrows
exist in code. In particular, the modeled external spot is not the same
thing as a trusted protocol TWAP input, and a TWAP target is not automatically
the settlement price.

## 2. External AMM attack-cost model

### Newer arithmetic-TWAP attack model

The primary model in
[`attackEconomicsModel.ts`](../../experiments/archive/attackEconomicsModel.ts) and
[`economicInvariantSweep.ts`](../../experiments/archive/economicInvariantSweep.ts)
assumes:

```text
initial spot P0 = 100
base reserve B0 = 50,000
quote reserve Q0 = B0 * P0 = 5,000,000
constant product k = B0 * Q0
```

For a downward price target `s < P0`, the constant-product pool's required
base input is modeled as:

```text
newBase = sqrt(k / s)
baseInput = newBase - B0
newQuote = k / newBase
quoteOutput = Q0 - newQuote
```

The experiment's one-move quote-denominated cost proxy is:

```text
costPerBlock = max(baseInput * P0 - quoteOutput, 0)
```

For a target arithmetic TWAP `T` reached by holding manipulated spot `s`
for `duration` seconds in a `window = 900` second interval:

```text
T * window = s * duration + P0 * (window - duration)

s = (T * window - P0 * (window - duration)) / duration
```

The total cost is then modeled as:

```text
manipulatedBlocks = duration / 15
attackCost = costPerBlock(s) * manipulatedBlocks
```

At a full-window 900-second manipulation, `s = T`. At shorter durations,
the required spot is deeper for the same target; some target-duration pairs
require a nonpositive spot and are classified unreachable.

For the configured pool, source-equation reconstructions give approximately:

| Target TWAP / held spot | Base input to reach spot | One-move cost proxy | Modeled 900s cost (`×60`) |
|---:|---:|---:|---:|
| 95 | 1,298.92 base units | 3,288.93 quote units | 197,335.97 quote units |
| 90 | 2,704.63 base units | 13,879.26 quote units | 832,755.43 quote units |

These are calculations from the checked-in formulas and constants, not a
fresh TypeScript experiment run in this environment.

### What this cost is and is not

The formula's result is a modeled quote-value loss/slippage proxy. It is
**not** a measured minimum capital requirement:

- `baseInput` describes input inventory in the assumed pool, but the
  experiment does not track the attacker's starting balances or financing;
- it does not simulate an external market, arbitrage, a back-run, fees,
  gas, competing trades, or the attacker's inventory mark-to-market over
  time;
- the cost at one spot depth is multiplied by blocks without updating pool
  reserves or proving that an independent same-cost trade/loss is incurred
  every block;
- the restoration/recovery trade is not added as a separately computed
  cost (the model comments say adding it would double count);
- external liquidity is fixed by the experiment and is not queried from a
  real pool; and
- code values are untyped JavaScript numbers. Calling both the proxy and
  protocol PnL “dollars” presumes matching quote units and position-size
  denomination; no unit system enforces this.

Thus, the direct output answers: **what this assumed formula labels attack
cost**, not the attacker's complete economic loss or required capital.

### Older geometric-TWAP experiment

[`twapAttackCost.ts`](../../experiments/archive/twapAttackCost.ts) is a separate
Euler-inspired legacy experiment. It uses:

```text
TWAP = (p^(n-m) * q^m)^(1/n)
```

and solves geometrically for manipulated price `q`. It uses 72 blocks per
window, a fixed 72-block manipulation in its headline setup, 50,000 base
reserves, 5,000,000 quote reserves, target TWAP 60, and a pre-measured
`PERP_EXTRACTION = 1,918,154.7619047621`. Its cost is normalized per block,
then scaled by reserve liquidity and compared to that fixed extraction.

That geometric mean is **not** the production `TWAPOracle.calculateTWAP`
formula and must not be substituted for the repository's arithmetic
time-weighted average. This older result is an alternate research
experiment, not validation of the newer production-TWAP attack model.

## 3. TWAP model and manipulation path

Production `TWAPOracle.calculateTWAP`:

1. uses a 15-minute/900-second window;
2. requires a complete history with an observation at or before the window
   start;
3. weights each piecewise-constant observation by the interval duration it
   covers; and
4. divides summed price-time by 900 seconds.

Therefore the implemented model is an **arithmetic time-weighted mean**,
not the Euler geometric mean. The production-facing reference service takes
observations from an abstract source. Protocol-mark feedback is available
only through the explicitly named helper in `SimulatedProtocolMarkObservation.ts`:

```text
recordSimulatedProtocolMarkObservation(state, config, timestamp)
  -> getCurrentAmmPrice(state, config)
```

That simulation helper is an internal AMM/TWAP-derived mark, not an external
AMM spot reader, and it is not the production reference source. The attack
experiments' `market(manipulatedSpot, ...)` helper places a
manipulated level directly in `MarketState.ammTwapPrice`; the replay then
records the skew-adjusted derived price. With no self-flow, skew is zero and
the observation equals the injected level. With self-flow, the observation
also includes protocol skew.

The model therefore has these separate values:

```text
research-injected price
  -> protocol state / explicit simulation observation adapter
  -> arithmetic 900s research TWAP
```

There is no implemented arrow from constant-product reserve state to an
external production source. Tests of protocol-mark feedback validate a
simulation scenario, not an independent reference-price oracle.

The experiment source itself notes that the current model uses arithmetic
inversion instead of a prior geometric inversion. In particular, a
half-window manipulation targeting 90 requires spot 80 under the arithmetic
formula, not the geometric model's 81. The Euler geometric equation exists
only in the older experiment and is not production behavior.

## 4. Canonical entry price

`simulateTrade` is the canonical open flow:

```text
request side, size, steps, config, trader, margin
  -> leverage check
  -> copy market state
  -> for every step:
       capacity check
       getAverageExecutionPrice(current working state)
       accumulate cost and size
       increase working OI on requested side
  -> averagePrice = totalCost / totalSize
  -> Position.entryPrice = averagePrice
  -> commit OI and register position
```

For step `j`, let:

```text
T = ammTwapPrice
L_j = longOI before step j
S_j = shortOI before step j
C = maxCapacity
k = skewCoefficient
c = capacityCoefficient
u_j = (L_j + S_j) / C
r_j = (L_j - S_j) / C
```

The canonical step pricing in `getAverageExecutionPrice` is:

```text
fairValue_j = T * (1 + k * r_j)
capacityImpact_j = (c * (u_j / (1 - u_j))) / 2

LONG stepPrice_j  = fairValue_j * (1 + capacityImpact_j)
SHORT stepPrice_j = fairValue_j * (1 - capacityImpact_j)
```

After pricing each step, `simulateTrade` adds `size / steps` to `L` for a
LONG or to `S` for a SHORT. The returned position entry is the arithmetic
size-weighted average of those step prices (equal step sizes in normal
inputs):

```text
entryPrice = sum(stepPrice_j * stepSize) / sum(stepSize)
```

The attack-model configurations commonly use:

```text
maxCapacity = 100,000
skewCoefficient = 0.2
capacityCoefficient = 0.05
steps = 5
```

`getCurrentAmmPrice` uses skew but no capacity spread. `getExecutionPrice`
uses a different impact path; `getBoundedExecutionPrice` and
`getConvexExecutionPrice` are alternatives, not the canonical `simulateTrade`
opening path. The experiment distinction matters: “mark price” and “entry
execution price” are not the same variable.

## 5. Position size, capacity, and round-trip mismatch

For a valid canonical open of size `S` from market state `(L,S_short)`:

```text
LONG: longOI increases by S; shortOI unchanged
SHORT: shortOI increases by S; longOI unchanged
totalOI increases by S
```

Each trade step checks the market counters against configured
`maxCapacity`. The checker reads only those counters; it does not reconcile
them against all positions. The prior position/OI audit found direct manager
mutations, duplicate-ID overwrite, mutable position references, malformed
inputs, and capacity tolerance concerns. Thus a simulated capacity pass is
conditional on the OI/position ledger already being consistent.

An opposite-side `simulateTrade` is **not** a position close:

```text
existing LONG position size S
then simulateTrade(SHORT, S)

longOI'  = longOI
shortOI' = shortOI + S
totalOI' = totalOI + S
```

It leaves the original LONG open and registers a separate SHORT position.
The net directional skew may shrink, but total OI rises. Only
`closePosition`/settlement close paths remove the stored position and
subtract its same-side OI.

The primary attack model's `extractFromDepressedTwap` and the capacity
sweeps use a SHORT `simulateTrade` for their purported exit. Their
`(averageExitPrice - averageEntryPrice) * size` is therefore a
**hypothetical fill-spread/headline metric**, not the PnL from closing the
original LONG via the repository's settlement path. At utilization
`u = size/maxCapacity`, the attempted pair has final OI `2*size`; the tested
50% entry produces total OI equal to capacity, while larger sizes fail on
the purported exit. The existing test explicitly asserts the exit failure
above the tested boundary and recognizes that the position remains open.

This is a material lifecycle mismatch, not a harmless change of trade
label. It affects closeability, OI, subsequent pricing, and which PnL is
being compared to attack cost. It invalidates a claim that this particular
round-trip output is realized settlement extraction.

## 6. PnL, settlement price, and extraction measures

The implemented PnL formula is:

```text
LONG  PnL = (currentPrice - entryPrice) * size
SHORT PnL = (entryPrice - currentPrice) * size
```

`currentPrice` is supplied by the caller to `calculateUnrealizedPnL`,
`calculatePositionSettlement`, and the settlement wrappers. The repository
does not force it to be raw TWAP, `getCurrentAmmPrice`, or an internally
derived recovery value. Experiment conventions differ:

- attack-model liquidation checks use the target TWAP as mark;
- the capacity sweep marks at target TWAP and then prices a purported exit
  at the recovery level through a SHORT trade;
- `economicInvariantSweep` opens from target TWAP, checks liquidation at
  target TWAP, then calls settlement with literal recovery price 100;
- `perpsAttackSimulation` sets the state TWAP to 95, marks at raw 95, samples
  raw marks from 95 to 100, and settles by passing literal 100; and
- some other sweep code derives marks through `getCurrentAmmPrice`.

This document records these choices but does not resolve the settlement
price authority or movement boundary.

### Quantity mapping

| Experimental quantity | Actual meaning | Includes external attack cost? | Includes margin? | Includes AMM execution impact? |
|---|---|---:|---:|---:|
| `roundTripPnl` in `attackEconomicsModel.ts` | `(simulated SHORT average fill - simulated LONG average fill) * size`; the SHORT is a new position, not a settlement close | No | No; margin is not PnL | Yes, both simulated fills |
| `headlinePnl` in `runCapacityAttackSweep` | Same additive opposite-side fill difference when both trades execute | No | No | Yes, both simulated fills |
| `realizablePnl` in that sweep | `null` if marked liquidatable on entry; otherwise copied headline fill-difference value | No | No | Yes, but still not actual settlement PnL |
| `settlement.pnl` / `realizedPnl` in settlement sweeps | Signed entry-to-supplied-recovery-price PnL, sometimes floored at zero by experiment reporting | No | No; signed PnL excludes margin | Entry uses protocol execution pricing; settlement price is direct input |
| `traderSettlement` | Reported `position.margin + pnl` on voluntary close; liquidation report floors this at zero | No | Yes, added as a claim/result value | No new execution trade; no cash transfer |
| `vault.availableCapital` change | Bookkeeping change `-pnl` | No | No | No; no actual asset transfer |
| `attackCost` | External pool cost proxy under the chosen constant-product and duration assumptions | It is the modeled cost | No trader-position margin | No protocol perp execution fees/cashflow |
| attacker “net profit” | Not implemented as a state variable; can only be approximated as extraction minus the modeled cost under matching-unit assumptions | Only if analyst subtracts it | Margin/collateral opportunity cost is not modeled | Depends which extraction measure is used |

Use “headline fill difference”, “settlement PnL”, or “modeled net amount”
instead of unqualified “profit” when referring to these quantities.

## 7. Reconstructed scenarios

The following values are reconstructed from checked-in equations, constants,
and the stated experiment paths. They are not fresh experiment output:
`node` and `npm` are unavailable in the current environment. Values are
rounded for display. Ratios below are comparisons of model quantities, not
validated real-world attacker returns.

### Scenario A — target TWAP 95, 900 seconds, 30% capacity

This is the corresponding full-window 30%-utilization case in
`economicInvariantSweep.ts`:

```text
initial price = 100
target TWAP = 95
duration = 900 seconds = 60 modeled 15-second blocks
maxCapacity = 100,000
position size = 30,000
skew coefficient = 0.2
capacity coefficient = 0.05
maintenance margin = 0.05
recovery input = 100
LP vault initial capital = 1,000,000,000
```

**Entry:** applying the five canonical LONG step prices at target TWAP 95
gives:

```text
step prices ≈ 95.0000, 96.2934, 97.6116, 98.9601, 100.3460
entryPrice ≈ 97.6422
longOI after open = 30,000
totalOI after open = 30,000 (30% utilization)
```

**At the target mark 95:**

```text
PnL = (95 - 97.642232...) * 30,000
    ≈ -79,266.97
```

The sweep chooses margin from:

```text
requiredMargin =
  max(0, maintenanceMargin * size - pnlAtTarget) * 1.01
  ≈ 81,574.64
```

This produces marked equity about 2,307.67 and margin ratio about 0.07692,
above the 0.05 threshold in this modeled check. It is designed to survive
that mark; it is not an empirically discovered attacker capital requirement.

**Recovery/settlement:** the experiment passes recovery price 100 directly
to `settleAndClosePosition`:

```text
settlement PnL = (100 - 97.642232...) * 30,000
               ≈ +70,733.03
reported trader claim = margin + PnL
                      ≈ 152,307.67
vault available capital: 1,000,000,000 -> 999,929,266.97
```

The claim is a returned number, not a transfer. The vault accounts only the
signed PnL, not the margin claim.

**External cost proxy:** using the experiment's reserve model at manipulated
spot 95 gives modeled 900-second cost about 197,335.97. Compared with
settlement PnL:

```text
modeled cost / settlement PnL ≈ 2.79
modeled extraction - modeled cost ≈ -126,602.94
```

This comparison assumes identical quote units and accepts the repeated
per-block cost proxy. The script does not actually manipulate an external
pool, replay an external AMM recovery, or charge the model's attack cost to
the position settlement. The “net amount” is only arithmetic subtraction
of two experiment outputs.

### Scenario B — target TWAP 90, 900 seconds, 50% capacity

Two experiments share this target/size but differ on margin and what they
call an exit. They must not be conflated.

#### B1. `economicInvariantSweep.ts`: true settlement close with designed margin

Parameters are as in Scenario A except target TWAP 90 and size 50,000.
The five canonical LONG steps yield:

```text
step prices ≈ 90.0000, 92.0550, 94.1850, 96.4221, 98.8200
entryPrice ≈ 94.2964
longOI = 50,000
totalOI = 50,000 (50% utilization)
```

At target mark 90:

```text
PnL ≈ (90 - 94.296429) * 50,000
    ≈ -214,821.43
```

The experiment selects margin about 219,494.64 using its maintenance
threshold plus a 1% buffer. Equity at the target mark is about 4,673.21,
margin ratio about 0.09346. It therefore passes its own liquidation check.
Settlement is then invoked at literal recovery price 100:

```text
settlement PnL ≈ (100 - 94.296429) * 50,000
               ≈ +285,178.57
vault: 1,000,000,000 -> 999,714,821.43
```

The external cost proxy at target spot 90 for 900 seconds is about
832,755.43:

```text
modeled cost / settlement PnL ≈ 2.92
modeled extraction - modeled cost ≈ -547,576.86
```

This is a genuine call to the repository settlement function, but recovery
is still supplied directly; external AMM recovery is not simulated, vault
capital is deliberately much larger than the PnL, and the margin is not
custodied. It is one successful modeled scenario, not the maximum over all
attacks.

#### B2. `capacityAttackCostComparison.ts`: 5x margin and additive SHORT “exit”

The capacity comparison uses margin `size / 5 = 10,000`. The entry and
target-mark PnL are the same, so:

```text
mark equity ≈ 10,000 - 214,821.43 = -204,821.43
margin ratio ≈ -4.09643
```

The position is liquidatable at entry under the experiment's mark check.
The script nevertheless attempts a SHORT `simulateTrade` of size 50,000
after setting TWAP to 100. That operation creates a new SHORT position:

```text
longOI = 50,000
shortOI = 50,000
totalOI = 100,000
```

The computed SHORT average is about 96.7333 and the script's headline
fill-difference value is about 121,845.24. This is not a settlement of the
LONG, not realized extraction, and not spendable trader profit. The
position is already marked liquidatable. The cost ratio sometimes shown
against this headline value is about 6.84, but it is not a ratio against
realizable profit.

This comparison is useful for showing that capacity affects close-path
executability and that entry liquidation differs from headline fills. It
must not be cited as a completed economic attack lifecycle.

### Scenario C — 50k vault, 30k LONG, 95 → 100 recovery

This is the configuration in
[`perpsAttackSimulation.ts`](../../experiments/archive/perpsAttackSimulation.ts):

```text
LP vault initial capital = 50,000
position size = 30,000
entryPrice ≈ 97.6422
attacker margin = 80,800
maintenance margin = 0.05
initial/target/recovery price = 100 / 95 / 100
```

The mark is evaluated at raw target TWAP 95:

```text
PnL_95 ≈ (95 - 97.642232...) * 30,000
       ≈ -79,266.97
equity_95 = 80,800 - 79,266.97
          ≈ 1,533.03
marginRatio_95 ≈ 1,533.03 / 30,000
               ≈ 0.05110
```

The position is just above the experiment's 0.05 liquidation threshold.
Under `isLiquidatable`'s strict `<` comparison, the boundary price for this
LONG is:

```text
P_boundary = entryPrice + maintenanceMargin - margin / size
           ≈ 94.99890
```

At price 95 the position survives; the script checks a monotonic recovery
from 95 to 100 in 20 increments, which moves PnL/equity upward. The
position therefore survives that sampled recovery path.

At recovery 100:

```text
settlement PnL ≈ (100 - 97.642232...) * 30,000
               ≈ +70,733.03
reported trader claim = 80,800 + 70,733.03
                      ≈ 151,533.03
vault availableCapital = 50,000 - 70,733.03
                       ≈ -20,733.03
```

**The current settlement function completes this as bookkeeping** if
position/OI state is otherwise consistent; it does not check vault
payability. No actual transfer of the reported claim is implemented.
`perpsAttackSimulation.ts` treats the external TWAP manipulation as already
achieved and expressly does not calculate external AMM cost. A separately
applied cost proxy for target 95 and 900 seconds would be about 197,335.97,
but subtracting it from this scenario's PnL would combine a cost experiment
with a lifecycle simulation that intentionally omitted that cost. It is not
the scenario's measured attacker net result.

## 8. Attack-cost comparison and economic-security claim

The intended research condition is:

```text
minimum total attacker cost to produce/exploit scenario s
    >
maximum attacker profit available in scenario s
```

For it to support the claimed comparison, both sides need:

1. the same fully specified scenario and feasible attack strategy;
2. a complete cost definition (capital needed is not the same as capital
   lost);
3. a common numeraire and time horizon;
4. an extraction measure based on a realizable close/settlement lifecycle,
   not merely paired fills;
5. all relevant manipulation, execution, collateral, liquidation,
   settlement, and recovery effects consistently included; and
6. an exhaustive or analytically bounded attack domain if the word
   “maximum” is used.

The current model does not define one complete function

```text
AttackCost(
  externalLiquidity,
  manipulationDuration,
  targetTWAP,
  attackStrategy,
  inventoryAndBackrun,
  ...
)
```

that is linked to the corresponding complete

```text
MaximumProtocolExtraction(
  capacity,
  skewCoefficient,
  capacityCoefficient,
  positions,
  margin,
  settlementRule,
  recoveryPath,
  ...
)
```

The experiment cost function takes selected pool constants, required spot,
and duration. Extraction calculations take separate protocol state and
price inputs; they do not derive the price path from the same evolving
external pool. Thus there is no validated common scenario map from external
manipulation cost to maximum protocol extraction.

### What the source tests assert

[`attackEconomics.test.ts`](../research-tests/attackEconomics.test.ts.txt) asserts, for
the configured reachable cases in its model:

- positive headline round-trip fill differences are smaller than modeled
  sustained attack cost;
- no modeled attack is marked realizable;
- a selected thinnest cost/headline ratio exceeds one;
- target arithmetic TWAP replay matches requested targets within tolerance;
- attacker self-flow does not raise the depressed TWAP in its tested replay;
- the configured margin makes each reachable attack liquidatable on entry;
- the size-dependent sweep distinguishes accepted/rejected pseudo-round-trips
  and has no non-null realizable PnL under its liquidation classification.

Those assertions are evidence about the source model's finite configured
state space. They do not demonstrate **attackCost > maximum possible
extraction** in the protocol. The primary tested extraction may be a
non-settlement fill difference, all those fixed-margin attacks are
liquidated on entry, and the cost is a project-assumed proxy.

No test or runtime gate rejects an attack unless its external cost exceeds
its extractable profit. An assertion in a test is not enforcement by the
protocol. This environment lacks `node` and `npm`, so the experiments and
tests were not freshly executed for this audit.

## 9. Experimental-model mismatches

| Mismatch | Where / behavior | Classification | Effect on conclusion |
|---|---|---|---|
| External AMM vs protocol AMM | Cost uses an assumed constant-product pool; production `MarketState` has no reserves and attack drivers inject spot/TWAP values | Material modeling separation | Cost cannot be treated as actual integrated manipulation loss |
| Raw external spot vs recorded observation | Replay assigns an assumed spot to `ammTwapPrice`; oracle records `getCurrentAmmPrice`, not external pool spot | Material assumption | Validates TWAP arithmetic on injected observations, not external-to-oracle data path |
| Arithmetic production TWAP vs Euler geometric TWAP | `TWAPOracle` is arithmetic; legacy `twapAttackCost.ts` uses geometric mean | Invalidates substituting legacy formula into production attack conclusion | Keep the models separate |
| TWAP vs skew-adjusted mark | `getCurrentAmmPrice` adds skew; some PnL checks use raw target TWAP; other paths use supplied recovery price | Material price-semantic mismatch | Same TWAP target need not be mark or settlement price |
| Canonical entry vs alternative pricing | `simulateTrade` uses `getAverageExecutionPrice`; other exported execution functions differ | Harmless when clearly identified, misleading if mixed | Experimental values must cite canonical open path |
| Opposite-side trade vs close | `simulateTrade(SHORT,S)` adds short OI/position; it does not remove existing LONG | Material lifecycle mismatch | Invalidates treating round-trip fill difference as realized settlement PnL |
| Headline PnL vs realizable profit | Positive fill difference can be reported despite entry liquidation, failed close, or no settlement | Invalidates using it as attacker realized profit | Must separately report executability, survival, and settlement |
| Settlement price vs recovery label | `settleAndClosePosition` is given literal recovery price (often 100), not a replayed canonical mark | Material price-path simplification | Scenario settlement demonstrates function arithmetic, not oracle-authoritative recovery |
| Vault accounting vs token transfer | `availableCapital` changes by `-pnl`; no cash transfer is implemented | Material economic mismatch | Vault decrease is not evidence that trader payout was actually paid |
| Negative trader PnL vs collected loss | Negative PnL increases vault capital without collecting trader margin | Material economic mismatch | Model credits the LP as if value were received |
| Capacity vs position ledger | Capacity checks market OI; IDs/direct manager mutation can desynchronize positions and OI | Invalidates global capacity proof | Experiment capacity outcomes rely on consistent initial state |
| Attack cost vs capital requirement | Cost proxy is computed as quote loss/slippage; base input is an assumed reserve move; no attacker balance sheet | Material semantic distinction | Cannot claim a minimum capital requirement from the cost output |
| Repeated per-block cost | One spot-depth cost is multiplied by block count without pool evolution | Experiment-only simplifying assumption | Strongly affects ratios; not a proven sustained economic cost |
| Margin and attacker costs | Margin is set to fixed or formula-derived values; its opportunity cost, collection, or financing is not charged to net attack profit | Material omission | Reported extraction minus attackCost is not full attacker net return |

## 10. Solvency and economic attack resistance

### Solvency

The prior design's conditional algebra is:

```text
IF each position's favorable entry-to-settlement movement <= DeltaP_max
AND sum of open position sizes <= totalOI <= maxCapacity
THEN aggregate positive PnL <= DeltaP_max * maxCapacity
```

Sufficient backing would additionally require:

```text
DeltaP_max * maxCapacity <= available LP backing
```

The preceding checkpoint findings describe the pre-implementation audit.
The implementation now uses a canonical settlement mark, enforces
position/OI conservation and capacity exactly, commits close/liquidation
atomically, and rejects realized PnL that would make `availableCapital`
negative. Scenario C remains a valid example of a positive liability
exceeding 50,000 backing, but settlement now rejects that liability instead
of booking a negative vault balance.

The remaining gaps are not global solvency guarantees: `DeltaP_max` and
attack-cost enforcement are not implemented; no reserve is maintained for
unrealized liabilities from open positions; actual asset custody is not
modeled; and no capital-to-capacity relationship is established. The
negative PnL credit convention also does not prove that a trader loss was
collected as cash.

### Economic security

The experiment comparisons are separate from vault backing. Scenario A/B1
produce modeled ratios above one for those chosen inputs, but that cannot
prove the global economic-security condition. Scenario C's protocol-side
simulation omits attack cost altogether. Conversely, even if an attacker
loses more to an external pool than they gain from a perp, the LP vault may
still lack enough backing to pay the trader. And a well-funded vault can
still face a profitable manipulation if extraction exceeds attack cost.

Thus both implications fail without additional linking assumptions:

```text
economic security does not imply solvency
solvency does not imply economic security
```

They must remain separate constraints.

## 11. Conditional conservative PnL bound

For a position with size `s_i`, entry `E_i`, settlement `P_i`, and side,
positive PnL is bounded by:

```text
max(PnL_i, 0)
  <= s_i * max(favorable movement_i, 0)
```

If every favorable movement is at most `DeltaP_max`, then:

```text
sum_i max(PnL_i, 0)
  <= DeltaP_max * sum_i s_i
```

With correct complete position/OI accounting and strict capacity:

```text
sum_i s_i = totalOI <= maxCapacity
```

would yield:

```text
aggregate positive PnL <= DeltaP_max * maxCapacity
```

This derivation is valid **conditionally**. Current repository state does
not establish:

| Prerequisite | Current evidence |
|---|---|
| Bounded favorable settlement movement | **Not established.** Boundary is unresolved and settlement accepts supplied prices. |
| Complete position/OI accounting | **Not established.** Prior audit status is `VIOLATED`; direct mutation and duplicate IDs break identity. |
| Strict `totalOI <= maxCapacity` | **Not established globally.** Gate uses OI only and includes a relative tolerance; state can be stale or mutated. |
| Sufficient LP backing | **Not established.** Vault accepts positive PnL above capital and has no open-liability reserve. |

Do not present `DeltaP_max * maxCapacity` as an implemented liability cap.
It is a conditional mathematical upper bound whose premises have not been
implemented as a complete protocol invariant.

## 12. Worst-case coverage

The experiments explore useful but finite slices:

| Experiment | Swept | Fixed / omitted dimensions | Important filter or limitation |
|---|---|---|---|
| `attackEconomicsModel.ts` / `fullAttackEconomics.ts` | Target TWAPs 90, 80, 70, 60, 50, 40; durations 15, 30, 60, 120, 300, 600, 900 seconds; fixed attacker size 20,000 in base sweep | External reserves 50k/5m; capacity 100k; coefficients .2/.05; margin 4k; no reserve/liquidity sensitivity | Some target-duration pairs are unreachable. Round-trip metrics use opposite-side simulated trade. Fixed-margin positions are liquidated at entry in tested reachable cases. |
| `runCapacityAttackSweep` / `capacityAttackCostComparison.ts` | Utilization points 10%, 20%, 30%, 40%, 45%, 49%, 50%, 60%, 70%, 80%, 90%, 95%, 99%; one target TWAP 90 | Cost uses one target/duration and is independent of position size; margin is size/5; fixed config/liquidity | Exit failures are excluded from PnL; capacity explains pseudo-closeability; accepted positions are liquidated on entry according to tests. |
| `economicSecuritySweep.ts` | 7 target TWAPs × 7 durations × 7 utilizations = 343 requested grid points | Fixed pool/reserves/config; uses capacity rows with 5x margin; no LP reserve/capacity sweep | Separates unreachable, non-closeable, liquidated, and surviving statuses; cost/headline ratios are not a proof and rejected scenarios are not successful attacks. |
| `economicInvariantSweep.ts` | Target TWAPs 95, 90, 85, 80 × utilization 10%, 20%, 30%, 40%, 50% = 20 cases | Duration fixed at 900s; recovery fixed at 100; external reserves/config fixed; vault deliberately 1bn; margin derived to survive target | Uses real settlement function but direct prices; conditional model comparison only. |
| `economicDurationSweep.ts` | Targets 95, 90, 85, 80 × durations 15, 30, 60, 120, 300, 600, 900 × utilizations 10–50% = 140 nominal cases | Recovery fixed at 100; pool/config fixed; margin rule fixed; no pool depth sweep | Unreachable targets and failed/liquidated rows limit interpretation; selected grid only. |
| `capacityAttackEconomics.ts` | Utilizations 10%, 20%, 30%, 40%, 50% | Target fixed at 95; recovery 100; vault 1m; no attack cost | Protocol-side settlement experiment, not an economic cost comparison. |
| `capacityNormalizedAttack.ts` | Utilizations 10%, 20%, 30%, 40%, 50% | Target 95/recovery100; vault1m; survival buffer1.01; no attack cost | Solvency/capital illustration; not an attack-resistance result. |
| `perpsAttackSimulation.ts` | 20 sampled recovery marks between 95 and 100 | One size 30k, margin80.8k, vault50k; external attack assumed already achieved | Scenario survival and settlement, no external attack cost. |
| `twapAttackCost.ts` | Selected geometric TWAP targets and liquidity break-even calculation | Geometric TWAP, legacy constants, fixed extraction sample | Not the arithmetic production TWAP model. |

Margin is generally fixed or calculated to meet the experiment's liquidation
threshold; it is not swept as an independent attacker strategy axis. LP
capital is fixed in most experiments and sometimes intentionally made so
large that it cannot truncate extraction. External liquidity/reserves are
not broadly swept in the main comparisons. No sweep establishes a worst case
over all strategies, prices, fees, market states, or settlement behaviors.

## 13. Formal status table

Statuses refer to the general economic-security proposition, not whether
source code contains a formula or a test.

| Property | Status | Evidence | Missing condition / limitation |
|---|---|---|---|
| External attack cost is modeled | **PARTIALLY PROVEN** | Constant-product formula and configured reserves exist in experiment code | No external pool integration, validated cost calibration, back-run, fees, or attacker balance sheet |
| TWAP manipulation is modeled | **PARTIALLY PROVEN** | Arithmetic TWAP is implemented and replayed from injected observations | Injected spot is not generated by the modeled pool; complete external-to-oracle path absent |
| Entry price is modeled | **PROVEN** | `simulateTrade` uses `getAverageExecutionPrice` and sets position entry to total cost/size for ordinary valid input | Does not validate attack realism or all malformed inputs |
| Capacity is modeled | **PARTIALLY PROVEN** | `canIncreaseExposure` checks each step against market OI and configured capacity | Strict limit and ledger identity are not guaranteed; experiment starting states are assumed consistent |
| Trader PnL is modeled | **PROVEN** | Explicit LONG/SHORT arithmetic in `calculateUnrealizedPnL` | Settlement-price authority and actual asset transfer remain undefined |
| LP liability is modeled | **PARTIALLY PROVEN** | Positive booked PnL reduces `availableCapital`; vault tests demonstrate arithmetic | No cash transfer, margin custody, liability reserve, or payout guard |
| Attack cost and extraction are comparable | **PARTIALLY PROVEN** | Ratios divide numeric model values in selected configurations | Common numeraire, complete cost, actual realized extraction, and lifecycle correspondence are assumed |
| `attackCost > observed extraction` | **PARTIALLY PROVEN** | Tests assert the inequality for configured reachable headline cases; select settlement sweeps calculate ratios | Not freshly run here; selected outputs and model assumptions only; some “extraction” is not settlement PnL |
| `attackCost > maximum extraction` | **UNPROVEN** | Experiments report finite-grid maxima/minima only | Need exhaustive or analytic bound over feasible strategies and protocol states |
| Solvency is enforced | **VIOLATED** | End-to-end settlement can book 100k PnL against 50k capital and leave a negative vault | No payout guard, reserve, enforced movement bound, or accounting custody |
| Economic security is enforced | **UNPROVEN** | Tests assert modeled inequalities; production code has no attack-cost gate | Need a protocol-level security mechanism or proof; test assertion alone does not enforce cost |
| Solvency bound is enforced | **VIOLATED** | `DeltaP_max` and backing/capacity inequality are not checked; counterexample permits negative capital | Need all conditional premises plus enforced capacity/backing checks |
| Global economic-security proof exists | **UNPROVEN** | No global optimization/proof; finite experiments only | Validated scenario mapping and proof/bounds over all allowed attacks |

## 14. Research conclusions

### A. Strongest economic claim supported now

The repository can say that **under its selected external constant-product
cost proxy and finite experiment configurations**, it computes modeled
attack-cost versus modeled extraction comparisons. Some scenarios satisfy
`attackCost > observed extraction`; the configured attack-economics tests
assert that relation for their reachable headline cases. The arithmetic
TWAP implementation and canonical entry/PnL equations are also inspectable
and testable in isolation.

This is a **local empirical/model result**, conditional on the configured
pool, repeated-cost assumption, execution path, margins, price inputs, and
scenario filter—not a protocol-wide security guarantee.

### B. Strongest claim not supported

The repository cannot claim that the minimum actual cost of any feasible
external TWAP manipulation exceeds the attacker's maximum realizable net
profit for every protocol state. It also cannot claim that each payout is
solvent or that the vault can transfer every reported settlement claim.

### C. Results that remain useful

- Arithmetic TWAP formula and duration/depth inversion for the repository's
  900-second model.
- Stepwise canonical entry-price calculations that expose skew and capacity
  pricing effects.
- Explicit capacity-gate behavior, including partial-step rejection and
  exit-path capacity limitations.
- Margin/liquidation scenario calculations, when labeled with their
  selected margin and mark conventions.
- External-pool cost sensitivity as a research hypothesis, provided the
  constant-product and repeated-cost assumptions are stated.
- Scenario-specific settlement/vault arithmetic that demonstrates how a
  selected positive PnL changes `availableCapital`.

### D. Results not to present as proof

- A finite-grid worst ratio as the worst possible attack.
- `attackCost > headlinePnl` as `attackCost > maximum extractable profit`.
- An opposite-side `simulateTrade` fill difference as completed LONG
  settlement PnL.
- Liquidated or non-closeable rows as a successful realized attack—or as a
  proof that every conceivable attack is impossible.
- A caller-supplied recovery price as the canonical production settlement
  price.
- Negative vault capital as proof that settlement is actually payable.
- The repeated per-block constant-product proxy as proven external economic
  loss or required attacker capital.
- The Euler geometric-TWAP experiment as production arithmetic-TWAP evidence.
- `DeltaP_max * maxCapacity` as an implemented liability cap.

### E. Missing mathematical relationship

The missing object is a validated, scenario-consistent lower bound on
attacker cost and an upper bound on realizable extraction:

```text
for every feasible attack strategy a and protocol state x:

  Cost_min(a, x; external liquidity, path, fees, arbitrage, duration, ...)
    >
  Profit_max(a, x; positions, capacity, execution, margin, liquidation,
             settlement, recovery, ...)
```

The model must map the same external price path through the production TWAP
and protocol mark/settlement rules, account for actual position open/close
and OI transitions, and compare values in the same numeraire. A finite set
of `attackCost / observedPnL` ratios does not supply this universal
relationship. No formula connecting it to `DeltaP_max` or LP capital is
established.

### F. What must be decided before implementation

This checkpoint does not make the decisions. The minimum blockers that the
next protocol-design checkpoint must resolve or explicitly leave open are:

1. The full protocol lifecycle used to define realizable extraction:
   position creation, close versus opposite-side trade, liquidation, and
   OI effects.
2. The price data path and time semantics that connect the assumed external
   pool path to TWAP observations; do not replace the arithmetic TWAP with
   the legacy geometric experiment.
3. Which mark/price is used for risk, settlement, and recovery, without
   silently resolving the already-unresolved settlement-boundary question.
4. How attacker cost is defined (capital requirement versus economic loss),
   calibrated, and made comparable in units with protocol extraction.
5. The feasible attack and parameter domain over which “maximum” or
   “minimum” is claimed, including liquidity, duration, strategy, margin,
   capacity, skew, and recovery dimensions.
6. Separate solvency requirements: position/OI conservation, liability
   reservation, vault backing, and cross-object settlement atomicity. An
   economic-cost ratio is not a substitute.
7. Which assumptions are paper-supported must be verified against an
   authoritative paper source; the repository prototype does not establish
   all those design rules.

## Final status

```text
ECONOMIC ATTACK MODEL STATUS: UNPROVEN
```

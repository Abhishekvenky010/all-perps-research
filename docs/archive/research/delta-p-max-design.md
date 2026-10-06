# Deriving `DeltaP_max` From Economic Security

## Decision

**B. PARTIALLY — constrained but not uniquely derived.**

The existing PnL and capacity equations give a conditional liability bound,
and an economic attack model could impose another conditional capacity bound
if its attack-cost function measured the cost of producing the same settlement
movement used to calculate profit. The repository experiments do not establish
that mapping: their attack cost depends on external-pool spot depth and
manipulation duration, while their profit is measured using TWAP targets,
protocol execution fills, recovery prices, and sometimes liquidation. The
paper/repository framing therefore does not produce one numerical,
protocol-wide `DeltaP_max`.

> The paper establishes an economic design principle, not a complete
> numerical `DeltaP_max` formula.

## 1. The problem

The prior solvency design gives the conditional relationship

```text
maximumPositivePnL <= DeltaP_max * maxCapacity

maxCapacity <= LP backing / DeltaP_max
```

Separately, the All Perps economic-security condition, as represented in the
repository research, is

```text
cost of TWAP attack > maximum extractable profit
```

The question is whether that second condition determines the first
relationship's `DeltaP_max`, instead of leaving it as a project parameter.
That would require attack cost and profit to be defined for the same movement,
scenario, and unit of account, with an attack-cost function that applies to
all permitted attacks. The experiments do not provide those things as a
general protocol rule.

## 2. Provenance and paper scope

The repository's research framing treats

```text
Cost of TWAP Attack > Maximum Extractable Profit
```

as **PAPER-SUPPORTED**. It is the economic design principle used in the
research model, not a formula for a settlement bound.

The tracked research material describes this as an All Perps-inspired
prototype and does not include a paper citation or a complete paper text from
which additional numerical requirements could be verified. In particular,
the repository research does not specify:

- a maximum TWAP deviation or maximum settlement-price movement;
- a price-bound formula tied to LP backing or capacity;
- a universal formula tying attack cost to capacity; or
- a numerical `DeltaP_max`.

Those absences agree with the prior checkpoint's classification in
[`solvency-model.md`](./solvency-model.md) and
[`solvency-design.md`](./solvency-design.md). No formula or numeric bound is
attributed to the paper here.

The relevant evidence sources are the research framing in
[`solvency-model.md`](./solvency-model.md) and
[`research-report.md`](./research-report.md), plus the experiment source files
listed below. The report itself cautions that its pricing rules are prototype
rules, not a reproduction of the paper's exact formulas.

## 3. What does `d` mean?

For the solvency inequality, define `d` in **raw price units** as the
maximum favorable movement from an individual position's entry price to its
settlement price:

```text
d_long  = max(settlementPrice - entryPrice, 0)
d_short = max(entryPrice - settlementPrice, 0)
d       = an upper bound on each position's favorable movement
```

This is not a percentage and is not, by itself, the difference between the
honest spot and manipulated spot. It is the quantity that multiplies `size`
in the prototype PnL equations:

```text
LONG  PnL = (settlementPrice - entryPrice) * size
SHORT PnL = (entryPrice - settlementPrice) * size
```

The economic experiments use several distinct price differences:

| Quantity | Meaning in the experiments | Role |
|---|---|---|
| `initialSpot - targetTwap` | Difference between the initial/reference spot (usually 100) and the target arithmetic TWAP | Describes the oracle target; not necessarily the spot manipulation depth |
| `initialSpot - requiredSpot` | Difference between initial spot and the spot required to produce that TWAP over a chosen duration | The external constant-product cost model's price-depth input |
| `averageExitPrice - averageEntryPrice` | Difference between the two protocol execution fills in the round-trip extraction model | Produces the headline round-trip PnL, including modeled execution impact |
| `recoveryPrice - entryPrice` (with the appropriate sign) | Settlement movement for a position closed at the experiment's recovery price | Drives settlement PnL in the settlement-path experiments |
| `d` in the solvency bound | Favorable entry-to-settlement movement for each open position | Bounds LP-financed positive PnL, if a protocol rule enforces it |

These quantities are not interchangeable. The attack-cost code takes the
**required manipulated spot** and duration, not `d` as defined for
solvency. Extraction code generally opens at a target TWAP and closes at a
recovery price through protocol execution, or settles at that recovery price.
The repository does not define a single conversion from those experiment
inputs to a universal settlement movement `d`.

The primary model,
[`attackEconomicsModel.ts`](../../experiments/archive/attackEconomicsModel.ts), uses an
arithmetic TWAP inversion:

```text
targetTwap * window
  = requiredSpot * duration
  + initialSpot * (window - duration)
```

Thus one target TWAP can require different spot depths at different
durations. A short manipulation may require a much deeper spot move, or be
unreachable at a non-positive spot. The experiments do not silently equate
`d` with an absolute TWAP percentage movement; they use price levels and
price-unit differences.

## 4. Extractable profit versus the PnL liability bound

### Formal PnL bound

For an individual long or short, positive PnL is at most `size * d` if its
favorable entry-to-settlement movement is bounded by `d`. If

```text
sum(position.size) <= totalOI <= maxCapacity
```

then, for all positions,

```text
sum(max(position.PnL, 0))
  <= d * sum(position.size)
  <= d * maxCapacity
```

This is a **FORMAL**, conditional upper bound from the prototype's PnL
equations and the assumed capacity invariant. It bounds the LP-financed
positive-PnL component; a returned trader margin is collateral accounting,
not additional trading profit. It only applies if the enforced capacity
invariant covers the sum of all open position sizes and a protocol rule
actually bounds every position's settlement movement by `d`.

### Experiment profit measures

The attack experiments do not all measure that same aggregate liability:

- `attackEconomicsModel.ts` calculates headline round-trip extraction as
  `(averageExitPrice - averageEntryPrice) * position.size`. Both fills go
  through `simulateTrade`, so execution impact and the attacker's own
  open-interest effects are included. This is a round-trip execution-PnL
  measure, not the bound `maxCapacity * d`.
- `economicSecuritySweep.ts` compares attack cost with that capacity sweep's
  **headline** extraction. It also separately records whether the position
  is liquidated at the manipulated mark; it does not turn the headline value
  into a general maximum-settlement-liability formula.
- `economicInvariantSweep.ts`, `economicDurationSweep.ts`, and
  `capacityAttackEconomics.ts` use protocol settlement paths at a chosen
  recovery price and record realized PnL (or zero where their modeled
  liquidation check prevents realization). They still test selected attack
  scenarios, not every portfolio of open positions and every allowed
  settlement price.
- `capacityNormalizedAttack.ts` and `perpsAttackSimulation.ts` explore
  selected entry/manipulation/recovery paths and margin survival; neither
  supplies an external attack-cost curve that maps all price movements to
  cost.

Therefore, `maxCapacity * d` is a conservative **portfolio PnL bound** under
its stated assumptions. It is not asserted to equal the attack experiments'
profit measure. The round-trip measures include execution prices and selected
recovery behavior; actual settlement measures use entry-to-recovery PnL and
survival/liquidation. None of the experiment output is a proof that the
portfolio-wide bound is attained or that it is the attacker's maximum
profit.

## 5. What the attack-cost experiments establish

### Cost model and dependencies

The newer attack-economics model uses an external constant-product pool with
prototype reserves. It estimates the cost of moving that pool from the
initial spot to the spot required for a target arithmetic TWAP, then models
sustaining that movement as

```text
attackCost = costPerBlock(requiredSpot) * manipulatedBlocks
```

The modeled cost depends on external pool depth, the required spot movement,
and duration. It does **not** depend on the attacker's perp position size or
`maxCapacity`. This is a **PROJECT ASSUMPTION** about an external AMM cost,
not an All Perps protocol mechanism or a paper-specified reserve model.
In the model, the repeated per-block cost is a simplifying sustained-cost
assumption; it is not derived from a block-by-block external pool simulation.
The separate restoration move is not added as another independent cost.

The protocol extraction side uses progressive execution pricing. Opening a
position changes OI; closing a long with a short trade can increase total OI
rather than net it away in this prototype. As a result:

- skew and capacity impact affect entry and exit fills and therefore
  headline extraction;
- self-flow can add protocol skew on top of the exogenous manipulated spot
  in TWAP replay;
- a trade can be rejected on entry or close at high utilization, so an
  unexecutable scenario has no round-trip extraction; and
- the attack-cost function still does not charge the attacker for the
  protocol's own skew, nor does the model establish a universal cost for
  every strategy.

Recovery price matters on extraction: the principal models generally use a
recovery to the initial price (typically 100). The recovery path also matters
to the margin/liquidation checks. It is an experiment input, not a guaranteed
protocol recovery rule.

### Experiment-by-experiment reading

| Experiment | Attacker cost | Extraction / movement | Capacity, skew, recovery | Evidence type and limitation |
|---|---|---|---|---|
| [`attackEconomicsModel.ts`](../../experiments/archive/attackEconomicsModel.ts) | External constant-product cost to reach required spot, multiplied by manipulated blocks | Round-trip average execution-price difference times position size; target TWAP and duration are separate from required spot | Uses real `simulateTrade` fills, capacity, skew, self-flow replay and a recovery to initial price; also checks liquidation along a sampled recovery path | Analytical formulas inside an empirical prototype; its cost model is explicitly an assumption |
| [`capacityAttackCostComparison.ts`](../../experiments/archive/capacityAttackCostComparison.ts) | One attack-cost value for the fixed full-window target; held fixed across attacker sizes | Headline and realizable PnL from capacity sweep at target TWAP 90 | Varies utilization; cost is independent of position size; execution and capacity checks affect rows | Empirical size sweep under one configuration, not a general capacity formula |
| [`capacityAttackEconomics.ts`](../../experiments/archive/capacityAttackEconomics.ts) | No external manipulation-cost computation in this script | Settlement PnL on recovery to 100 after opening at manipulated TWAP 95 | Sizes vary from 10% to 50% of capacity; uses protocol trade/settlement paths, skew, margin and liquidation checks | Empirical protocol-path experiment; cannot prove attack cost exceeds payout |
| [`capacityNormalizedAttack.ts`](../../experiments/archive/capacityNormalizedAttack.ts) | No attack-cost computation | Positive settlement PnL after a 95-to-100 recovery; required LP capital is set to that realized PnL | Varies size utilization, calculates margin needed to survive manipulated mark; recovery uses actual close settlement | Empirical liability illustration only; it does not price the external attack |
| [`economicInvariantSweep.ts`](../../experiments/archive/economicInvariantSweep.ts) | Separate external constant-product reserve model; spot cost times manipulated blocks | Uses real perp execution/settlement flow and a selected recovery price; reports realized PnL and attack-cost/PnL ratio | Sweeps target TWAP and utilization for full-window duration; sizes attacker margin to survive; uses a large vault to avoid vault truncation | Finite empirical grid over an assumed cost model; passing rows do not establish universal security |
| [`economicSecuritySweep.ts`](../../experiments/archive/economicSecuritySweep.ts) | Reuses `attackEconomicsModel.ts` external-pool cost for target TWAP and duration | Compares cost with capacity sweep's headline extraction; separately tracks realizability/liquidation | Three axes: target TWAP, duration and attacker size; duration changes required spot/cost while extraction is held fixed for a given target and size | Broad empirical matrix; the comparison is still model-dependent and headline PnL is not the portfolio liability bound |
| [`economicDurationSweep.ts`](../../experiments/archive/economicDurationSweep.ts) | External constant-product cost to required spot times manipulated blocks | Protocol settlement PnL after selected recovery, with liquidation/survival checks | Sweeps target, duration and utilization; uses progressive pricing and recovery to initial price | Empirical finite sweep with a project cost assumption |
| [`fullAttackEconomics.ts`](../../experiments/archive/fullAttackEconomics.ts) | Delegates to `attackEconomicsModel.ts` | Prints reachable/unreachable attacks, headline extraction, liquidation and capacity results | Reports target, duration, self-flow feasibility and a capacity axis; its summary calls out the modeled thinnest ratio | Experiment runner/report, not an independent cost model or proof |
| [`twapAttackCost.ts`](../../experiments/archive/twapAttackCost.ts) | Constant-product cost with prototype reserves and a simplified multi-block rule; also computes a break-even reserve from a fixed extraction sample | Uses a pre-measured perp extraction number; its TWAP inversion is geometric | Not the production arithmetic TWAP model; does not provide a validated protocol-wide link from cost to settlement movement | Legacy/alternate empirical model. Its geometric TWAP output must not be treated as the current oracle's exact mapping |
| [`perpsAttackSimulation.ts`](../../experiments/archive/perpsAttackSimulation.ts) | Assumes external TWAP manipulation has already happened; explicitly does not price it | Opens at manipulated TWAP 95 and tests PnL/settlement after recovery to 100 | Uses protocol execution, skew, capacity, margin and recovery/liquidation checks | Empirical protocol-side scenario only; no attack-cost comparison |

The corresponding attack-economics tests assert the cost-versus-round-trip
condition for the configured reachable cases and pin several cost-model
properties. Such test assertions are **EMPIRICAL/model-scope** evidence: they
do not prove the condition for untested movements, external liquidity, attack
strategies, or protocol states. In this environment, the test and experiment
commands could not be executed because `npm` is unavailable; the source and
assertions were inspected, but this note does not claim a fresh test run.

## 6. Can attack cost constrain capacity?

The commonly proposed inequality

```text
maxCapacity < attackCost(d) / d
```

does **not** follow from the economic condition alone. Let `C` be capacity,
`A(s)` attack cost for a fully specified scenario `s`, and `P(C,s)` the
maximum attacker profit for that scenario. The economic condition is

```text
A(s) > P(C, s)
```

The portfolio liability bound supplies only an upper bound:

```text
P(C, s) <= C * d(s)
```

From `A(s) > P(C,s)` and `P(C,s) <= C*d(s)`, it is invalid to conclude
`A(s) > C*d(s)`: the capacity-based bound may be loose. The inequality
`C < A(s)/d(s)` follows as an equivalent condition only if the modeled
maximum profit is exactly `C*d(s)`. If `C*d(s)` is merely a conservative
upper bound, imposing `C*d(s) < A(s)` is a **sufficient but potentially
overly restrictive design constraint**; it is not a consequence of the
paper's economic condition.

Either route would require stronger, explicit conditions:

1. `d` is the same favorable entry-to-settlement movement used by the PnL
   bound.
2. `attackCost(d)` is the attacker's minimum total cost to create and exploit
   that movement, including relevant manipulation duration, recovery,
   execution, and other attack costs.
3. The actual maximum profit function for that exact scenario is known; to
   use `maxCapacity * d` as an equivalent bound, profit must equal that
   expression, or the protocol must deliberately impose it as a stronger
   conservative surrogate.
4. The inequality is checked for every feasible attack scenario and
   settlement movement the protocol allows.

If the maximum profit were exactly `maxCapacity * d`, then for each positive
`d`:

```text
maximumExtractableProfit(d) < attackCost(d)
```

would imply

```text
maxCapacity < attackCost(d) / d
```

Alternatively, a protocol could choose the stronger conservative condition
`maxCapacity * d < attackCost(d)` and thereby obtain that same ceiling as a
sufficient policy. Applied across all allowed scenarios, the conditional
ceiling would be

```text
maxCapacity < inf_over_allowed_scenarios(
  attackCost(scenario) / d(scenario)
)
```

Neither route is established by the current repository result. The current
model does not give a well-defined `attackCost(d)` or exact
`maximumExtractableProfit(C,d)`:

- cost is parameterized by required external spot and duration, not
  settlement movement alone;
- settlement movement is affected by the target TWAP, execution fills,
  capacity/skew, and recovery;
- external reserve depth and repeated-cost assumptions are chosen
  experiment inputs;
- some sweeps compare cost to headline round-trip PnL, while others compare
  cost to realized settlement PnL; and
- the empirical grids cover selected targets, durations, utilizations and
  configurations, not every allowed scenario.

The experiments therefore support neither a necessary universal
`maxCapacity < attackCost(d)/d` rule nor a numerical capacity ceiling from
attack economics alone. One could calculate a scenario-specific ratio from a
selected experiment setup, or deliberately adopt the stronger ratio as a
policy under a calibrated cost lower bound, but treating its minimum as a
protocol bound would require additional model validation and an explicit
definition of the attack domain.

## 7. Attack cost is not LP backing

These quantities answer different questions:

```text
attack cost:
  what the attacker loses to manipulate an external price source

LP payout:
  the positive settlement PnL owed by the protocol to a trader
```

The external manipulation cost is not automatically deposited in the LP
vault. Consequently:

- `attack cost > extractable profit` can make an attack economically
  unattractive while the protocol still lacks funds to pay the trader's
  positive PnL; and
- `LP backing >= trader payout` can make settlement solvent while the
  attacker's profit still exceeds manipulation cost.

Economic security does not imply solvency, and solvency does not imply
economic security. The additional solvency constraint is an independently
enforced bound on protocol payout:

```text
maximumPositivePnL <= available LP backing
```

Under the current PnL and capacity assumptions, a sufficient condition is

```text
DeltaP_max * maxCapacity <= available LP backing
```

That condition needs an authoritative settlement price and an enforced
movement limit; an experiment's profitable/unprofitable attack result is not
a substitute.

## 8. Assessment of the four parameter choices

### Option A — fixed protocol parameter

Choosing `DeltaP_max = X` gives a clear liability ceiling only if the
settlement path rejects or otherwise handles prices outside that movement
bound. It then gives a solvency-based capacity ceiling of
`LP backing / X`. It does not respond automatically to changes in LP capital,
external liquidity, skew, or attack duration, and the paper/repository does
not select `X`.

**Assessment:** valid as a project risk parameter; not derived from the
economic-security experiments.

### Option B — derived from LP capital and capacity

For chosen capital `L` and capacity `C`, `L / C` is the largest per-unit
favorable movement permitted by the simplified solvency inequality:

```text
DeltaP_solvency <= L / C
```

This is a **solvency frontier**, not an independent market-movement law and
not an economic-security result. If `DeltaP_max` is set to `L / C`, the
liability bound consumes all backing with no buffer. It still requires the
protocol to enforce the movement limit and account for available backing
correctly.

**Assessment:** mathematically useful as a conditional solvency constraint;
it does not derive a uniquely justified `DeltaP_max`.

### Option C — derived from attack economics

An exact, validated attack model could define the permitted movement set as
the movements for which attack cost exceeds maximum extractable profit, and
could then constrain capacity by the worst attack-cost-to-profit ratio.
Deriving a single maximum movement would additionally require that the
condition hold for every feasible attack up to that movement.

The current experiments do not provide a universal cost function in
settlement-movement units, and their external AMM cost model is a project
assumption. No experiment establishes a numerical protocol-wide boundary.

**Assessment:** possible only after adding and validating the missing
protocol-level cost-to-settlement mapping; not derived by current evidence.

### Option D — dynamic parameter

`DeltaP_max` could be made responsive to LP capital, capacity, external
liquidity, TWAP manipulation cost, skew, utilization, or time. The repository
does not define an update rule or prove that any of these inputs produces a
safe dynamic limit. More dynamic inputs do not repair the current mismatch
between attack-cost and settlement-movement measurements.

**Assessment:** not justified by current evidence. Do not select a dynamic
rule merely because the relevant risks vary.

## 9. Formal, empirical, and assumed claims

| Claim | Classification | Boundary |
|---|---|---|
| Positive PnL for a position is bounded by `size * d` when favorable entry-to-settlement movement is bounded by `d` | **FORMAL**, conditional on the PnL equation and enforced movement bound | Does not establish that the current settlement path enforces the bound |
| Aggregate positive PnL is at most `d * maxCapacity` when total open position size is bounded by `maxCapacity` | **FORMAL**, conditional on complete OI accounting and the per-position movement bound | A liability upper bound, not proof of current implementation solvency |
| `maxCapacity <= LP backing / DeltaP_max` is sufficient for the simplified PnL liability bound | **FORMAL**, conditional on the previous assumptions and correctly measured available backing | No economic-security conclusion; no buffer is implied |
| The All Perps research principle compares TWAP attack cost with maximum extractable profit | **PAPER-SUPPORTED** in the repository's research framing | No paper-specified numerical `DeltaP_max` or universal cost formula is present in repository materials |
| A constant-product external pool with configured reserves approximates manipulation cost | **ASSUMPTION** | Not specified as the All Perps pool or attack-cost mechanism |
| Multiplying per-block manipulation cost by manipulated blocks approximates sustained attack cost | **ASSUMPTION** | Simplified experiment rule, not a simulated or proven total attacker cost |
| Tested model scenarios satisfy the test's attack-cost-versus-profit assertions | **EMPIRICAL** for the tested model/configuration, based on source assertions | Not universal over price movements, pool depth, strategies, or protocol states; fresh execution unavailable here |
| Progressive skew/capacity pricing changes modeled fills and can reduce headline extraction or affect closeability | **EMPIRICAL** in the prototype attack sweeps | Does not itself bound settlement liability or external manipulation cost |
| A unique safe `DeltaP_max` can be calculated from the current attack experiments | **ASSUMPTION** if claimed | The cost and profit measurements do not share a universal movement variable or exhaustive scenario domain |

## 10. Final protocol implication

The minimum honest model has two separate constraints:

```text
LP backing
    ↓
capacity and enforced settlement-movement bound
    ↓
maximum LP-financed trader liability
```

and

```text
external AMM liquidity + manipulation duration
    ↓
modeled TWAP attack cost
    compared with
modeled extractable profit
    ↓
economic-security evidence for tested scenarios
```

They can be combined into a single capacity rule only after a validated,
scenario-complete attack-cost function is expressed against the same
settlement movement and profit bound. The repository experiments do not
support that combination as a formal protocol rule today. Keep solvency and
economic security as separate constraints.

### Required next protocol-level decision

The next missing decision is the authoritative settlement-price rule and the
enforcement mechanism for a finite entry-to-settlement movement bound. Until
the protocol decides how a settlement outside that bound is handled, a
chosen `DeltaP_max` is not a guarantee about reachable settlement prices.
Separately, turning the economic-security sweeps into a capacity rule would
require specifying the external liquidity/cost model and its attack domain;
that is not a substitute for the settlement-bound decision.

## Final verdict

**Can `DeltaP_max` be derived? B. PARTIALLY — constrained but not uniquely
derived.**

1. **What mathematically determines maximum liability?** Given the current
   PnL equations, a finite enforced favorable settlement movement `d`, and
   `totalOI <= maxCapacity`, maximum LP-financed positive PnL is bounded by
   `d * maxCapacity`.
2. **What determines capacity?** Under that solvency model, LP backing and
   the selected/enforced `DeltaP_max` constrain it:
   `maxCapacity <= LP backing / DeltaP_max`.
3. **What determines attack resistance?** External manipulation cost relative
   to maximum extractable profit, modeled in the repository using
   constant-product external AMM experiments plus protocol execution,
   recovery, and liquidation scenarios.
4. **What remains unspecified by the paper?** The numerical `DeltaP_max`,
   maximum settlement movement, LP capital-to-capacity formula, universal
   attack-cost-to-capacity formula, and specific oracle movement bound.
5. **What remains empirical?** The external-AMM cost approximation, its
   duration multiplier, and outcomes over finite target/duration/size
   sweeps; these are not guarantees for all attacks or states.
6. **Can we now claim a formal solvency proof?** No end-to-end proof. The
   liability inequality is formal conditional algebra, but the current
   repository does not enforce the settlement movement limit or establish
   one authoritative settlement price. The empirical attack-cost result
   cannot fill that gap.
7. **What is the next missing protocol-level decision?** Define settlement
   price authority and the protocol behavior that enforces or handles the
   maximum entry-to-settlement movement. Then validate whether an explicit
   external-liquidity attack model can support any additional economic
   capacity constraint.

```text
DELTA_P_MAX STATUS:
PARTIALLY DERIVED
```

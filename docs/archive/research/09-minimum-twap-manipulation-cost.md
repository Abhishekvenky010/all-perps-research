# Minimum TWAP Manipulation Cost Under the Current Research Model

This document examines the attacker-cost side of the economic-security
condition using the existing experiments without replacing or silently
improving their assumptions. It adds no production code or protocol
mechanisms.

## 1. Security inequality

For the same manipulated reference/TWAP path \(z\), the target condition is:

\[
\boxed{\forall z:\quad C_{\min}(z)>P_{\max}(z;B,K)}
\]

Here \(C_{\min}(z)\) means the least net economic cost over attacker
strategies that produce the specified path, and \(P_{\max}\) is the maximum
realizable extraction under that same path. A comparison is meaningful only
when the cost and extraction refer to the same price path, timing, and
settlement.

The repository calculates selected model costs and selected extraction
outputs. It does not calculate \(C_{\min}\), and its finite experiments do
not establish the universal inequality.

## 2. Existing attack-cost model

There are two separate constant-product experiments.

### Current arithmetic-TWAP model

[`attackEconomicsModel.ts`](../../experiments/archive/attackEconomicsModel.ts) uses:

| Quantity | Configured value |
|---|---:|
| Normal spot \(P_0\) | 100 |
| Initial base reserve \(x_0\) | 50,000 |
| Initial quote reserve \(y_0\) | 5,000,000 |
| Reserve-implied initial spot \(y_0/x_0\) | 100 |
| TWAP window \(W\) | 900 seconds |
| Observation interval | 15 seconds |
| Capacity / skew / capacity coefficients | 100,000 / 0.2 / 0.05 |
| Production-TWAP attack cost multiplier | \(d/15\) intervals |

The function `manipulationAttackCost(target,duration)` calculates a
one-shot cost to move a fixed assumed pool to `target`, then multiplies that
same value by `duration / 15`:

\[
C_{\mathrm{proxy}}(P_m,d)
=c_{\mathrm{spot}}(P_m)\frac{d}{15}.
\]

The current arithmetic-TWAP sweep supplies as \(P_m\) the spot/reference
level derived from the target TWAP and duration. In this cost helper, each
15-second interval uses the same assumed starting reserves; reserves are not
carried from one interval to the next.

### Legacy Euler-inspired geometric model

[`twapAttackCost.ts`](../../experiments/archive/twapAttackCost.ts) instead uses a
72-block geometric TWAP, \(P_0=100\), \(x_0=50{,}000\),
\(y_0=5{,}000{,}000\), target TWAP 60, and a 72-block headline
manipulation. It also calculates a one-shot reserve-price trade cost and
multiplies it by the number of manipulated blocks. Its configured perp
extraction is a separate fixed measurement,
`1,918,154.7619047621`; it is not derived from the same production arithmetic
TWAP lifecycle.

The legacy model's geometric equation is not the production oracle. The two
experiments must not be blended into one cost/TWAP model.

## 3. Spot manipulation cost

The assumed external pool is a no-fee constant-product pool:

\[
xy=k,\qquad P=\frac{y}{x}.
\]

Let the initial reserves be \((x_0,y_0)\), with \(P_0=y_0/x_0\). To push
the price down, the experiment has the attacker add base asset \(\Delta x\)
and withdraw quote asset \(\Delta y\). The final pool reserves are:

\[
x_1=x_0+\Delta x,\qquad
y_1=\frac{x_0y_0}{x_1},\qquad
P_m=\frac{y_1}{x_1}
=\frac{x_0y_0}{(x_0+\Delta x)^2}.
\]

Solving for the attacker base input gives the exact implementation formula:

\[
\boxed{\Delta x=\sqrt{\frac{x_0y_0}{P_m}}-x_0}
\]

and the quote output is:

\[
\boxed{\Delta y=y_0-\frac{x_0y_0}{x_0+\Delta x}}.
\]

Equivalently, at the target price, \(x_1=\sqrt{k/P_m}\) and
\(y_1=\sqrt{kP_m}\), so \(\Delta y=y_0-\sqrt{kP_m}\). This matches
`requiredBaseInput` and `quoteReceived` in the experiments.

The experiment labels the following quote-denominated quantity as
`costPerBlock` or one-way manipulation cost:

\[
\boxed{c_{\mathrm{spot}}=\Delta x\,P_0-\Delta y.}
\]

It values the base input at the initial reference price and subtracts the
quote received. This is the code's chosen inventory/slippage-loss proxy for
one move from the assumed initial pool state. It is not the gross amount of
capital required: the trade inputs \(\Delta x\) units of base and returns
\(\Delta y\) units of quote. Nor is this formula by itself the realized net
cost after the attacker exits.

## 4. Sustained manipulation

The newer model calls the number of 15-second intervals
\[
b=\frac{d}{15}
\]
and reports:
\[
\boxed{C_{\mathrm{proxy}}=b\,c_{\mathrm{spot}}.}
\]

The code does not evolve one shared external pool through those intervals.
It recalculates the same one-shot reserve move from the original
\((50{,}000,5{,}000{,}000)\) reserves and multiplies its loss proxy by the
interval count. It does not execute \(b\) sequential swaps against a
changing pool; it does not define repeated replenishment or a market maker
that must trade once per observation. This is therefore a **repeated
slippage proxy**, not an implemented sustained pool lifecycle.

The legacy geometric experiment has the same essential multiplier:
`costPerBlock * manipulatedBlocks`, with its separate 72-block/geometric
assumptions.

Three different quantities must remain distinct:

| Quantity | Meaning | Present in repository? |
|---|---|---|
| **A. Spot manipulation cost** | One trade moving the assumed external CPMM from \(P_0\) to \(P_m\), scored as \(\Delta xP_0-\Delta y\) | Yes, as an experimental calculation with fixed assumed reserves |
| **B. Sustained manipulation cost** | Cost of maintaining the external pool/reference observations at the manipulated level for \(d\) | Only approximated by repeating the one-shot score per interval; no evolving pool/maintenance strategy |
| **C. Net attack cost** | Attacker's actual economic loss after unwind, arbitrage, fees, price recovery, inventory value, and financing | No |

No fees are deducted in the CPMM formulas. The cost helpers do not model
arbitrage, back-running, financing, gas, a trader balance sheet, or an
attacker inventory state. Those omissions have no established uniform
direction for the total net cost; fees in a real pool could increase gross
trading cost, while inventory recovery could reduce net loss.

In the idealized no-fee constant-product equation alone, reversing the exact
swap restores the original reserves and returns the attacker's exchanged
inventories. That observation is not a claim about a real venue or about the
cost of holding the price: it demonstrates why the one-way
\(\Delta xP_0-\Delta y\) score is not, without a lifecycle, the net cost of
manipulate-then-unwind.

## 5. TWAP mapping

### Production arithmetic TWAP

[`TWAPOracle.ts`](../../src/oracle/TWAPOracle.ts) uses a 900-second arithmetic
time-weighted mean of piecewise-constant observations. For a normal price
\(P_0\) over \(W-d\) seconds and a constant manipulated observation \(P_m\)
over \(d\) seconds:

\[
R=\frac{P_0(W-d)+P_m d}{W}.
\]

Solving for the observation required during the manipulated segment:

\[
\boxed{P_m=\frac{RW-P_0(W-d)}{d}.}
\]

This is also `requiredSpotForTwap` in the attack-economics model, with
\(W=900\) and \(P_0=100\). For a time-varying manipulated sequence with
segments \((P_j,\Delta t_j)\), the corresponding production-oracle mapping
is:

\[
R=\frac{1}{W}\sum_j P_j\Delta t_j,\qquad
\sum_j\Delta t_j=W.
\]

The scenario code uses equal 15-second observations. For target \(R=95\),
the required constant observation for selected durations is:

| Manipulated duration \(d\) | Required observation \(P_m\) | Result |
|---:|---:|---|
| 900s | 95 | Positive and reachable in the arithmetic calculation |
| 600s | 92.5 | Positive |
| 300s | 85 | Positive |
| 120s | 62.5 | Positive |
| 60s | 25 | Positive |
| 30s | -50 | Invalid: a nonpositive observation is rejected |
| 15s | -200 | Invalid: a nonpositive observation is rejected |

The oracle itself weights by elapsed time rather than counting a fixed
number of observations. For the 900-second example, the scenario records
price 95 at timestamps \(0,15,\ldots,885\); each interval contributes 15
seconds, for 60 manipulated intervals. It records price 100 at timestamp
900, which is at `now` and contributes no time to that just-completed TWAP.
It then feeds 100 through the next 900-second window until the TWAP recovers
to 100.

### Legacy geometric TWAP

Only `twapAttackCost.ts` uses:

\[
R=(P_0^{N-m}P_m^m)^{1/N},\qquad
P_m=\left(\frac{R^N}{P_0^{N-m}}\right)^{1/m}.
\]

That is a separate Euler-inspired historical experiment. It is not the
production oracle's arithmetic formula and must not be used to derive
production required observations.

## 6. Observation-source assumptions

The repository contains a production-facing observation interface and an
arithmetic TWAP updater, but not the external market connection:

| Link | Classification | Evidence / limit |
|---|---|---|
| External CPMM reserves \(\to\) CPMM spot | **SIMULATED** | Reserve equations exist only in experiment code; no external AMM component in `src/` |
| External CPMM spot \(\to\) source observation | **MISSING** | No implementation connects the experiment pool state to `ReferencePriceSource` |
| Reference source \(\to\) validated observation | **IMPLEMENTED as interface/service behavior; source itself missing** | `ReferencePriceSource` exposes `getLatestObservation`; `updateMarketFromReferencePrice` validates observation handling, but no real/authenticated provider is present |
| Observation sequence \(\to\) arithmetic TWAP | **IMPLEMENTED** | `calculateTWAP` weights and validates observations over the complete 900-second window |
| Scenario-controlled prices \(\to\) reference observations | **SIMULATED / ASSUMED** | `implementedEconomicSecurity.ts` supplies an inline source closure returning the chosen price and timestamp |
| Attacker's ability to control the source observations | **ASSUMED, not established** | No source-control, market-integrity, manipulation threshold, or attacker strategy model |

The experiments therefore simulate selected price observations through the
repository's oracle arithmetic. They do not establish that a real attacker
can move an external CPMM and thereby cause the corresponding observations.
The source mapping and observation controllability are the missing bridge.

## 7. Definition of \(C_{\min}(z)\)

For a specified observation path \(z=(P_1,\ldots,P_N)\), with timestamps,
durations, external venue state, and required observation values fixed, define:

\[
\boxed{
C_{\min}(z)=
\inf_{\alpha\in\mathcal A(z)}
C_{\mathrm{net}}(\alpha)
}
\]

where \(\mathcal A(z)\) is the set of attacker strategies that actually
produce \(z\), and \(C_{\mathrm{net}}(\alpha)\) is the strategy's net
economic loss after all recoveries, proceeds, fees, financing, inventory
valuation, and other relevant cashflows. If no attacker strategy can produce
\(z\), then the path is unattainable rather than a finite-cost attack.

The repository cannot compute this minimum. Its cost helper receives a
target spot and duration, assumes fixed CPMM reserves, and returns a repeated
one-way proxy. It does not optimize over strategies; calculate a shared
pool's time evolution; connect the pool to a source; represent inventory or
unwind cashflows; or establish completeness of its strategy space. Thus its
`attackCost` is neither a proven lower bound on \(C_{\min}\) nor a proven
upper bound.

## 8. Worked TWAP95 example

Use the same path as the realized-profit example in
[`08-maximum-extractable-profit.md`](./08-maximum-extractable-profit.md):

```text
normal reference price = 100
manipulated arithmetic TWAP = 95
manipulation duration = 900 seconds
recovery reference price = 100 over the following 900 seconds
```

### Observations and required spot

With the full 900-second window manipulated, \(d=W=900\), so the required
constant reference observation is:

\[
P_m=\frac{95(900)-100(900-900)}{900}=95.
\]

The sampled path is 60 intervals of 15 seconds at 95, then 60 intervals at
100 in the recovery window. The target-window arithmetic TWAP is 95; after
the recovery window it is 100.

### One-shot CPMM move

The cost model assumes \(x_0=50{,}000\) base and
\(y_0=5{,}000{,}000\) quote, with \(P_0=100\), and calculates a single move
to \(P_m=95\):

| Quantity | Value |
|---|---:|
| \(x_0\) | 50,000 base |
| \(y_0\) | 5,000,000 quote |
| \(x_1=\sqrt{x_0y_0/P_m}\) | 51,298.917604 base |
| \(y_1=x_0y_0/x_1\) | 4,873,397.172404 quote |
| Required base input \(\Delta x=x_1-x_0\) | 1,298.917604 base |
| Quote output \(\Delta y=y_0-y_1\) | 126,602.827596 quote |
| One-move score \(\Delta xP_0-\Delta y\) | 3,288.932830 quote |

At the normal price, the base input is valued at \(129{,}891.760426\) quote.
Subtracting the \(126{,}602.827596\) quote output gives the \(3{,}288.932830\)
one-move inventory/slippage score.

### Reported duration cost and unwind

The current arithmetic attack-cost helper applies 60 intervals:

\[
C_{\mathrm{proxy}}
=3{,}288.932830252219\times60
=\boxed{197{,}335.96981513314}.
\]

The model's notional one-shot trade input is 1,298.917604 base; the model
does not establish that the attacker must newly provide that amount each
interval. Its 60-times score is not 60 evolving CPMM trades and does not
compute an attacker capital peak.

The model records no explicit unwind. Its assumed reference-price recovery
is replayed through the oracle for the perp scenario; it is not an AMM
reverse trade. Therefore net cost after unwind/recovery cannot be calculated
from the reported \(197{,}335.969815\). Arbitrage, fees, inventory recovery,
and financing are also absent. The number is specifically a **repeated
one-way slippage proxy**, not actual economic cost or required capital.

## 9. Cost vs realized extraction

For the worked protocol scenario with a 10,000 LONG, five opening steps,
1x leverage (10,000 margin), and 1,000,000 initial available vault capital:

| Quantity | Value |
|---|---:|
| Same path's target TWAP / recovery TWAP | 95 / 100 |
| Production entry price | 95.8623308492 |
| Canonical settlement price | 100 |
| Realized settlement PnL | 41,376.6915082 |
| Repeated slippage proxy | 197,335.9698151 |
| Proxy / realized extraction | 4.769254x |

These inputs and path correspond to the `simulateImplementedEconomicScenario`
run with `targetTwap: 95`, `duration: 900`, `utilization: 0.1`,
`vaultDeposit: 1_000_000`, and `leverage: 1`. This reproduces the prior
worked example. The comparison is internally same-path at the level of
target/duration assumptions, but the CPMM is not causally linked to the
scenario's observations, and the numerator is not a net-cost lower bound.

Thus this row establishes only:

```text
modeled repeated slippage proxy > this scenario's realized accounting PnL
```

It does not establish \(C_{\min}(z)>P_{\max}(z;B,K)\).

## 10. Existing experimental matrix

The following matrix uses the existing
`simulateImplementedEconomicScenario` lifecycle function over its default
targets \(\{95,90,85,80\}\), durations
\(\{15,30,60,120,300,600,900\}\), and utilization values
\(\{0.1,0.2,0.3,0.4,0.5\}\). For this extraction comparison, the existing
function was run with 1x leverage and 10,000,000 initial vault capital so
positive-PnL settlements did not fail solely for backing. Capacity is
100,000. This gives 140 parameter combinations:

- 65 are rejected before opening because the constant-observation arithmetic
  inversion requires a nonpositive reference price.
- 60 open but are liquidated in the simulated lifecycle.
- 15 reach a successful positive-PnL settlement.

Only the last 15 have a positive realized extraction and hence a meaningful
cost/extraction ratio. In every row below, the cost is calculated from that
row's own required manipulated observation and duration, and the extraction
uses that row's target TWAP, size, and recovery. Thus each comparison is
same-path within the research scenario's assumptions.

| TWAP | Duration | Capacity | Size | Realized profit | Cost proxy | Proxy / profit |
|---:|---:|---:|---:|---:|---:|---:|
| 95 | 900s | 100,000 | 10,000 | 41,376.69 | 197,335.97 | 4.77x |
| 95 | 600s | 100,000 | 10,000 | 41,376.69 | 303,938.58 | 7.35x |
| 90 | 900s | 100,000 | 10,000 | 91,830.55 | 832,755.43 | 9.07x |
| 85 | 900s | 100,000 | 10,000 | 142,284.41 | 1,982,020.45 | 13.93x |
| 90 | 600s | 100,000 | 10,000 | 91,830.55 | 1,321,346.96 | 14.39x |
| 95 | 300s | 100,000 | 10,000 | 41,376.69 | 660,673.48 | 15.97x |
| 80 | 900s | 100,000 | 10,000 | 192,738.27 | 3,738,353.92 | 19.40x |
| 85 | 600s | 100,000 | 10,000 | 142,284.41 | 3,252,902.32 | 22.86x |
| 80 | 600s | 100,000 | 10,000 | 192,738.27 | 6,377,727.17 | 33.09x |
| 90 | 300s | 100,000 | 10,000 | 91,830.55 | 3,188,863.59 | 34.73x |
| 95 | 120s | 100,000 | 10,000 | 41,376.69 | 2,219,219.16 | 53.63x |
| 85 | 300s | 100,000 | 10,000 | 142,284.41 | 9,001,957.36 | 63.27x |
| 80 | 300s | 100,000 | 10,000 | 192,738.27 | 21,359,436.21 | 110.82x |
| 90 | 120s | 100,000 | 10,000 | 91,830.55 | 20,000,000.00 | 217.79x |
| 95 | 60s | 100,000 | 10,000 | 41,376.69 | 10,000,000.00 | 241.68x |

For these 15 positive-extraction rows:

- **Best proxy ratio (lowest cost/profit):** 4.769x, TWAP95 for 900s.
- **Worst proxy ratio (highest cost/profit):** 241.682x, TWAP95 for 60s.
- **Tested ratio below 1:** none.
- **Tested ratio close to 1:** none; the closest is 4.769x.

These extrema describe only the 15 positive-extraction rows in this
specified grid, leverage, vault, and cost proxy. The default
`simulateImplementedEconomicScenario` leverage is 5x; across the same 140
grid rows at 5x, 75 opened and were liquidated and 65 were rejected before
opening, so there was no positive realized extraction to form a
cost/extraction ratio. A zero-extraction or rejected row is not evidence of
a universal cost bound.

The separate legacy `runAttackSweep` has 16 finite positive
`costToProfitRatio` rows; its lowest is 4.277x (target TWAP90, 900s) and
highest is 245.582x (target TWAP70, 300s). Those denominators are
`roundTripPnl` values formed by opening a LONG and then opening a SHORT with
`simulateTrade`, not settlement of the original position. All rows are
classified as non-realizable by its liquidation check. These ratios are
reported here only to describe the existing tests and are **not** part of
the realized-extraction matrix above.

Historical experiment documents that compare the proxy to gross or
caller-priced settlement PnL, including earlier ratios below one, use
different lifecycle assumptions. They do not override the current
canonical-settlement grid's zero extraction in default 5x scenarios and do
not establish a net attack cost.

## 11. What is proven

- The CPMM functions implement the stated no-fee invariant arithmetic for a
  downward pool move from the configured reserves to a selected target spot.
- The current model computes the one-shot score
  \(\Delta xP_0-\Delta y\), then multiplies it by \(d/15\).
- The production TWAP oracle implements an arithmetic, elapsed-time-weighted
  mean over a complete 900-second window.
- Given a supplied piecewise-constant observation sequence, its resulting
  arithmetic TWAP follows the stated price-time equation.
- The implemented attack scenario can replay chosen reference observations
  through the production-facing reference service and TWAP code, then run
  trade, risk, and canonical settlement functions.
- Focused attack-economics and implemented-economic-security tests pass:
  `tests/attackEconomics.test.ts` and
  `tests/implementedEconomicSecurity.test.ts` (28 tests total).

These are claims about formulas and finite program executions under their
input assumptions; none establishes that an external attacker can cause
those observations.

## 12. What is empirical

- The TWAP95/900s run reports \(197{,}335.969815\) as its attack-cost proxy
  and \(41{,}376.691508\) as realized PnL for the selected 1x-margin
  protocol scenario.
- The 140-row lifecycle grid has the outcomes and 15 positive-extraction
  ratios tabulated above.
- The legacy attack-economics model's finite grid has the reported
  cost-to-headline-fill ratios and marks its modeled positions as not
  realizable.

These results are reproducible computations under selected constants,
scenarios, and code paths. They are not empirical measurements from an
external venue and are not exhaustive optimization results.

## 13. What remains unproven

- That the external pool spot is the price observed by the configured
  reference source (**external AMM-to-oracle mapping is missing**).
- That an attacker can control the required observations, or that other
  source users cannot prevent or arbitrage that path.
- That the repeated one-way score is sustained economic cost; the pool is
  not evolved across intervals.
- The attacker's actual net cost after unwind, inventory recovery, arbitrage,
  fees, financing, and other cashflows.
- That the CPMM reserves, source aggregation, sampling timestamps, or
  observation intervals represent a real venue/oracle.
- A minimum over all attacker strategies that produce a specified path.
- A maximum over all perp sizes, sides, margins, step counts, other OI,
  liquidation timing, settlement states, and manipulation paths.
- A global comparison of that minimum net cost with maximum realized
  extraction.

Consequently, even a sampled result \(C_{\mathrm{proxy}}>P_{\mathrm{realized}}\)
does not imply \(C_{\min}>P_{\max}\). The first compares a **proxy** against
one **sampled attack**; the required inequality compares a minimum net cost
against the optimal feasible extraction for every path.

## 14. Requirements for a global economic-security proof

The missing proof bridge is a common, scenario-consistent mathematical model
with:

1. A defined external venue state and validated reserve/depth parameters.
2. A specified mapping from venue trades and prices to the actual
   `ReferencePriceSource` observations, including sampling, timestamps,
   aggregation, and controllability.
3. An attacker strategy/state model that evolves pool reserves through
   manipulation, holding, arbitrage, and unwind, and accounts for relevant
   inventory recovery, fees, financing, and other net cashflows.
4. A sound lower bound \(C_{\min}(z)\) over every feasible strategy that
   produces each admissible observation path \(z\), or a complete
   optimization that computes that infimum.
5. A sound upper bound \(P_{\max}(z;B,K)\) over the same paths and all
   feasible perp choices: side, size, margin constraints, execution steps,
   existing OI, survival/liquidation, canonical settlement, and current
   vault accounting.
6. Defined bounds/domains for external depth, prices, capacity, LP backing,
   other positions, and observation paths sufficient to make both
   optimizations finite and exhaustive or analytically bounded.
7. A proof or validated exhaustive argument that for every admissible path
   the resulting bounds satisfy the strict inequality
   \(C_{\min}(z)>P_{\max}(z;B,K)\).

The current research model has neither the external-to-oracle bridge nor a
net-cost lower bound, and its extraction grids are finite samples rather
than global maxima. It can support conditional scenario comparisons; it
cannot establish the requested universal inequality or claim economic
security.

# Maximum Extractable Profit Under the Current Implementation

This document derives the attacker's realized PnL from the current repository
implementation. It does not change production code or introduce new protocol
mechanisms. The result is an implementation-dependent optimization model, not
a proof that economic security holds.

The canonical paths referenced below are
[`TradeSimulator.ts`](../../src/simulation/TradeSimulator.ts),
[`Pricing.ts`](../../src/amm/Pricing.ts),
[`ImpactModel.ts`](../../src/amm/ImpactModel.ts),
[`SettlementPrice.ts`](../../src/settlement/SettlementPrice.ts),
[`SettleAndClosePosition.ts`](../../src/settlement/SettleAndClosePosition.ts),
[`SettleAndLiquidatePosition.ts`](../../src/settlement/SettleAndLiquidatePosition.ts),
[`PnL.ts`](../../src/risk/PnL.ts),
[`Margin.ts`](../../src/risk/Margin.ts),
[`Liquidation.ts`](../../src/risk/Liquidation.ts),
and [`LiquidityVault.ts`](../../src/liquidity/LiquidityVault.ts).

## 1. Security condition

For each attainable manipulation path \(z\), the intended condition remains:

\[
\boxed{C_{\min}(z)>P_{\max}(z;B,K)}
\]

The derivation below makes the right-hand side precise for one attacker
position, conditional on the market state, the execution-step count, margin,
the liquidation checkpoints, and the settlement path. It also distinguishes
gross economic PnL from PnL the vault will permit the code to commit.

The current implementation does not define a bound on attacker margin, fix
the execution-step count in market configuration, or bound non-attacker
open interest and the reference-price path. Consequently, an exact finite
number that depends only on \(z,B,K\) is not available from the code alone.

## 2. Attacker model

Let the position open when the market's TWAP is \(T_0\), and let its side be
\(s\in\{\mathrm{LONG},\mathrm{SHORT}\}\). Use the sign
\(\sigma=+1\) for LONG and \(\sigma=-1\) for SHORT. Let:

- \(q>0\): position size, in the implementation's `size` units;
- \(m>0\): position margin;
- \(n\ge1\): number of execution steps passed to `simulateTrade`;
- \(K\): configured `maxCapacity`;
- \(a\): `skewCoefficient`;
- \(c\): `capacityCoefficient`;
- \(U_0=L_0+S_0\): total OI before opening;
- \(D_0=L_0-S_0\): signed skew before opening;
- \(R\): settlement-time `ammTwapPrice`;
- \(D_{-i}\): settlement-time signed skew excluding this position;
- \(B_{\mathrm{settle}}\): vault `availableCapital` immediately before
  settlement.

The attack path \(z\) must specify at least the reference/TWAP path and
settlement time. To evaluate survival exactly, it must also specify the
market marks checked for liquidation and when liquidation is attempted. The
settlement mark additionally depends on other positions' OI at settlement.

`simulateTrade` accepts a positive integer step count as a call argument; it
is not fixed in `MarketConfig`. The attacker-provided `margin` is checked for
validity and leverage but is not checked against a trader balance or custody
system. The analysis below treats one position at a time. A portfolio of
multiple positions would require a joint optimization over OI, settlement
order, and shared vault capital.

## 3. Entry price

Before execution step \(j\), for \(j=0,\ldots,n-1\), the simulator has added
\(jq/n\) OI on the position's side. In the mathematical equal-step model:

\[
U_j=U_0+\frac{jq}{n},\qquad
D_j=D_0+\sigma\frac{jq}{n}
\]

\[
u_j=\frac{U_j}{K},\qquad d_j=\frac{D_j}{K},\qquad
h_j=\frac{c}{2}\frac{u_j}{1-u_j}.
\]

The factor \(1/2\) is present because `getAverageExecutionPrice` halves the
result of `getCapacityImpact`. The actual quote for that step is:

\[
E_j^s
=T_0(1+a d_j)(1+\sigma h_j).
\]

The recorded position entry price is the average of the step quotes:

\[
\boxed{
E_s(z,q;n)
=P_{\mathrm{entry}}(z,q;n)
=\frac{1}{n}\sum_{j=0}^{n-1}
T_0
\left(1+a\frac{D_0+\sigma jq/n}{K}\right)
\left(1+\sigma\frac{c}{2}
\frac{(U_0+jq/n)/K}{1-(U_0+jq/n)/K}\right)
}
\]

The final code step uses a residual size to avoid floating-point drift; the
formula above is exact in the equal-step mathematical model. Capacity impact
is evaluated before each step's OI is applied. Therefore a trade can consume
the remaining capacity on its last step even though a quote at 100% usage
would be invalid. The trade is rejected if the resulting entry price is not
valid for a `Position`.

This is not a fixed-price entry followed by a separate execution fee.
Stepwise skew and capacity effects are already embedded in \(E_s\). In the
empty-book case, a LONG's self-skew raises its later quotes and a SHORT's
self-skew lowers them; both sides also pay a capacity spread in their trade
direction.

## 4. Settlement price

`getSettlementPrice` validates the position and market, subtracts only that
position's size from its own side's OI, and then calls `getCurrentAmmPrice`.
It does not subtract the position's OI from total capacity because capacity
does not enter the canonical mark formula.

The settlement price is therefore:

\[
\boxed{
S_i(z,q)
=P_{\mathrm{settle}}(z,q)
=R\left(1+a\frac{D_{-i}}{K}\right)
}
\]

where \(D_{-i}\) is the signed OI skew of all positions other than the
settling position at settlement. If this is the only open position and
nothing else changes OI, \(D_{-i}=0\), so settlement is exactly the settlement
TWAP \(R\). The settling position's own skew cannot create its own
settlement-price gain or loss.

Other traders' or other attacker positions remain in \(D_{-i}\), so the
settlement price is not generally just \(R\). The repo supplies no bound on
that other OI path beyond the capacity checks on trades.

## 5. Position constraints

### Opening

For one new position, the OI capacity check requires:

\[
0<q,\qquad U_0+q\le K.
\]

The simulator also requires a positive integer step count, valid position
fields, consistent `PositionManager` OI, matching market/config symbols, and
an allowed leverage. Each step's pricing call must return a valid execution
price, and the final average entry price must be accepted by position
validation.

### Leverage and margin

The implemented leverage is:

\[
\mathrm{leverage}=\frac{q}{m}\le L_{\max},
\qquad\text{so}\qquad q\le L_{\max}m.
\]

This uses size divided by margin, not \(q\) times entry price divided by
margin. The code requires \(m>0\), but enforces no upper margin budget and
does not debit or custody the margin at opening.

### Liquidation and survival

At a liquidation-check time \(t\), let \(M_t\) be the mark used for the
position. With the actual PnL and margin-ratio functions:

\[
\mathrm{PnL}_t=\sigma q(M_t-E_s),\qquad
\mathrm{marginRatio}_t=\frac{m+\mathrm{PnL}_t}{q}
=\frac{m}{q}+\sigma(M_t-E_s).
\]

The position is liquidatable exactly when:

\[
\boxed{
\frac{m}{q}+\sigma(M_t-E_s)<\mu
}
\]

where \(\mu\) is `maintenanceMargin` (default \(0.05\) in the relevant
experiment). Equality is not liquidatable: the code tests strict `<`.

For a specified set \(\mathcal T(z)\) of actual liquidation checks, survival
requires:

\[
\frac{m}{q}+\sigma(M_t-E_s)\ge\mu
\quad\forall t\in\mathcal T(z),
\]

or equivalently:

\[
\boxed{
m\ge q\left(\mu+
\max_{t\in\mathcal T(z)}\sigma(E_s-M_t)\right)
}
\]

alongside \(m\ge q/L_{\max}\). This survival test must use the marks actually
checked by the lifecycle. `SettleAndClosePosition` does not itself require a
healthy position; liquidation requires a separate call to the liquidation
path. Thus the precise operational liquidation schedule is part of the
assumptions unless the caller guarantees checks at specified times. A
liquidation call can also fail its vault backing check and leave the position
open.

### Settlement

For voluntary close, `calculatePositionSettlement` requires a finite,
positive settlement price and finite PnL and claim. `prepareTraderPnL` then
requires the resulting vault accounting state to remain solvent. For positive
PnL this means \(\mathrm{PnL}\le B_{\mathrm{settle}}\). A rejected settlement
does not close the position or count as extraction.

The liquidation path first requires the position to be liquidatable, then
checks backing for the nonnegative trader claim and prepares the same signed
PnL accounting update. It can therefore also fail without settling.

## 6. Maximum feasible position

For fixed \(z,m,n\), current OI, and liquidation checkpoints, define
\(\mathcal Q_s\) as the set of \(q\) satisfying all of the following:

1. \(q>0\), \(U_0+q\le K\), and the `PositionManager` OI invariants hold.
2. \(q\le L_{\max}m\), and the simulator's execution/position validations
   succeed.
3. The position remains unliquidated at every liquidation call that actually
   occurs before voluntary settlement, or follows the successful liquidation
   path instead.
4. The selected settlement operation succeeds with the canonical settlement
   price and the current vault state.

For a positive-PnL voluntary settlement, condition 4 includes
\(\mathrm{PnL}(z,q)\le B_{\mathrm{settle}}\). A negative PnL does not fail
the current backing check; it increases the recorded `availableCapital`.
For liquidation, condition 4 also includes the explicit check
\(\max(m+\mathrm{PnL},0)\le B_{\mathrm{settle}}\), followed by the PnL
accounting solvency check.

Thus the exact implementation-dependent maximum size is a supremum over
this set:

\[
\boxed{
q_{\max}^{s}
=\sup\mathcal Q_s(z;K,m,n,U_0,D_0,\mathcal T,B_{\mathrm{settle}})
}
\]

This is not, in general, a closed-form `min` of capacity and leverage limits:
execution, survival, and the positive-PnL backing condition depend on \(q\)
through the nonlinear step quotes and settlement result. If margin is fixed,
the opening-only bound is \(q\le\min(K-U_0,L_{\max}m)\), before the other
constraints. If margin is a choice and no trader collateral budget is
imposed, the code allows margin to be increased to satisfy leverage and
survival for any otherwise-valid capacity-sized trade. In that case
leverage/liquidation do not independently cap \(q\).

There is no exact \(q_{\max}(z;B,K)\) from the repository alone: \(m,n\),
other OI, and liquidation-call timing are omitted from those arguments, and
the code does not constrain \(m\) to attacker-owned collateral.

## 7. Profit function

For a position that reaches canonical settlement, the signed implemented PnL
is:

\[
\boxed{
P_s(z,q)
=\mathrm{PnL}(z,q)
=\sigma q\left[
R\left(1+a\frac{D_{-i}}{K}\right)-E_s(z,q;n)
\right].
}
\]

Expanded by side:

\[
P_{\mathrm{LONG}}=q(S_i-E_{\mathrm{LONG}}),\qquad
P_{\mathrm{SHORT}}=q(E_{\mathrm{SHORT}}-S_i).
\]

These are settlement PnL, not unrealized mark-to-market PnL. No opposite-side
trade is needed to close a position: `settleAndClosePosition` settles the
existing position directly. There is no separate closing execution price,
close spread, funding transfer, or fee in this canonical settlement PnL
path. Those must not be added to this model as though implemented.

The simplest useful decomposition follows exactly from the implementation:

\[
\Delta_s(z)=\sigma(S_i-T_0),\qquad
C_{\mathrm{exec}}^s(z,q)=\sigma q(E_s(z,q;n)-T_0)
\]

\[
\boxed{
P_s(z,q)=q\Delta_s(z)-C_{\mathrm{exec}}^s(z,q).
}
\]

This has the shape \(q\Delta P-C_{\mathrm{execution}}\), but the execution
term is the signed, size-dependent opening-price impact already embedded in
the step quotes. It is not an added fee or closing-trade cost. In an empty
book with ordinary positive quotes it is adverse for either side; with
pre-existing skew it can be favorable, so it is not universally a
nonnegative “cost.” Replacing it by a constant or ignoring its dependence on
\(q\) is only an approximation and can miss an interior optimum. With no
other OI, \(S_i=R\) and \(\Delta_s=\sigma(R-T_0)\).

For an attack-extraction measure consistent with the repository's
`realizedExtraction`, use \([P_s]_+=\max(P_s,0)\), and count it only when
settlement commits. The returned `traderSettlement` is margin plus PnL for
voluntary close, but margin custody/return is not accounted for by the vault.

## 8. Maximum extractable profit

Let \(\mathcal F_s(z;B,K)\) be the feasible, successfully settled positions
from Section 6. For the single-position, current-accounting interpretation:

\[
\boxed{
P_{\max}^{s,\mathrm{accounted}}(z;B,K)
=\sup_{q\in\mathcal F_s(z;B,K)}
\max(P_s(z,q),0)
}
\]

where \(\mathcal F_s\) includes the success condition for the chosen close or
liquidation operation. Rejected openings, positions liquidated before
favorable settlement, and rejected settlements are not in the set and
contribute zero extraction.

It is useful to separate the gross economic optimization from the vault
constraint:

\[
G_{\max}^s(z;K)
=\sup_{\substack{q\text{ opens and survives}\\
\text{ignoring vault backing}}}
\max(P_s(z,q),0).
\]

For a positive-PnL voluntary close, the code only commits when
\(P_s(z,q)\le B_{\mathrm{settle}}\). For liquidation, it additionally checks
that the nonnegative trader claim \(\max(m+P_s,0)\) is no larger than
\(B_{\mathrm{settle}}\). Therefore the code's positive-PnL accounted
extraction satisfies:

\[
\boxed{
P_{\max}^{s,\mathrm{accounted}}(z;B,K)
\le \min\!\left(B_{\mathrm{settle}},G_{\max}^s(z;K)\right).
}
\]

This is a settlement-accounting/payment guard, not an economic bound on the
gross profit opportunity. It is also not proof of an actual cash payment:
the code mutates in-memory PnL/accounting and returns a claim value, but does
not transfer assets. Liquidation checks the returned nonnegative claim
\(\max(m+\mathrm{PnL},0)\) against available capital. Voluntary close does
not perform that claim check: it checks the signed PnL accounting update,
which for positive PnL is \(P_s\le B_{\mathrm{settle}}\). Thus a voluntary
close can return a `traderSettlement` value greater than available capital
when the unaccounted margin is large, even though its PnL update passes.

Thus \(P_{\max}\le B\) is true of positive PnL that the current accounting
path successfully commits, with \(B\) interpreted as then-current
`availableCapital`. It is not a bound on \(G_{\max}\), and is not an
implemented bound on total cash claims including margin.

## 9. LONG vs SHORT

The signs in both entry execution and PnL matter. For an initially empty
market:

- A LONG adds positive skew; its successive fair values rise. Capacity spread
  also raises its buy quotes.
- A SHORT adds negative skew; its successive fair values fall. Capacity
  spread lowers its sell quotes.
- At settlement, the settling position's self-created skew is removed.
  With no other positions, both sides settle at \(R\).

Consequently, for a recovery from a low \(T_0\) to a higher \(R\), a LONG may
profit if recovery is large enough to overcome its skew and capacity entry
cost. A SHORT opened on the same path has a lower entry quote but still loses
if \(R\) is above that quote. For a falling path, the direction can reverse.
There is no symmetry assumption in the formulas.

For the same empty-book inputs and \(q,n\), the execution quotes are
directionally different:

\[
E_{\mathrm{LONG}}=
T_0(1+a x/K)(1+h),\qquad
E_{\mathrm{SHORT}}=
T_0(1-a x/K)(1-h)
\]

at an intermediate cumulative OI \(x\), with
\(h=\frac c2\frac{x/K}{1-x/K}\). The settlement mark has neither term from
the position itself. Which direction is more profitable is therefore path-
and size-dependent, not guaranteed by an assumed symmetric payoff.

## 10. Capacity dependence

Capacity affects the calculation in three existing ways:

1. It caps total OI at \(K\).
2. It scales signed skew in the execution quote and canonical mark.
3. It determines capacity usage in the nonlinear execution spread
   \(h=(c/2)u/(1-u)\).

Increasing \(K\) can admit larger \(q\), but it also reduces both skew ratio
and usage at a fixed \(q\), changing entry price. If the attacker scales \(q\)
with \(K\), the entry impact can instead remain substantial. Settlement's
own-position skew exclusion also means an increase in self-OI does not
directly improve that position's settlement mark.

An interior optimum is possible in the actual open-then-settle model. For
example, with an empty market, \(T_0=95\), \(R=100\), \(K=100{,}000\),
\(a=0.2\), \(c=0.05\), five opening steps, and ample margin/backing, a
100-unit size sweep through the production `simulateTrade` and
`settleAndClosePosition` functions found its best sampled LONG PnL at
\(q=28{,}000\), approximately \(71{,}116.14\). At \(q=K\), the same
five-step opening has entry price \(106.0675\), so settlement at 100 gives
negative PnL. Since PnL is positive at 28,000 and negative at capacity, the
maximum over the continuous feasible size interval cannot be at \(K\);
the numerical sweep locates it near 28,000 for these parameters.

This example uses \(m=12q\) so that the position survives the initial
manipulated mark across the sampled range. The repository has no margin
budget that would reject that choice. This is a conditional capacity example,
not a general monotonicity theorem. The older `runCapacityAttackSweep` in
[`attackEconomicsModel.ts`](../../experiments/archive/attackEconomicsModel.ts) reports
headline PnL from an opposite-side `simulateTrade`, which opens a second
position rather than settling the first; its peak is not itself a proof of
the canonical open/settle maximum.

The exact optimum must be computed from the current parameters and feasible
set. Neither \(q_{\max}=K\) nor monotonic profit in \(K\) follows from the
implementation.

## 11. LP-capital dependence

LP capital does not enter `simulateTrade`: opening can succeed without
consulting the vault. At voluntary close it enters through
`prepareTraderPnL`. For positive PnL, commit requires:

\[
B_{\mathrm{settle}}-\mathrm{PnL}\ge0.
\]

That condition can exclude a grossly profitable \(q\) from the realizable
set, but it does not change the entry quote, gross settlement PnL, or
liquidation margin ratio. The liquidation path separately checks
\(\max(m+\mathrm{PnL},0)\le B_{\mathrm{settle}}\) before commit. When
available backing increases, a previously rejected positive-PnL settlement
may commit; no underlying pricing term is changed by \(B\).

Losses are recorded as negative trader PnL and increase `availableCapital`
without an implemented collection of trader funds. Likewise, margin is not
included in the PnL accounting. `availableCapital` can also have been
changed by prior settlements, deposits, or premiums. Therefore use the
value at the attempted settlement, not an assumed immutable initial deposit.

The exact conclusion is limited: current code bounds a committed positive
PnL debit by then-current accounting capital; liquidation also bounds its
reported nonnegative claim against that capital. Voluntary close does not
bound its full returned claim by vault capital. None of those checks establish
that LP capital bounds gross economic profit or that any returned amount is
actually transferred as tokens.

## 12. Worked attack example

This reconstructs a parameterized case supported by
[`implementedEconomicSecurity.ts`](../../experiments/implementedEconomicSecurity.ts)
and its `simulateImplementedEconomicScenario` function:

| Input/result | Value |
|---|---:|
| Initial reference price | 100 |
| Manipulated TWAP target and duration | 95 for 900 seconds |
| Capacity \(K\) | 100,000 |
| Side | LONG |
| Utilization / size \(q\) | 10% / 10,000 |
| Execution steps | 5 |
| Leverage / margin | 1x / 10,000 |
| Initial vault available capital | 1,000,000 |
| Skew/capacity coefficients | 0.2 / 0.05 |
| Maintenance margin | 0.05 |

The 900-second arithmetic TWAP replay uses reference price 95 over the
manipulated window and returns to 100. The experiment reports
`actualTwap = 95`; after its recovery window the canonical settlement TWAP
is 100.

Starting with zero OI, the production step quotes are:

| Step | LONG quote |
|---:|---:|
| 1 | 95.000000 |
| 2 | 95.428663 |
| 3 | 95.859750 |
| 4 | 96.293415 |
| 5 | 96.729826 |

Thus:

\[
E_{\mathrm{LONG}}
=\frac{\sum_j E_j}{5}
=95.8623308492.
\]

After opening, the market has 10,000 LONG OI. At settlement,
`getSettlementPrice` subtracts this position's 10,000 LONG OI, leaving zero
skew. Therefore:

\[
S_i=100\left(1+0.2\frac{0}{100{,}000}\right)=100.
\]

The signed settlement PnL and returned voluntary-close claim are:

\[
\mathrm{PnL}=(100-95.8623308492)\times10{,}000
=41{,}376.6915082,
\]

\[
\mathrm{traderSettlement}=10{,}000+41{,}376.6915082
=51{,}376.6915082.
\]

At the initial manipulated mark, the margin ratio is:

\[
\frac{10{,}000+(95-95.8623308492)\times10{,}000}{10{,}000}
=0.1376691508>0.05.
\]

The scenario's recovery checks do not liquidate this position; settlement at
100 succeeds because positive PnL is below the 1,000,000 available backing.
The experiment reports:

```text
entryPrice          95.86233084917595
margin              10000
settlementPrice     100
grossSettlementPnl  41376.691508240525
realizedExtraction  41376.691508240525
status              REALIZED PROFIT
```

This matches the formula above. It is a parameterized run of the existing
scenario function with `leverage: 1`; the default matrix uses 5x leverage
and 2,000 margin for this size, which is liquidated at the manipulated mark
and realizes zero extraction. This distinction is material: the default
matrix result is not the realized-profit example.

For this path, the existing experimental attack-cost proxy reports
197,335.969815. Its cost/extraction ratio for the realized 1x-margin run is
approximately \(4.77\). That comparison is only between the implementation's
realized PnL and the experiment's assumed cost proxy; it is not a measured
external attack cost.

## 13. Attack-cost connection

Once a defensible minimum attacker cost is known for the same full path \(z\),
the test is:

\[
\forall z:\quad
C_{\min}(z)>
\max\!\left(
P_{\max}^{\mathrm{LONG,accounted}}(z;B,K),
P_{\max}^{\mathrm{SHORT,accounted}}(z;B,K)
\right).
\]

The cost and profit must refer to the same path, duration, attacker strategy,
and settlement outcome. A cost for one TWAP distortion cannot be compared
with profit optimized over a different distortion.

The current experiments use an assumed constant-product external pool and a
repeated one-way slippage proxy. The repository does not connect that pool to
the production-facing reference source. To establish \(C_{\min}(z)\), the
following remain necessary: validated external depth/reserves; a model of
reserve evolution and the manipulation/unwind lifecycle; source mechanics
that map pool prices to accepted reference observations; and a justified
minimum net cost including any applicable arbitrage, fees, financing, or
other real effects. These quantities cannot be supplied by the current
perp PnL implementation.

## 14. Proven / empirical / assumed / unproven

### Proven from code (conditional on valid inputs/state)

- `simulateTrade` checks total OI capacity and `size / margin <= maxLeverage`,
  prices each step from current temporary OI, and stores the average step
  price as entry.
- Opening execution uses the skew-adjusted fair value and the
  half-capacity-impact spread in `getAverageExecutionPrice`.
- Settlement derives the canonical mark from TWAP and OI after excluding
  only the settling position's own side OI.
- LONG and SHORT PnL, margin ratio, and the strict liquidation comparison
  have the equations stated above.
- Voluntary close does not require a healthy mark; settlement operations are
  atomic with the PnL-accounting guard.
- A successful positive-PnL settlement cannot reduce the current
  `availableCapital` below zero.

### Empirically observed

- The worked TWAP95, 900-second, 10,000-size, 1x-margin LONG run realizes
  41,376.6915 PnL under the experiment's reference path and canonical
  settlement lifecycle.
- In a production open/settle numerical sweep with five steps and the stated
  coefficients, the sampled LONG PnL peaks before the capacity boundary for
  the specific TWAP95-to-100 case.
- The existing attack-cost model reports 197,335.9698 for that TWAP95,
  900-second path using its configured constant-product proxy.

These are finite scenario outputs, not global bounds.

### Assumed or not enforced by the implementation

- Which manipulated reference observations an attacker can cause, and the
  resulting path \(z\).
- The external market depth and cost model used to create those observations.
- The attacker's margin budget and custody of the stated margin.
- A fixed execution-step count or a constraint on the caller's `steps`.
- The path of other positions' OI and the exact liquidation-call schedule.
- That returned settlement claims correspond to actual token transfers.

### Still unproven

- A global maximum of gross economic profit over all feasible paths,
  positions, margins, step counts, and other OI.
- A global finite bound on favorable settlement-price movement.
- That the current in-memory vault accounting equals actual withdrawable LP
  assets or fully funds `traderSettlement`, including returned margin.
- Any global inequality \(C_{\min}(z)>P_{\max}(z;B,K)\) for all \(z\).

Accordingly, the derivation makes the one-position optimization precise
conditional on its missing inputs, but **does not prove economic security**.

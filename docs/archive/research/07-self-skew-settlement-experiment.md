# Historical Self-Skew Settlement Causality Experiment

> **Historical/counterfactual validation:** This report documents the
> pre-Checkpoint 7.5 production behavior and the causal experiment that
> motivated the fix. Model A below is a historical baseline, not current
> production behavior. Current canonical close and liquidation pricing
> excludes only the position being settled from OI. The experiment code now
> computes all A/B/C marks and accounting impacts without executing production
> settlement.

## 1. Hypothesis

The hypothesis is that positive OI from a position raises (LONG) or lowers
(SHORT) the canonical settlement mark used to settle that same position,
and that this own-position feedback materially increases its settlement PnL.

This report is an **EXPERIMENTAL / COUNTERFACTUAL** analysis only. Its Model A
rows preserve the historical full-OI settlement semantics; B and C are
counterfactual alternatives. The results use the repository's off-chain
TypeScript implementation and the same attack-cost proxy used in the prior
validation.

## 2. Model A — historical pre-fix production behavior

Before Checkpoint 7.5, Model A settled the opened position through production
`settleAndClosePosition`. The historical operation used
`getSettlementPrice` → `getCurrentAmmPrice` before releasing OI:

```text
skew = longOI - shortOI
skewRatio = skew / maxCapacity
settlementMark = ammTwapPrice * (1 + skewCoefficient * skewRatio)
```

The position being settled was still included in `longOI` or `shortOI`.
Historical Model A PnL and vault changes were committed by production
settlement in the isolated experiment state. The preserved experiment now
reproduces that mark and accounting counterfactually; it does not invoke
production settlement.

## 3. Model B — own-position-excluded counterfactual

The pure helper
[`getCounterfactualSettlementMark`](../../experiments/archive/selfSkewSettlementExperiment.ts)
copies the market state, subtracts only the supplied position's size from
the matching OI side, then calls the same `getCurrentAmmPrice` formula.
It does not mutate market, position, or vault.

Model B PnL is calculated from that hypothetical mark. Its vault impact is
the hypothetical accounting change if that PnL were booked against a
separate same-sized vault. It is **not** a production lifecycle settlement.

The isolated scenario has no other open positions. Therefore, removing the
target position leaves zero skew, and B equals C. A supplemental nonzero
background-skew case would be needed to quantify skew contributed by other
traders separately.

## 4. Model C — TWAP-only counterfactual

Model C uses the recovered `ammTwapPrice` directly, with no skew adjustment:

```text
settlementMark = ammTwapPrice
```

It retains the same position, entry, attack path, capacity, margin, vault
backing, and attack-cost estimate. Like B, its PnL/vault effect is
counterfactual and not committed through production settlement.

## 5. LONG results

Controlled comparison: target TWAP 95, 900-second manipulation, 900-second
reference recovery to 100, `maxCapacity=100,000`, `skewCoefficient=0.2`,
`capacityCoefficient=0.05`, 1x leverage (margin equals size), and
$10,000,000 available vault backing. Attack cost is identical across A/B/C:
$197,335.97.

| Utilization | Size | Entry | Margin | Model A mark / PnL / ratio | Model B mark / PnL / ratio | Model C mark / PnL / ratio | A-B PnL reduction |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 10,000 | 95.8623 | 10,000 | 102 / $61,376.69 / 3.215 | 100 / $41,376.69 / 4.769 | 100 / $41,376.69 / 4.769 | $20,000 (32.59%) |
| 20% | 20,000 | 96.7416 | 20,000 | 104 / $145,167.72 / 1.359 | 100 / $65,167.72 / 3.028 | 100 / $65,167.72 / 3.028 | $80,000 (55.11%) |
| 30% | 30,000 | 97.6422 | 30,000 | 106 / $250,733.03 / 0.787 | 100 / $70,733.03 / 2.790 | 100 / $70,733.03 / 2.790 | $180,000 (71.79%) |
| 40% | 40,000 | 98.5704 | 40,000 | 108 / $377,185.12 / 0.523 | 100 / $57,185.12 / 3.451 | 100 / $57,185.12 / 3.451 | $320,000 (84.84%) |
| 50% | 50,000 | 99.5351 | 50,000 | 110 / $523,244.05 / **0.377** | 100 / $23,244.05 / 8.490 | 100 / $23,244.05 / 8.490 | $500,000 (95.56%) |

Under the pre-fix lifecycle, all A positions in this table were not
liquidatable at settlement and were committed by production close. The
own-skew PnL difference grows
quadratically with size for this fixed capacity/coefficient because both
the mark displacement and exposure increase with utilization. Model B and C
still show the PnL from the depressed entry followed by recovery to 100;
that component is not own-skew settlement PnL.

The prior five ratio-below-one scenarios are reproduced in Model A and all
move above one in Model B/C at the default coefficient:

| Target | Duration | Utilization | Size | Model A PnL / ratio | Model B/C PnL / ratio |
|---:|---:|---:|---:|---:|---:|
| 95 | 600s | 40% | 40,000 | $377,185.12 / 0.806 | $57,185.12 / 5.315 |
| 95 | 600s | 50% | 50,000 | $523,244.05 / 0.581 | $23,244.05 / 13.076 |
| 95 | 900s | 30% | 30,000 | $250,733.03 / 0.787 | $70,733.03 / 2.790 |
| 95 | 900s | 40% | 40,000 | $377,185.12 / 0.523 | $57,185.12 / 3.451 |
| 95 | 900s | 50% | 50,000 | $523,244.05 / 0.377 | $23,244.05 / 8.490 |

For all three models in each row, the same attack-cost proxy is used: the
duration-specific constant-product estimate. A/B/C differ only in settlement
mark selection.

## 6. SHORT results

Same target, duration, configuration, 50% utilization, backing, and
conservative 1x margin; side is SHORT. Attack cost remains $197,335.97.

| Model | Settlement mark | PnL | Vault accounting impact | Cost / positive extraction | Liquidatable at mark? | Pre-fix production committed? |
|---|---:|---:|---:|---:|---|---|
| A — historical | 90 | +$27,579.37 | $27,579.37 loss | 7.155 | No | Yes |
| B — own SHORT OI removed | 100 | -$472,420.63 | -$472,420.63 (vault gain) | N/A | Yes | No |
| C — TWAP only | 100 | -$472,420.63 | -$472,420.63 (vault gain) | N/A | Yes | No |

The SHORT's own negative skew lowers its settlement mark by 10, raising its
PnL by exactly $500,000 relative to B/C. The direction is symmetric to the
LONG case: self-skew is favorable to the position being settled. In this
SHORT case, however, Model A's positive PnL is still below the modeled
attack cost, so it is not a ratio-below-one violation.

## 7. Position-size sensitivity

The LONG table in Section 5 tests 10%, 20%, 30%, 40%, and 50% of capacity.
The Model A minus Model B settlement-PnL differences are:

```text
$20,000, $80,000, $180,000, $320,000, $500,000
```

The effect grows at every tested size. The differences match the formula
for the current single-position book:

```text
size * (Model A mark - Model B mark)
= size * (100 * k * size / maxCapacity)
```

with `k=0.2` and `maxCapacity=100,000`.

## 8. Skew-coefficient sensitivity

Hold the 50%-utilization LONG, target 95, duration 900s, capacity 100,000,
capacity coefficient 0.05, margin 50,000, and $10,000,000 backing fixed.

| Skew coefficient k | Entry | Model A mark / PnL / ratio | Model B/C mark / PnL / ratio | A-B |
|---:|---:|---:|---:|---:|
| 0 | 95.6918 | 100 / $215,411.71 / **0.916** | 100 / $215,411.71 / **0.916** | $0 |
| 0.05 | 96.6526 | 102.5 / $292,369.79 / 0.675 | 100 / $167,369.79 / 1.179 | $125,000 |
| 0.2 | 99.5351 | 110 / $523,244.05 / 0.377 | 100 / $23,244.05 / 8.490 | $500,000 |
| 0.5 | 105.3001 | 125 / $984,992.56 / 0.200 | 100 / -$265,007.44 / N/A | $1,250,000 |
| 1 | 114.9085 | 150 / $1,754,573.41 / 0.112 | 100 / -$745,426.59 / N/A | $2,500,000 |

At `k=0`, the A/B/C difference is exactly zero, as expected. But the
cost/extraction ratio is still 0.916: the observed proxy inequality
**persists narrowly without any skew adjustment**, due to the manipulated
entry/TWAP recovery and this attack-cost model. Thus self-skew explains the
large deterioration at the repository's `k=0.2`; it is not the only way this
finite proxy comparison can fall below one.

## 9. Capacity-coefficient sensitivity

Hold `skewCoefficient=0.2` and all other scenario values fixed (50%
LONG, TWAP 95, duration 900s, capacity 100,000, backing $10,000,000,
margin 50,000). Only `capacityCoefficient` varies.

| Capacity coefficient | Entry | Model A PnL / ratio | Model B/C PnL / ratio | A-B |
|---:|---:|---:|---:|---:|
| 0 | 98.8000 | $560,000.00 / 0.352 | $60,000.00 / 3.289 | $500,000 |
| 0.05 | 99.5351 | $523,244.05 / 0.377 | $23,244.05 / 8.490 | $500,000 |
| 0.1 | 100.2702 | $486,488.10 / 0.406 | -$13,511.90 / N/A | $500,000 |
| 0.2 | 101.7405 | $412,976.19 / 0.478 | -$87,023.81 / N/A | $500,000 |

With skew held constant, the own-skew settlement increment remains
$500,000. The capacity execution spread raises LONG entry as its coefficient
increases, reducing both A and B PnL; it counteracts rather than causes the
positive self-skew increment in this LONG scenario. At the repository's
0.05 value, A remains below ratio 1 while B/C are well above 1.

## 10. Entry vs settlement comparison

For the worst default LONG (TWAP 95, 50% utilization):

| Price | Value | Difference vs relevant TWAP |
|---|---:|---:|
| Manipulated TWAP at entry | 95 | — |
| Entry average | 99.5351 | +4.5351 (+4.77% of entry TWAP) |
| Recovered TWAP at settlement | 100 | — |
| Model A settlement mark | 110 | +10 (+10% of recovered TWAP) |
| Model B settlement mark | 100 | 0 |
| Model C settlement mark | 100 | 0 |

Entry pricing already incorporates the changing skew fair value plus the
capacity spread across the five fills. Settlement then applies the
skew-adjusted mark to the still-open OI. It is accurate to say skew affects
both entry and settlement. The causal experiment demonstrates that the
position's own skew specifically contributes an additional $500,000 of
settlement PnL in this case. Whether that is economically intended cannot
be decided from this experiment; “double-counting” is not assumed.

## 11. Economic-security comparison

For the five previously violating rows at the default `k=0.2`, Model A has
ratio below one, while B/C have ratios from 2.790 to 13.076. Under the
experiment's fixed attack-cost proxy and backing, removing the target's own
skew eliminates the sampled violations.

However, the coefficient sweep gives a counterexample to a broader claim:
at `k=0`, A=B=C and the 50%-utilization TWAP95 scenario still has ratio
0.916. The underlying comparison is model-dependent, and changing
settlement price does not validate the attack-cost proxy.

The $10,000,000 vault backing, capacity, reference path, size, entry, margin,
and attack cost are held identical among A/B/C within each row. Historically,
Model A settlement was production-committed. B/C are hypothetical accounting
calculations using the same PnL formula and an isolated copy of the vault;
they do not invoke or change production settlement.

## 12. Causal conclusion

For the tested single-position, default-configuration violation family,
**self-referential skew is the dominant measured cause**: own-position
exclusion reduces LONG PnL by $20,000–$500,000 across the 10–50% size
range, removes all five ratio-below-one rows, and changes the worst ratio
from 0.377 to 8.490. The effect grows with size and skew coefficient,
vanishes at `k=0`, and is independent of capacity coefficient in dollar
PnL for this fixed-size setup.

The result is not exclusive: at zero skew the proxy ratio is still 0.916,
so the finite economic-security comparison can fail without self-skew.
Capacity determines the exposure allowed and the vault guard determines
whether the booked loss can be supported; capacity impact itself reduces
this LONG extraction over the tested coefficient range. No non-attacker
background positions were present, so B=C here and general skew from other
traders is not separately identified.

### Question 1
Does removing the position's own skew materially reduce realized extraction?

**YES** — for the default LONG violation rows, including a 95.56% reduction
in the worst tested case. For the tested SHORT, it removes $500,000 of
favorable self-skew PnL, turning +$27,579.37 into a counterfactual loss.

### Question 2
Does removing the entire skew adjustment materially reduce realized extraction?

**YES** — Model C equals B in the isolated single-position scenario and
produces the same reductions. This experiment contains no independent
background skew to retain under B.

### Question 3
Does the economic-security violation persist under Model B?

**NO** for the five previously violating rows under the unchanged default
configuration `k=0.2`; all five ratios exceed one in B. **It does persist**
in the `k=0` sensitivity row (ratio 0.916), so this is not a general proof
that Model B always satisfies the inequality.

### Question 4
Does the violation persist under Model C?

**NO** for the five previously violating rows under the default
configuration. **It does persist** in the `k=0` sensitivity row (ratio
0.916), for the same reason as Model B.

### Question 5
Is the current violation primarily SELF-SKEW, GENERAL SKEW PRICING,
CAPACITY/BACKING, COMBINATION, or UNRESOLVED?

**COMBINATION** — self-skew is the dominant cause of the default
configuration's large violation, while the finite proxy comparison can
still fail without skew and sufficient backing permits a modeled settlement
to commit. General skew from other positions was not isolated.

## 13. What this experiment does NOT prove

- It does not prove that the constant-product attack-cost proxy is the
  attacker's minimum cost, actual loss, or economically commensurate with
  position PnL.
- It does not prove a global attack-cost/extraction inequality or global
  maximum extraction.
- It does not establish that self-skew pricing is unintended; it measures
  the causal effect in a controlled scenario.
- It does not test settlement with unrelated open positions or quantify
  general market skew independently from self-skew.
- Model B/C PnL is counterfactual, not production-realizable settlement.
- It does not establish token custody, margin transfer, or actual payout.
- It does not propose or implement a protocol fix.

```text
SELF-SKEW EFFECT:
CONFIRMED

ECONOMIC-SECURITY VIOLATION AFTER SELF-SKEW REMOVAL:
DISAPPEARS

PRIMARY DRIVER:
COMBINATION

PRODUCTION CODE CHANGED:
NO

CHECKPOINT 7 DIAGNOSIS:
PASS
```

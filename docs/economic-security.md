# Economic-Security Research

## 1. Security objective

The required attack-specific comparison is:

```text
for every admissible manipulated reference path z:
    C_min(z) > P_max(z; B, K)
```

Cost and extraction must refer to the same path, timing, external-market
state, and settlement lifecycle. The repository does not establish this
universal inequality.

## 2. Definitions

- `B`: vault backing available to the settlement accounting path. It is a
  numeric in-memory amount, not verified collateral custody.
- `K`: configured maximum total open interest.
- `z`: the timestamped manipulated reference-price path used by the local
  oracle and settlement lifecycle.
- `C_min(z)`: minimum net economic attacker cost among strategies that
  produce that exact path, including unwind and recoveries.
- `P_max(z; B, K)`: maximum *realized* positive extraction among feasible
  positions that open, survive, settle successfully, and receive the
  corresponding claim.

The code calculates selected scenarios and a proxy cost. It does not
calculate either global extremum.

## 3. Feasible attacker lifecycle

For side sign `sigma` (`+1` LONG, `-1` SHORT), size `q`, margin `m`, and
step-count `n`, the attacker must:

1. Open through the stepwise `TradeSimulator` path.
2. Satisfy remaining capacity, leverage, and valid execution-price checks.
3. Remain unliquidated at every liquidation check before voluntary close, or
   reach the liquidation path instead.
4. Reach canonical settlement and pass vault/accounting checks.
5. Receive a committed positive PnL; unrealized PnL and rejected settlement
   are not extraction.

The code does not constrain attacker collateral or specify a mandatory
liquidation-check schedule. Those are inputs/assumptions for a complete
optimization.

At each actual liquidation check with mark `M_t` and maintenance threshold
`mu`, the implemented margin ratio is:

```text
marginRatio_t = m/q + sigma (M_t - E_s)
```

The position remains non-liquidatable at that check iff the ratio is at
least `mu`. Survival until voluntary settlement requires this at every
liquidation check that occurs on the path. A settlement rejected by vault
backing is infeasible and contributes no extraction.

## 4. Entry price

At step `j`, the simulator evaluates pricing against staged OI before applying
that step. In the equal-step model:

```text
U_j = U_0 + j q/n
D_j = D_0 + sigma j q/n
```

With `T_0` the opening TWAP, `a` the skew coefficient, `c` the capacity
coefficient, `K` the capacity, `u_j = U_j/K`, and `d_j = D_j/K`, the quote is:

```text
E_j = T_0 (1 + a d_j) (1 + sigma (c/2) u_j/(1-u_j))
E_s(z,q;n) = (1/n) sum_j E_j
```

The recorded entry `E_s` therefore already includes stepwise skew and
capacity pricing; there is no separate implemented opening fee.

## 5. Settlement price

Settlement excludes the target position's own stored OI, but retains other
positions' OI:

```text
S_i(z,q) = R (1 + a D_-i/K)
```

Here `R` is the settlement TWAP and `D_-i` is signed settlement-time skew
excluding position `i`. If it is the only open position, `D_-i = 0`, so the
settlement mark is `R`.

## 6. Extractable PnL

The implementation's signed settlement PnL is:

```text
P_s(z,q) = sigma q [ S_i(z,q) - E_s(z,q;n) ]
LONG:  q (S_i - E_LONG)
SHORT: q (E_SHORT - S_i)
```

The realized extraction for a scenario is `max(P_s, 0)` only if canonical
settlement commits. There is no separate close execution price, fee, funding
transfer, or opposite-side AMM trade in that settlement PnL path.

Equivalently, for `Delta_s = sigma (S_i - T_0)` and
`C_exec = sigma q (E_s - T_0)`:

```text
P_s = q Delta_s - C_exec
```

This is an exact decomposition, but `C_exec` is a size-dependent signed
pricing term, not a constant or an independently charged fee. It can depend
on the side, existing skew, and capacity.

## 7. Capacity constraint

For initial total OI `U_0`, opening requires:

```text
0 < q
U_0 + q <= K
q <= L_max m
```

These are only opening constraints. Execution validation, survival, other
positions' OI, and the successful-settlement conditions further constrain
feasibility. Consequently `q_max` is not generally `K`, nor is it necessarily
at the capacity boundary.

Let `F_s(z;B,K)` denote the set of sizes and required lifecycle choices for
side `s` that pass opening, execution, survival, canonical settlement, and
claim checks for this path. The corresponding objective is:

```text
P_max(z;B,K) = max over s in {LONG, SHORT}
               sup over (q,m,n,...) in F_s(z;B,K)
               max(P_s(z,q), 0)
```

The omitted choices include other OI, the liquidation-check schedule, and
settlement state/order. Therefore the code does not supply a fully
parameterized `F_s` or a global numeric `P_max`. The stepwise execution quote
and capacity denominator are nonlinear in `q`; no monotonicity result makes
the capacity boundary optimal. The global position-size optimization is
unperformed.

## 8. Vault/backing constraint

For a positive-PnL voluntary settlement, the current accounting path rejects
the transition if the positive PnL exceeds available vault capital. The
liquidation path also checks the resulting trader claim and PnL accounting.
A rejected settlement does not close the position or count as extraction.

Thus `B` enters the **payment/commit feasibility bound** in this code. It
does not change the PnL formula or prove that the attack is economically
unprofitable. It is an accounting bound on what this in-memory vault permits
to commit, not proof of the assets available in a real pool.

## 9. Minimum manipulation-cost model

### A. Spot manipulation score

The research helper assumes a no-fee constant-product pool:

```text
x y = k
P_0 = y_0/x_0
Delta x = sqrt(x_0 y_0/P_m) - x_0
Delta y = y_0 - x_0 y_0/(x_0 + Delta x)
c_spot = Delta x P_0 - Delta y
C_proxy = c_spot (duration / 15 seconds)
```

At the target price, `x_1 = sqrt(k/P_m)` and `y_1 = sqrt(k P_m)`. The
helper's `Delta x P_0 - Delta y` is the chosen one-way slippage/inventory
score. It is not gross attack capital and does not by itself give the loss
after unwinding.

### B. Sustained-manipulation proxy

The code multiplies that same one-shot score by `duration / 15`; it does not
carry pool reserves from one interval to the next or model repeated trades
against an evolving market. This is a repeated slippage proxy, not a
sustained-pool strategy.

### C. Net attack cost

The repository does not calculate actual net cost after unwind, arbitrage,
fees, financing, inventory value, price recovery, or other asset recovery.
The one-way proxy is neither a proven upper bound nor a proven lower bound
on minimum net cost.

For the production oracle's arithmetic TWAP, a constant manipulated
observation `P_m` over duration `d` in window `W` requires:

```text
R = [P_0 (W-d) + P_m d] / W
P_m = [R W - P_0 (W-d)] / d
```

The helper multiplies the one-shot score by the number of 15-second
intervals, reusing the original assumed reserves. It does not evolve a pool
across intervals, optimize attacker strategies, or model unwind, arbitrage,
fees, financing, or asset recovery. The result is a **repeated
one-way-slippage proxy**, not `C_min(z)` or a proven bound on it.

The older geometric-TWAP experiment is historical and does not represent
the arithmetic production TWAP.

## 10. Current experimental results

The current-path
[`implementedEconomicSecurity.ts`](../experiments/implementedEconomicSecurity.ts)
scenario exercised a 140-row grid over target
TWAP, duration, and utilization. At each of `$50,000` and `$10,000,000`
modeled vault backing, the recorded summary was:

| Modeled backing | Scenarios | Rejected before position | Liquidated | Positive realized extraction |
|---:|---:|---:|---:|---:|
| $50,000 | 140 | 65 | 75 | 0 |
| $10,000,000 | 140 | 65 | 75 | 0 |

These are finite simulation results, not a global bound. In the representative
path `normal=100`, `TWAP=95`, `duration=900s`, `recovery=100`, the arithmetic
TWAP requires a manipulated observation of 95 throughout the window. With
assumed CPMM reserves `(50,000 base, 5,000,000 quote)`, the helper reports an
attack-cost proxy of approximately `$197,335.97`. The current lifecycle
scenario's position is liquidated at the depressed mark and realizes no
positive extraction; therefore a finite cost/extraction ratio is undefined.

Earlier reports of approximately `$41,376.69` extraction paired with the same
cost proxy used superseded/historical settlement assumptions. Do not use
that extraction as a current canonical-path outcome.

## 11. Exact limitations

`P_max` depends on at least side, size, margin, execution-step count, initial
and other-trader OI, the full path and liquidation-check schedule, and
settlement order. Those are not all arguments of `P_max(z; B, K)` unless
added to the attacker model. The repository does not perform a global
optimization over these choices.

`C_min` is not computed. The external pool-to-observation mapping and
attacker's strategy space are absent. The proxy is not a minimum net cost.

## 12. Why this is not a proof

Tests establish implementation-level behavior on tested states. Experiments
report outcomes for selected assumptions and finite grids. Neither provides
the attacker strategy optimization, real external-market cost, or global
feasible-position optimization required for a formal economic-security
result.

The valid conclusion is **economic security is UNPROVEN**. For a precise
limitation inventory and missing proof bridge, see
[limitations.md](limitations.md).

# Economic Security Validation Against the Implemented Protocol

## 1. Objective

Re-evaluate whether the repository's implemented position lifecycle supports
the economic-security condition:

```text
minimum attacker cost > maximum realizable protocol extraction
```

The analysis distinguishes:

- **PAPER-SUPPORTED PRINCIPLE** — the research framing calls for attack cost
  to exceed attacker profit. No numerical attack-cost or extraction formula
  is attributed to the paper here.
- **REPOSITORY IMPLEMENTATION** — the current TypeScript price, execution,
  position, liquidation, settlement, and vault-accounting paths.
- **PROJECT ASSUMPTION** — the modeled reference-price path, external AMM
  liquidity, attack duration, recovery to 100, position sizing, and backing.
- **EXPERIMENTAL RESULT** — a finite measurement for the explicit scenarios
  below; not a proof over every feasible attack.

The repository is an off-chain prototype. These results do not demonstrate
deployed-contract behavior or authenticated external-oracle behavior.

## 2. Production attack lifecycle

The production-facing repository path is:

```text
ReferencePriceSource observation
    -> finite/positive and timestamp validation
    -> 900-second arithmetic TWAP
    -> canonical mark = getCurrentAmmPrice(market, config)
    -> simulateTrade execution and OPEN position/OI
    -> markPosition margin-ratio check
    -> settleAndClosePosition or settleAndLiquidatePosition
    -> prepare/validate vault PnL and position/OI transition
    -> committed lifecycle and PnL accounting
```

Relevant implementation is in
[`ReferencePriceService.ts`](../../src/oracle/ReferencePriceService.ts),
[`TWAPOracle.ts`](../../src/oracle/TWAPOracle.ts),
[`Pricing.ts`](../../src/amm/Pricing.ts),
[`TradeSimulator.ts`](../../src/simulation/TradeSimulator.ts),
[`PositionMark.ts`](../../src/risk/PositionMark.ts),
[`SettleAndClosePosition.ts`](../../src/settlement/SettleAndClosePosition.ts),
[`SettleAndLiquidatePosition.ts`](../../src/settlement/SettleAndLiquidatePosition.ts),
and [`LiquidityVault.ts`](../../src/liquidity/LiquidityVault.ts).

The production mark remains:

```text
skew = longOI - shortOI
skewRatio = skew / maxCapacity
mark = ammTwapPrice * (1 + skewCoefficient * skewRatio)
```

The close and liquidation operations snapshot that mark before releasing
their position's OI. The attack scenario runner feeds reference observations
through `updateMarketFromReferencePrice`, opens a position through
`simulateTrade`, advances a 100-price reference path through the real
arithmetic TWAP, checks liquidation at each 15-second update, and attempts
canonical settlement.

Attacker-influenced inputs in this modeled path are the source's observed
prices and timestamps, the duration and path of those observations, and the
attacker's position side, size, and margin. The repository has only the
abstract `ReferencePriceSource` interface: it supplies no authenticated
provider, external source, source-integrity guarantee, or attack-cost
enforcement. Thus this is a lifecycle test under an explicit source-price
scenario, not a measured real-world cost to control an oracle.

The path's **SCENARIO ASSUMPTION** is that the reference is held at the
calculated manipulation price for the specified duration, then returns to
100 and remains there. The TWAP recovery is not an immediate arbitrary
settlement-price injection: it is replayed through the 900-second observation
window. The model uses the repository's arithmetic TWAP, not the Euler
geometric formula used by some historical analytical experiments.

## 3. Attack-cost model

The existing attack-cost proxy in
[`attackEconomicsModel.ts`](../../experiments/archive/attackEconomicsModel.ts) assumes a
constant-product external AMM:

| Input | Assumption |
|---|---:|
| Initial spot | 100 |
| Initial base reserve | 50,000 |
| Initial quote reserve | 5,000,000 |
| Manipulation | Downward, from spot 100 to the arithmetic-TWAP-implied spot |
| Observation interval | 15 seconds |
| Manipulated intervals | `duration / 15` |
| Per-interval model | Recompute the one-way constant-product slippage from the same initial reserves |
| Reported attack cost | One-way slippage proxy per interval multiplied by interval count |

For each duration, the implied manipulated reference price is:

```text
requiredReferencePrice =
  (targetTwap * 900 - 100 * (900 - duration)) / duration
```

The model computes base input from the constant-product price relation and
subtracts quote received from the input valued at 100. It then multiplies
that amount by the number of 15-second intervals. It does **not** evolve one
shared external AMM state across those intervals. It is not a proof of
minimum attacker capital, a measured attacker loss, or a calibrated minimum
economic cost.

| Component | Included? | Directional limitation if omitted |
|---|---|---|
| Initial reserves and one-shot reserve-price relation | Yes, as fixed assumptions | Not validated against a real venue |
| Reserve evolution across intervals | No | Unknown: repeated reset can overstate repeated slippage, while real replenishment/market response can add costs |
| Arbitrage | No | Unknown |
| Back-running | No | Unknown |
| Trading fees | No | Aggressive for attacker cost: omission tends to understate costs |
| Gas / execution fees | No | Aggressive for attacker cost |
| Financing / opportunity cost | No | Unknown; depends on funding source and horizon |
| Inventory and mark-to-market risk | No | Unknown |
| Manipulation unwind / attacker exit cost | No | Unknown; no actual terminal external-AMM state is modeled |
| Multi-block execution and external venue state transitions | No | Unknown |
| Perp margin funding/custody cost | No | Unknown |

Accordingly, the ratio below is a comparison against a **prototype attack-cost
proxy**, not against minimum attacker capital or established attacker
economic loss.

## 4. Extraction definition

The runner keeps the following quantities distinct:

- **Gross settlement PnL** — the PnL calculated at the canonical production
  settlement price, whether or not the close can commit.
- **Realized trader PnL** — signed PnL booked only after successful
  settlement; zero when a settlement is rejected.
- **Realized extraction** — `max(realized trader PnL, 0)`. A rejected
  settlement and an unrealized mark are both zero.
- **Trader claim** — the settlement result's existing `margin + PnL` or
  liquidation claim field. It is reported separately and is not treated as
  LP loss.
- **Vault change** — initial `availableCapital` minus final
  `availableCapital`; positive is an LP accounting loss.
- **Attacker net profit** — not established. Subtracting the prototype
  external-AMM proxy does not produce a verified net profit because the
  external cost model and actual asset/custody flows are unverified.

An opposite-side `simulateTrade()` is not treated as a position close. The
new runner uses only canonical close/liquidation operations to count a
realized result.

The vault enforces the nonnegative `availableCapital` invariant for committed
PnL accounting, and failed settlement leaves the position, OI, and vault
unchanged. The prototype has no actual token transfer or margin-custody
ledger, so this is an internal accounting solvency result, not a proof that a
cash payout occurred or is fully collateralized.

## 5. Scenario matrix

Run the current-path model with:

```sh
npx tsx experiments/implementedEconomicSecurity.ts
```

The reusable function
`runImplementedEconomicSecurityMatrix()` returns every row with target
TWAP, duration, utilization, capacity, position size, implied manipulated
reference price, actual TWAP, entry, margin, manipulated mark, entry margin
ratio, liquidation result, settlement price, gross and realized PnL, claim,
vault change, attack cost, cost/extraction ratio, and lifecycle status.

The principal matrix contains **140 scenarios per backing level**:

- TWAP targets: 95, 90, 85, 80.
- Manipulation durations: 15, 30, 60, 120, 300, 600, 900 seconds.
- Capacity utilization: 10%, 20%, 30%, 40%, 50%.
- Capacity: 100,000.
- Margin: size / 5 (5x under this repository's size/margin leverage rule).
- Backing: $50,000 baseline and $10,000,000 funded comparison.
- Reference recovery: 100 for a further 900 seconds (SCENARIO ASSUMPTION).
- TWAP: complete 900-second production arithmetic TWAP, built from
  15-second observations.

The 65 nonpositive manipulated-reference-price combinations are rejected
before opening. At $50,000 backing, all 75 reachable cases open but are
unable to commit their positive-PnL settlement. At $10,000,000 backing, all
75 reachable cases settle as realized profits. The latter matrix contains
both ratios above and below 1; it therefore does not support the required
inequality uniformly.

A separate capacity-axis measurement holds TWAP 95, duration 900 seconds,
utilization 30%, and backing $10,000,000 fixed while varying `maxCapacity`
between 50,000, 100,000, and 200,000. The experiment runner prints the
measured rows; no capacity-to-capital relationship is assumed.

| `maxCapacity` | Position size | Realized extraction | Cost / extraction |
|---:|---:|---:|---:|
| 50,000 | 15,000 | $125,366.52 | 1.574 |
| 100,000 | 30,000 | $250,733.03 | 0.787 |
| 200,000 | 60,000 | $501,466.07 | 0.394 |

For this fixed-utilization scenario, doubling configured capacity doubles
measured extraction. This is a measured result for this price path and
pricing configuration, not a universal monotonicity proof.

## 6. Historical scenario revalidation

### TWAP 95 / 900 seconds / 30% capacity

The observed entry is **97.642232**, matching the previously reported
approximately 97.6422. The production close does not settle at an injected
recovery price of 100. With 30% long utilization, the manipulated mark at
entry is **100.7** and, after the reference/TWAP returns to 100, the
pre-release canonical settlement mark is **106**.

| Backing | Gross settlement PnL | Realized extraction | Vault change | Attack-cost proxy | Ratio | Outcome |
|---:|---:|---:|---:|---:|---:|---|
| $50,000 | $250,733.03 | $0 | $0 | $197,335.97 | N/A | Close rejected: `INSUFFICIENT_LP_BACKING`; remains open |
| $10,000,000 | $250,733.03 | $250,733.03 | $250,733.03 | $197,335.97 | 0.787 | Realized profit |

The old $70,733.03 result uses a recovery value of 100 directly. The current
canonical settlement price is 106 because the still-open long OI affects the
mark before OI release. That changes gross PnL to $250,733.03. The default
$50,000 vault rejects it atomically; the unfunded gross PnL is **not**
counted as extraction.

### Higher severity at 30% utilization

All four cases use $10,000,000 backing for the realized comparison; with the
$50,000 baseline vault, each close is rejected for insufficient backing.

| Target TWAP | Duration | Manipulated reference | Entry | Margin | Manipulated mark | Settlement | Realized PnL / extraction | Vault change | Attack-cost proxy | Cost / extraction |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 90 | 900s | 90 | 92.5032 | 6,000 | 95.4 | 106 | 404,904.98 | 404,904.98 | 832,755.43 | 2.057 |
| 85 | 900s | 85 | 87.3641 | 6,000 | 90.1 | 106 | 559,076.93 | 559,076.93 | 1,982,020.45 | 3.545 |
| 80 | 900s | 80 | 82.2250 | 6,000 | 84.8 | 106 | 713,248.87 | 713,248.87 | 3,738,353.92 | 5.241 |

## 7. Worst observed scenario

The minimum attack-cost-proxy / realized-extraction ratio among profitable
scenarios in the funded 140-row matrix is:

| Field | Measured value |
|---|---:|
| Target TWAP | 95 |
| Duration | 900 seconds |
| Implied manipulated reference | 95 |
| Capacity / utilization | 100,000 / 50% |
| Position size | 50,000 |
| Entry price | 99.5351 |
| Margin | 10,000 |
| Manipulated mark | 104.5 |
| Liquidation | No |
| Settlement price | 110 |
| Realized trader PnL / extraction | $523,244.05 |
| Vault change | $523,244.05 loss |
| Attack-cost proxy | $197,335.97 |
| Cost / extraction | **0.377** |
| Lifecycle | REALIZED PROFIT |

Thus the current proxy yields a sampled case where modeled cost is below
realized extraction. This is a counterexample to the inequality **under this
proxy and scenario**, not a verified real-world exploit-cost estimate.

Maximum realized extraction and maximum vault loss in the funded matrix are
both **$1,309,047.62**, at TWAP 80, duration 300 seconds, utilization 50%,
size 50,000, margin 10,000, implied manipulated reference price 40, entry
83.8190, manipulated mark 88, and settlement price 110. The position is not
liquidated. Its attack-cost proxy is $21,359,436.21 and ratio is 16.317.
With $10,000,000 initial backing, the close succeeds and leaves positive
accounting capital.

These maxima are only the maxima over the enumerated, fixed-capacity,
fixed-backing matrix.

## 8. Solvency results

**SOLVENCY: ENFORCED** for committed internal `availableCapital` accounting:
profitable closes that exceed available backing are rejected, while funded
profitable closes book once and leave `availableCapital >= 0`. Atomicity and
the funded/unfunded settlement boundaries are covered by
[`vaultSolvency.test.ts`](../../tests/vaultSolvency.test.ts),
[`settlementAtomicity.test.ts`](../../tests/settlementAtomicity.test.ts), and
[`implementedEconomicSecurity.test.ts`](../../tests/implementedEconomicSecurity.test.ts).

The 30%-utilization TWAP95 scenario with $50,000 backing has a gross
$250,733.03 result but zero realized extraction and zero vault change after
the rejected close. The same scenario with $10,000,000 backing realizes that
PnL. The separate liquidation boundary test uses a 10%-utilization SHORT at
TWAP 95 with 10x leverage: the recovering canonical mark makes it
liquidatable, liquidation commits once, trader PnL is a loss of $1,032.21,
the trader claim is zero, and no positive extraction is recorded.

This accounting invariant does not imply that margin was deposited or that
the reported trader claim was transferred; custody and payout rails are not
implemented here.

## 9. Economic-security results

**ECONOMIC SECURITY: VIOLATED** in the tested proxy model: the funded
TWAP95/900s/50%-utilization case has an estimated cost/extraction ratio of
0.377. Other sampled severities have ratios above 1, so outcomes are
scenario-dependent. The protocol itself contains no attack-cost or
cost-versus-extraction check:

```text
ECONOMIC SECURITY IS ANALYZED, NOT ENFORCED ON-CHAIN
```

The measured result must not be promoted to a claim that a real attacker can
acquire the source manipulation for $197,335.97. The external venue and
reference-source controls are not implemented or calibrated.

## 10. Model limitations

1. `ReferencePriceSource` is an interface, not an authenticated production
   provider. The model supplies scenario prices locally.
2. Recovery to 100 is a scenario assumption, not a forecast or protocol
   guarantee. It is nevertheless replayed through the production TWAP path.
3. The external constant-product reserves are assumptions; repeated per-block
   cost does not evolve shared reserves and omits arbitrage, back-running,
   fees, gas, financing, inventory and unwind effects.
4. The cost proxy is neither minimum attacker capital nor proven attacker
   economic loss; attacker net profit is unknown.
5. The repo's “production” lifecycle is TypeScript/off-chain; no deployed
   contract or token-transfer behavior is validated.
6. The vault check covers signed PnL accounting and nonnegative
   `availableCapital`; it does not establish margin custody or actual cash
   payout.
7. The principal matrix fixes `maxCapacity=100,000` and uses only a finite
   set of TWAPs, durations, utilization values, margin, reference paths, and
   vault balances. It is not exhaustive.
8. Legacy experiments such as `economicDurationSweep.ts`,
   `economicInvariantSweep.ts`, `twapSeverityCapacitySweep.ts`,
   `recoverySensitivity.ts`, `solvencyBoundary.ts`, and
   `lpCapitalSensitivity.ts` intentionally retain experimental price inputs
   and/or simplified margin checks. Their outputs are historical/analytical
   comparisons, not production settlement results. In particular, some
   directly settle at a supplied `recoveryPrice=100`, use geometric TWAP, or
   count a simulated opposite-side trade as a round trip.
9. Capacity is independent of LP backing. Increasing it can increase the
   size and extraction possible in a funded scenario; the report's capacity
   axis is a measurement, not a capacity-to-capital rule.

## 11. Global-proof status

**GLOBAL MAXIMUM EXTRACTION: NOT ESTABLISHED BY CURRENT MODEL.**

For a fixed vault state, positive committed close PnL cannot exceed current
available backing because the transaction rejects otherwise. That local
accounting bound is not a global protocol bound: `maxCapacity`, reference
prices, and LP deposits have no global configured ceiling, and no enforced
relationship couples capacity to backing. No exhaustive feasible-attack
domain or mathematical bound on maximum extraction is present.

The finite sweep is evidence about the rows measured, not a proof over all
possible reference paths, durations, capacities, market configurations,
positions, and funding levels. The protocol-wide economic-security claim
therefore remains **UNPROVEN** even though the sampled cost proxy has a
counterexample.

## 12. Conclusion

The implemented lifecycle materially improves the analysis over headline
round-trip PnL: it uses the current arithmetic TWAP, canonical mark,
production position transitions, liquidation eligibility, settlement, and
vault solvency guard. It prevents the historical $250,733.03 positive-PnL
settlement from committing against $50,000 backing. With sufficient backing,
however, the modeled scenario realizes profit, and the prototype attack-cost
proxy is below that extraction in at least one measured case.

The current implementation therefore enforces local vault accounting
solvency but does not enforce the economic-security inequality. Because the
attack-cost model is unvalidated and a global extraction bound is absent,
no global security proof is established.

```text
SOLVENCY:
ENFORCED

ECONOMIC SECURITY:
VIOLATED

GLOBAL MAXIMUM EXTRACTION:
NOT ESTABLISHED

ATTACK-COST ENFORCEMENT:
ANALYZED ONLY

CAPACITY ↔ CAPITAL:
UNCOUPLED
```

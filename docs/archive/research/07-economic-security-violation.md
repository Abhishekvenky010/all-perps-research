# Economic Security Violation: Root-Cause Analysis

## 1. Executive conclusion

The current funded scenario matrix contains **five genuine positive-PnL
settlements inside the repository's implemented TypeScript lifecycle** whose
reported constant-product attack-cost proxy / realized-PnL ratio is below 1.
All five:

- used observations to produce the 900-second arithmetic TWAP;
- opened a LONG through `simulateTrade`;
- remained above the liquidation boundary;
- settled through `settleAndClosePosition` at the canonical pre-OI-release
  mark;
- passed the vault's available-capital check with $10,000,000 initial
  backing; and
- booked positive PnL exactly once.

They are not simulated opposite-side closes, caller-supplied recovery-price
settlements, rejected closes, or unrealized marks.

The comparison is nevertheless **MODEL-DEPENDENT**, not a confirmed
real-world economic-security violation. The numerator is a stylized,
repeated one-shot constant-product mark-to-market cost proxy, not a
demonstrated minimum cost or realized attacker loss. The repository also
does not define position-size units or actual asset transfers well enough
to prove that the proxy and protocol PnL are economically commensurate.

The implementation-level root cause is visible: after recovery to a $100
TWAP, a 50%-capacity LONG position changes the canonical settlement mark to
$110 through its own still-open skew. That self-skew settlement effect
produces substantial positive PnL. A depressed TWAP lowers the entry price
further. The vault guard blocks this PnL when backing is insufficient, but
does not block it when sufficient backing is present. No economic
cost-versus-extraction rule exists in the protocol.

## 2. Genuine violating scenarios

The search enumerated all **140** combinations from the funded
`runImplementedEconomicSecurityMatrix` case:

- target TWAPs 95, 90, 85, 80;
- durations 15, 30, 60, 120, 300, 600, 900 seconds;
- capacity utilization 10%, 20%, 30%, 40%, 50%;
- `maxCapacity=100,000`;
- initial vault backing $10,000,000;
- margin equal to size / 5 (5x under the experiment's leverage setting);
- reference recovery to 100, followed by a full 900-second TWAP recovery.

Exactly five rows had positive realized extraction and ratio below 1:

| TWAP target | Duration | Utilization | Position size | Entry | Margin | Settlement | Realized extraction (PnL) | Vault backing | Attack cost proxy | Ratio | Liquidation |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 95 | 600s | 40% | 40,000 | 98.5704 | 8,000 | 108 | $377,185.12 | $10,000,000 | $303,938.58 | 0.806 | Not liquidated |
| 95 | 600s | 50% | 50,000 | 99.5351 | 10,000 | 110 | $523,244.05 | $10,000,000 | $303,938.58 | 0.581 | Not liquidated |
| 95 | 900s | 30% | 30,000 | 97.6422 | 6,000 | 106 | $250,733.03 | $10,000,000 | $197,335.97 | 0.787 | Not liquidated |
| 95 | 900s | 40% | 40,000 | 98.5704 | 8,000 | 108 | $377,185.12 | $10,000,000 | $197,335.97 | 0.523 | Not liquidated |
| 95 | 900s | 50% | 50,000 | 99.5351 | 10,000 | 110 | $523,244.05 | $10,000,000 | $197,335.97 | **0.377** | Not liquidated |

These are violations of the **sampled proxy inequality**. Whether they
represent an attacker able to spend less in a real external market than they
extract from a deployed protocol is unresolved; see Sections 4 and 11.

## 3. Reproduction path

The reproducer is
[`implementedEconomicSecurity.ts`](../../experiments/implementedEconomicSecurity.ts).
The focused regression tests are in
[`implementedEconomicSecurity.test.ts`](../../tests/implementedEconomicSecurity.test.ts).
The test suite verifies the unfunded rejection, funded close, capacity
variation, and liquidation case.

For the worst row (TWAP 95, 900 seconds, 50% utilization), the actual runner
path is:

1. **Reference-price path — SCENARIO ASSUMPTION:** supply price 95 at
   15-second observations over the first 900 seconds, then 100. The source
   is an in-memory implementation of `ReferencePriceSource`, not an
   authenticated external provider.
2. **Observation and TWAP:** call `updateMarketFromReferencePrice` for each
   observation. At timestamp 900, the 900-second arithmetic TWAP is 95.
3. **Protocol execution mark:** before opening, the market has zero skew;
   its mark is 95.
4. **Entry:** open one 50,000-size LONG using the five-step `simulateTrade`
   path. The average entry is 99.535119. Margin is 10,000.
5. **Position and margin:** the stored position remains OPEN. Its immediate
   canonical mark is 104.5 after its 50% long skew is reflected. Its margin
   ratio is 5.16488, well above the 0.05 maintenance threshold.
6. **Recovery and liquidation:** feed 100 reference observations for the
   next 900 seconds. The TWAP recovers through the production oracle path.
   The LONG is not liquidatable at any checked update.
7. **Canonical settlement:** `settleAndClosePosition` snapshots
   `getSettlementPrice` while the LONG's OI is still present. The settlement
   price is 110; this is not an externally supplied recovery price.
8. **Vault guard and lifecycle:** gross and committed PnL is
   $523,244.047619. With $10,000,000 initial available capital,
   `prepareTraderPnL` accepts the settlement. The position becomes SETTLED,
   the exact OI is released, and vault `availableCapital` decreases by the
   same PnL once. The result reports a trader settlement/claim of
   $533,244.047619 (margin plus PnL); the prototype does not implement an
   actual asset transfer.

The other four rows use the same lifecycle. For their 600-second cases, the
implied manipulated reference price is 92.5; for 900 seconds it is 95. Their
position sizes are 30,000–50,000, and their settlement marks follow
`100 + 0.2 * longOI / maxCapacity`, yielding 106, 108, or 110.

### Authenticity and exactness boundary

The repository lifecycle evidence is genuine for this TypeScript model:
production-named reference ingestion, real TWAP arithmetic, trade
simulation, liquidation evaluation, canonical close, and vault accounting
are used. It is not evidence of an external attacker actually controlling a
reference feed. `ReferencePriceSource` is an interface and this experiment
supplies prices directly to its local implementation as a scenario.

The close is genuinely committed in the funded cases. The reported
`realizedExtraction` is positive **trader PnL**, not merely headline PnL.
The settlement result separately reports margin plus PnL as the trader
claim. The prototype has no token transfer or margin-custody ledger, so
“realized” means booked by the implemented settlement/accounting lifecycle,
not independently observed cash received by a trader.

## 4. Attack-cost calculation

The numerator comes from
[`manipulationAttackCost`](../../experiments/archive/attackEconomicsModel.ts), not
from the production protocol. It assumes a constant-product pool with:

- initial spot 100;
- 50,000 base reserve and 5,000,000 quote reserve;
- the spot needed to produce the target arithmetic TWAP; and
- 15-second “manipulated blocks.”

For a target TWAP of 95:

```text
required manipulated spot =
  (95 * 900 - 100 * (900 - duration)) / duration

attackCost =
  one-shot constant-product mark-to-market shortfall
  * (duration / 15)
```

Examples for the violating family:

| Duration | Required manipulated spot | One-shot proxy per interval | Intervals | Total attack-cost proxy |
|---:|---:|---:|---:|---:|
| 600s | 92.5 | $7,598.46 | 40 | $303,938.58 |
| 900s | 95 | $3,288.93 | 60 | $197,335.97 |

The unit calculation is `baseInput * 100 - quoteOutput`, floored at zero.
This is the modeled value shortfall from supplying base inventory valued at
the initial reference price and receiving quote from one constant-product
trade. It is not a measured cash loss after closing the external position.

| Cost component | Present? | Omission / model treatment | Classification |
|---|---|---|---|
| External-AMM slippage | Yes, one constant-product reserve calculation per interval | Venue and reserves are assumptions, not market observations | Included, unvalidated |
| Manipulation duration | Yes, linear interval multiplier | Multiplier repeats an identical one-shot calculation | Included, but stylized |
| TWAP weighting | Yes, arithmetic inversion for target and duration | The protocol-side TWAP is separately replayed; cost side still abstracts the external feed/venue | Included, under the assumed path |
| Arbitrage | No | No arbitrageurs or reserve response simulated | UNKNOWN |
| Back-running | No | No transaction ordering or extraction from the attacker simulated | UNKNOWN |
| Fees | No | If positive fees apply to the assumed trades, omitting them understates cost | AGGRESSIVE for attacker economics |
| Gas | No | If nonzero, omission understates cost | AGGRESSIVE for attacker economics |
| Financing | No | Depends on borrowed versus owned inventory, rates, and duration | UNKNOWN |
| Inventory mark-to-market | Partly: the one-shot formula is a value-shortfall measure | No time path or marked inventory is tracked across intervals | UNKNOWN |
| Attacker exit / unwind | No | No reverse trade or terminal external reserves modeled | UNKNOWN |
| Multi-block execution effects | Only as `duration / 15` multiplication | It does not execute a stateful 40- or 60-block external pool path | UNKNOWN |
| External pool reserve evolution | No shared evolution | Each “block” is costed from the same initial reserves | UNKNOWN |

Repeating the one-shot shortfall from the same initial reserves is not a
stateful cost model. It might overstate repeated cost if it charges the same
price displacement again without needing to reset the pool; conversely,
real arbitrage, fees, financing, inventory exposure, and unwind could add
cost. Because the missing dynamics interact, the direction of the net bias
is UNKNOWN.

## 5. Extraction calculation

For LONG positions the repository formula is:

```text
PnL = (settlementPrice - entryPrice) * size
```

For the worst row:

```text
(110 - 99.53511904761905) * 50,000
= $523,244.047619
```

The settlement operation books that signed PnL against `traderPnL` and
`availableCapital`, and returns the margin-plus-PnL claim. At $10,000,000
backing it succeeds; the position becomes terminal and OI is removed. This
is not a failed settlement, open mark, or opposite-side simulated trade.

The solvency boundary for this scenario is approximately $523,244.047619
of available capital, because the vault guard checks whether the resulting
available capital after PnL remains nonnegative. A deposit of $523,244.0476
rejects; $523,244.0477 succeeds. The trader claim is larger by the 10,000
margin, but the model has no separate margin custody or actual payment
ledger.

## 6. Why the attacker can profit

### Exact price decomposition for the worst row

The position is split into five equal 10,000-size fills. Before each fill,
long OI is 0, 10,000, 20,000, 30,000, then 40,000. The repository's
execution pricing produces:

| Pre-fill long OI | Skew fair value at TWAP 95 | LONG execution price after capacity spread |
|---:|---:|---:|
| 0 | 95.00 | 95.0000 |
| 10,000 | 96.90 | 97.1692 |
| 20,000 | 98.80 | 99.4175 |
| 30,000 | 100.70 | 101.7789 |
| 40,000 | 102.60 | 104.3100 |

Average fair value before capacity spread is 98.80; average execution/entry
is 99.535119. At settlement, the reference TWAP is 100 but the LONG remains
open, so its own skew raises the canonical mark to 110.

An exact telescoping decomposition of the $523,244.05 PnL is:

| Component | Contribution |
|---|---:|
| Reference/TWAP recovery, `size * (100 - targetTwap)` | +$250,000.00 |
| Settlement mark's own-skew uplift, `size * (settlement - 100)` | +$500,000.00 |
| Entry skew pricing above the target TWAP, `size * (targetTwap - avgFairValue)` | -$190,000.00 |
| Capacity execution spread above fair value, `size * (avgFairValue - entry)` | -$36,755.95 |
| **Total** | **$523,244.05** |

The PnL includes a large endogenous mark/skew component. With the same
50,000-size position but no TWAP manipulation (target 100, no attack-cost
estimate), the runner still produces $261,309.52 of positive PnL: entry
104.773810, settlement 110. The depressed-TWAP scenario adds $261,934.52
relative to that no-manipulation control. Thus the gross extraction is not
all attributable to external oracle manipulation; the protocol's
self-skew settlement pricing alone produces material modeled PnL.

Margin does not enter the PnL equation. It affects whether the position
crosses the liquidation threshold, but the worst row remains open and
settleable even at substantially higher margin.

## 7. Capacity sensitivity

Hold target TWAP 95, duration 900 seconds, `maxCapacity=100,000`, and
$10,000,000 backing fixed; vary position size from 10% to 50% of capacity.
Every row settles with no liquidation.

| Utilization | Size | Entry | Margin | Settlement | Realized extraction | Attack cost | Ratio |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 10% | 10,000 | 95.8623 | 2,000 | 102 | $61,376.69 | $197,335.97 | 3.215 |
| 20% | 20,000 | 96.7416 | 4,000 | 104 | $145,167.72 | $197,335.97 | 1.359 |
| 30% | 30,000 | 97.6422 | 6,000 | 106 | $250,733.03 | $197,335.97 | 0.787 |
| 40% | 40,000 | 98.5704 | 8,000 | 108 | $377,185.12 | $197,335.97 | 0.523 |
| 50% | 50,000 | 99.5351 | 10,000 | 110 | $523,244.05 | $197,335.97 | **0.377** |

In this family, extraction increases and the proxy ratio deteriorates at every
tested capacity-utilization increment. The attack-cost proxy is independent
of position utilization; the settlement mark's skew uplift and the allowed
position size grow with utilization. This is a measured monotonic trend over
these five points, not a general proof.

## 8. LP-capital sensitivity

Hold the worst attack fixed: target 95, duration 900 seconds, 50% utilization,
size 50,000, margin 10,000. The existing vault guard checks PnL against
available capital.

| Initial available backing | Settlement result | Realized PnL/extraction | Vault change | Ratio |
|---:|---|---:|---:|---:|
| $50,000 | Rejected: insufficient backing | $0 | $0 | N/A |
| $200,000 | Rejected: insufficient backing | $0 | $0 | N/A |
| $500,000 | Rejected: insufficient backing | $0 | $0 | N/A |
| $523,243 | Rejected: insufficient backing | $0 | $0 | N/A |
| $523,244.0476 | Rejected: insufficient backing | $0 | $0 | N/A |
| $523,244.0477 | Committed | $523,244.05 | $523,244.05 loss | 0.377 |
| $600,000 | Committed | $523,244.05 | $523,244.05 loss | 0.377 |
| $1,000,000 | Committed | $523,244.05 | $523,244.05 loss | 0.377 |
| $10,000,000 | Committed | $523,244.05 | $523,244.05 loss | 0.377 |

Above the exact boundary, more backing does not change entry, settlement,
PnL, or the ratio in this scenario; it only allows the same PnL to commit.
The guard enforces local accounting solvency. It is not an economic-security
mechanism and does not make the cost/extraction inequality true.

The older
[`lpCapitalSensitivity.ts`](../../experiments/archive/lpCapitalSensitivity.ts) is a
separate historical experiment: it explicitly settles at a supplied
recovery price of 100 and does not replay production reference observations
or TWAP. It rejects $50,000 through $70,733 backing and realizes $70,733.03
from $75,000 backing upward in that scenario. That result is not substituted
for the current canonical-path sensitivity above.

## 9. Margin sensitivity

Hold the worst attack path, target, duration, capacity, and utilization
fixed, with $10,000,000 backing. Vary margin while preserving the same
position size and execution.

| Leverage (`size / margin`) | Margin | Entry | Realized extraction | Attack cost | Ratio | Liquidation |
|---:|---:|---:|---:|---:|---:|---|
| 10x | $5,000 | 99.5351 | $523,244.05 | $197,335.97 | 0.377 | No |
| 5x | $10,000 | 99.5351 | $523,244.05 | $197,335.97 | 0.377 | No |
| 2x | $25,000 | 99.5351 | $523,244.05 | $197,335.97 | 0.377 | No |
| 1x | $50,000 | 99.5351 | $523,244.05 | $197,335.97 | 0.377 | No |
| 0.5x | $100,000 | 99.5351 | $523,244.05 | $197,335.97 | 0.377 | No |

The violation in this scenario is not caused by high leverage or low margin:
it remains at 1x and 0.5x leverage. Margin has no effect on this position's
PnL so long as it avoids liquidation; the 5x default is already far from the
maintenance boundary.

## 10. Duration sensitivity

Hold target TWAP 95, utilization 50%, capacity 100,000, and $10,000,000
backing fixed. The final TWAP, entry, settlement, realized extraction, and
liquidation result remain the same for every reachable duration. Only the
required manipulated spot and modeled attack cost change.

| Duration | Required spot | Realized extraction | Attack cost proxy | Ratio | Status |
|---:|---:|---:|---:|---:|---|
| 15s | -200 | $0 | N/A | N/A | Rejected before position; nonpositive required spot |
| 30s | -50 | $0 | N/A | N/A | Rejected before position; nonpositive required spot |
| 60s | 25 | $523,244.05 | $10,000,000.00 | 19.112 | Realized profit |
| 120s | 62.5 | $523,244.05 | $2,219,219.16 | 4.241 | Realized profit |
| 300s | 85 | $523,244.05 | $660,673.48 | 1.263 | Realized profit |
| 600s | 92.5 | $523,244.05 | $303,938.58 | 0.581 | Realized profit |
| 900s | 95 | $523,244.05 | $197,335.97 | **0.377** | Realized profit |

The shortest durations are unreachable under positive-price observations.
Among reachable tested durations, the reported cost/extraction ratio
decreases monotonically as duration increases, because the cost proxy's
shallower required spot more than offsets its linear interval multiplier.
The minimum observed ratio in this family is **0.377 at 900 seconds**.
Extraction does not increase with duration here; it is held fixed by
reaching the same TWAP target and running the same position/recovery
scenario.

## 11. Model limitations

### Economic unit comparability

The external-pool cost formula is expressed in quote-value units if the
reference price is quote per base. The protocol PnL formula is
`(price difference) * size`, which is quote-denominated if `size` is base
quantity. Under that interpretation, both tables can be read as nominal
quote dollars.

The repository does **not**, however, define an asset/unit type for
`Position.size`, `MarketConfig.maxCapacity`, or `margin`. The leverage check
divides `size / margin` as if they share a unit, while the PnL formula
multiplies price-per-base by size as if size is base quantity. No contract
multiplier or conversion definition reconciles those conventions. Thus
nominal numeric USD-like values are comparable only under an unstated
interpretation; strict economic-unit comparability is **not established**.

There is also a meaning/horizon mismatch: attack cost is a repeated
mark-to-market shortfall proxy over manipulation intervals, whereas
extraction is PnL booked once at settlement. Neither field is a complete
attacker cash-flow ledger. The trader claim is margin plus PnL, but margin
deposit and payout are not represented as transfers.

### Scope and assumptions

- The reference source is local and unauthenticated. Controlling it is
  assumed, not costed.
- The recovery path returns to 100 by scenario choice, not protocol policy.
- The external constant-product pool is not a live or evolving venue.
- Omitted arbitrage/back-running effects are UNKNOWN; omitted positive fees
  and gas would increase cost if applicable, but their size is not modeled.
- The matrix varies a finite set of targets, durations, sizes, margins, and
  backing values. It cannot establish a global minimum cost or maximum
  extraction.
- The off-chain TypeScript lifecycle is not a deployed contract or proof of
  token settlement.
- Capacity and available LP backing are not mathematically coupled. Raising
  capacity can admit larger positions without requiring greater backing.
- Per the scenario decomposition, substantial PnL remains in the
  protocol's own-skew mark even without manipulation. The comparison does
  not fully isolate oracle-attributable incremental profit from baseline
  market-making/self-skew economics.

### Three explicit questions

**Question A — Can the protocol become insolvent?**  
**NO for realized settlements under the implemented accounting guard.** A
positive PnL that would make `availableCapital` negative is rejected
atomically. This is an internal accounting property, not proof of actual
custodied assets or payouts.

**Question B — Can an attacker realize more extraction than the modeled
attack cost?**  
**YES under the five reproduced scenario rows and the current numeric
proxy.** Each has committed positive PnL above the reported proxy cost.
Whether the proxy is the attacker's actual economic cost is not established.

**Question C — Does this establish a global economic-security violation?**  
**NO.** The scenarios establish a violation of the finite proxy comparison
inside the current implementation, but strict economic-unit comparability
and real-world attack cost are unresolved. They do not prove
`minimum attacker cost < maximum realizable extraction` over the feasible
attack domain.

## 12. Root cause

**Primary implementation mechanism:** the canonical settlement price includes
the still-open position's own OI skew. Long OI raises the mark used to settle
that same LONG before its OI is released; at 50% utilization the own-skew
component is a $10-per-unit settlement uplift, or $500,000 on 50,000 size.
The depressed TWAP additionally lowers the entry reference, while entry
skew and capacity spreads only partially offset the settlement uplift.

**Enabling accounting/configuration condition:** `maxCapacity` permits large
exposure without a binding capacity-to-backing relationship. The solvency
guard blocks settlement only when the positive PnL exceeds current
available capital. With sufficient LP backing it allows the same large
settlement loss to book, regardless of whether the external attack-cost
proxy is lower.

**Analysis limitation:** the proxy ratio is not a demonstrated attacker
cost-to-cash-extraction ratio because external costs and economic units are
not grounded. The code reproduces the accounting result; it does not settle
the real-world attack-economics question.

## 13. Candidate classes of fixes — NO IMPLEMENTATION

No candidate is selected or implemented. Classes for later evaluation only:

- bound protocol liability;
- couple capacity to backing;
- constrain settlement movement;
- alter economic pricing;
- improve and validate the attack-cost model.

These are categories for a later design decision, not recommendations or
changes made in this root-cause task.

```text
ECONOMIC SECURITY VIOLATION:
MODEL-DEPENDENT

ROOT CAUSE:
Settlement mark includes the position's own open skew, while capacity is uncoupled from backing.

GLOBAL MAXIMUM EXTRACTION:
NOT ESTABLISHED

FIX IMPLEMENTED:
NO
```

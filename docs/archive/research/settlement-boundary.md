# Settlement Boundary Semantics

## Decision status

**No boundary behavior is selected.** The proposed entry-relative movement
bound exposes a direct conflict between LP solvency and the product
requirement that every trader can close at every step. Rejecting or delaying
settlement preserves the raw price but can strand a position. Clamping allows
immediate settlement within the liability bound, but makes the effective
settlement price differ from the canonical mark, with position-specific
prices and new oracle incentives. A market-wide bounded mark is more
consistent across positions, but it does not imply an entry-relative bound
unless opening prices are bounded too.

The available repository and paper framing do not select among those
tradeoffs. Keep the boundary rule unresolved.

## 1. Frozen price model

The production price authority is now wired through the shared settlement
path. This checkpoint does not implement a movement boundary:

```text
Opening:

ammTwapPrice
    -> getAverageExecutionPrice()
    -> Position.entryPrice

Proposed raw mark / settlement:

rawSettlementPrice = getCurrentAmmPrice(market, config)
```

For the proposed solvency bound, the movement is relative to each position's
own entry:

```text
abs(rawSettlementPrice - position.entryPrice) <= DeltaP_max
```

`getCurrentAmmPrice` is derived from `ammTwapPrice` and current market skew.
The canonical source is implemented in `getSettlementPrice`, which delegates
to `getCurrentAmmPrice`; the external reference provider remains abstract and
unauthenticated. The entry-relative bound remains a **PROJECT ASSUMPTION**
from the previous solvency design, not a paper-specified price rule.

The distinction at issue is:

```text
rawSettlementPrice       = canonical internally derived mark
effectiveSettlementPrice = price actually used for PnL and settlement
```

When the raw price is in range, the candidate semantics are
`effectiveSettlementPrice = rawSettlementPrice`. When it is out of range,
the protocol must either reject, transform, delay, or otherwise define the
settlement. Leaving that behavior implicit makes the solvency bound
unenforceable as a protocol rule.

## 2. Concrete boundary case

Take a LONG position with:

```text
entryPrice = 97.64
rawSettlementPrice = 100
DeltaP_max = 0.50
```

Then:

```text
abs(100 - 97.64) = 2.36 > 0.50
```

The raw mark is outside the proposed movement bound. If the position has
size `S`, raw-price PnL is `2.36 * S`; the conditional bound only budgets
`0.50 * S`. A settlement policy must say which price the PnL engine uses and
whether the trader can complete a close now.

For the symmetric SHORT case, let `entryPrice = 102.36`, raw price `100`,
and `DeltaP_max = 0.50`: the favorable short movement is also 2.36, outside
the bound. Unfavorable movement can also exceed the absolute bound; the
implications of favorable-only versus two-sided limits are called out below.

## 3. Option analysis

### Option A — reject settlement outside the boundary

Rule:

```text
if abs(rawSettlementPrice - entryPrice) > DeltaP_max:
    settlement fails
```

- **Solvency:** The failed settlement does not realize an over-bound
  positive payout at that moment. It does not make the position solvent or
  remove its unrealized liability; the raw mark and trader exposure remain.
- **Closeability:** A trader cannot complete the financial close at the
  current step. A lower-level position-removal function is not a substitute:
  removing OI without settling PnL would abandon or misaccount for the
  trader's claim.
- **“Every trader can close at every step”:** Directly violated whenever a
  position is out of range.
- **Griefing / stuck positions:** A trader, market condition, or oracle
  manipulation that holds the mark outside the band can keep affected
  positions open. Permissionless requests can repeatedly fail without
  restoring closeability.
- **Liquidation:** If the same rejection applies to liquidation, an
  unhealthy position may be impossible to liquidate. If it applies only to
  voluntary close, liquidation can still realize an out-of-bound price and
  must have a separate solvency rule.
- **Economics:** The protocol defers rather than removes liability. A later
  return inside the band is not guaranteed by any current mechanism.

**LONG/SHORT and favorable/unfavorable cases:** An absolute-distance check is
side-symmetric: it rejects either a favorable or an adverse move beyond the
same distance. A favorable-only check would instead reject LONG prices above
`entry + DeltaP_max` and SHORT prices below `entry - DeltaP_max`, while
allowing arbitrarily adverse movements; that would not implement the stated
absolute-value condition.

### Option B — clamp settlement to the position's entry-relative band

The examples proposed for favorable profit caps are:

```text
LONG:
    effectiveSettlementPrice =
        min(rawSettlementPrice, entryPrice + DeltaP_max)

SHORT:
    effectiveSettlementPrice =
        max(rawSettlementPrice, entryPrice - DeltaP_max)
```

These one-sided formulas cap favorable PnL only. For LONGs, a raw price below
the upper boundary is used as-is, however far it falls; for SHORTs, a raw
price above the lower boundary is used as-is, however far it rises. Thus
they cap positive liability but do **not** enforce the previously stated
absolute movement condition. A two-sided clamp would instead use:

```text
effectiveSettlementPrice =
    clamp(rawSettlementPrice,
          entryPrice - DeltaP_max,
          entryPrice + DeltaP_max)
```

That also bounds adverse PnL and is a materially different loss and
liquidation policy. The protocol has not selected either interpretation.

- **Solvency:** A favorable-only clamp gives
  `max(positive PnL) <= size * DeltaP_max` per position. If all positions
  use it, and total open position size is bounded by `maxCapacity`, the
  aggregate positive-PnL bound is preserved:

  ```text
  sum(max(position.PnL, 0))
      <= DeltaP_max * sum(position.size)
      <= DeltaP_max * maxCapacity
  ```

  This is conditional on correctly accounting all open sizes and enough
  backing being reserved. A two-sided clamp also limits losses and may
  reduce the LP's ability to receive the full loss otherwise implied by the
  raw mark; it does not improve the positive-liability bound beyond the
  favorable cap.
- **Closeability:** The clamp can produce an effective price at every step,
  so it does not reject a close merely because the raw mark is outside the
  band. It preserves mechanical closeability, but settles at a transformed
  price.
- **Fairness and oracle semantics:** Each position has a different entry.
  At the same instant, two longs with different entry prices can receive
  different effective settlement prices; longs and shorts can also settle
  against different values. This ceases to be a single market mark. It
  creates artificial PnL relative to the raw oracle: favorable gains above
  the boundary are truncated, while the one-sided formulas leave adverse
  tail PnL untouched. A two-sided clamp additionally truncates losses.
- **Attack cost:** The external manipulation-cost model prices moving and
  holding the raw spot/TWAP inputs. It does not price a trader's
  position-specific clamp. Extraction and liquidation results would need
  to be recomputed against effective prices; existing attack-cost ratios
  cannot simply be reused.
- **Manipulation incentives:** Once the raw mark reaches the cap, pushing it
  farther does not increase the clamped favorable settlement for that
  position, which can cap that position's marginal extraction. But the
  rail itself is an incentive boundary: an attacker may seek to reach it,
  affect which positions are capped, or exploit the asymmetry between
  capped favorable and uncapped adverse moves. It does not make the raw
  oracle manipulation-proof.

**LONG/SHORT and unfavorable cases:** The proposed LONG upper clamp protects
  the protocol from excessive positive LONG PnL but does not cap a LONG
  loss. The proposed SHORT lower clamp similarly caps positive SHORT PnL
  but does not cap a SHORT loss. Applying the rule per side is directionally
  analogous, but side-specific effective prices are not one symmetric
  market price. A two-sided per-position clamp is algebraically symmetric,
  but changes both winners' and losers' PnL.

### Option C — bound a market mark independently of entry

Candidate:

```text
allowedPriceRange = [P_min, P_max]
effectiveSettlementPrice =
    clamp(rawSettlementPrice, P_min, P_max)
```

This would apply one effective price to every position in the market at a
given time and so better preserves the notion of a shared mark than
position-specific clamping.

- **Solvency:** A global range alone does not establish
  `abs(settlementPrice - entryPrice) <= DeltaP_max`. To get a finite bound
  from it, entries must also be restricted to a known interval. If both
  entry and settlement are in `[P_min, P_max]`, their absolute difference
  is at most `P_max - P_min`; that range width, not either boundary alone,
  is the relevant bound. Current opening execution uses `ammTwapPrice` plus
  skew/capacity impact and has no matching global entry-price range in this
  proposal.
- **Closeability:** A bounded mark can still be used immediately, avoiding
  rejection caused by a position-relative test. It remains a transformed
  mark whenever raw price is outside the market range.
- **Fairness and oracle semantics:** A common mark is consistent across
  LONGs, SHORTs, ages, and entries at the same instant. However, it may
  diverge from the canonical TWAP/skew-derived raw price and creates
  artificial PnL at the range boundary. The global range and anchor are
  additional project policy, not specified by current oracle semantics.
- **Attack cost and manipulation incentives:** A rail may cap additional
  mark-based extraction beyond the boundary, but manipulation to the rail
  can remain profitable. The external AMM experiment cost must be compared
  to extraction under the range rule; its existing output does not decide
  a suitable range.
- **Complexity:** Requires defining the range, its anchor, updates over time,
  treatment of opening executions outside the range, and how raw versus
  effective prices feed marking, close, and liquidation. No such policy is
  present in the paper/repository framing.

**LONG/SHORT and unfavorable cases:** A shared bounded price treats both
sides symmetrically at a given mark. Whether that caps favorable price
movement depends on entry: LONG entries near the low end can still gain
almost the full range width, and SHORT entries near the high end can do
likewise. Without bounded entry prices, the per-position liability proof
does not follow.

### Option D — pause or delay settlement

Rule: do not settle while raw price is out of the position's allowed band;
retry when it returns.

- **Solvency:** Avoids paying the current out-of-bound mark, but outstanding
  positions and their unrealized exposure remain. A delay does not prove
  eventual return inside the band or cap the eventual settlement.
- **Closeability:** The trader cannot close during the delay. This conflicts
  with closeability at every step and creates time-dependent exposure after
  the trader has requested exit.
- **Liquidation:** A delayed voluntary close does not resolve liquidation.
  Delaying liquidation can leave unhealthy positions open; allowing
  liquidation during the pause reintroduces the boundary question.
- **Liveness and griefing:** A persistent market move or manipulated TWAP
  can extend the delay indefinitely. If any actor can keep the mark outside
  the range, they can create a close-denial opportunity.
- **Oracle manipulation:** Waiting for a manipulated price to normalize
  makes settlement depend on future oracle behavior and introduces a timing
  option. There is no existing recovery guarantee or timeout rule.

**LONG/SHORT and favorable/unfavorable cases:** A symmetric absolute
boundary delays both sides in both directions. If only favorable movement
triggers a delay, a profitable trader can be prevented from closing while
an adverse move is treated differently; this is asymmetric and remains
unspecified.

### Option E — liquidation or forced settlement outside the boundary

An out-of-bound price is not itself a liquidation rule. Liquidation in the
current model is based on a position's equity/margin ratio at a mark.

- **Use raw price for forced settlement:** Liquidation can close a position,
  but PnL can exceed the proposed movement bound. This restores neither the
  solvency guarantee nor the price-bound premise.
- **Use a clamped price for forced settlement:** This inherits Option B or
  C's effective-price semantics. If the clamp changes margin health, the
  liquidation decision and the settlement may disagree unless both use
  exactly the same effective price.
- **Liquidate solely because the raw mark is out of range:** This turns an
  oracle-bound breach into forced closure, even if the position is
  otherwise healthy. An attacker who can push the mark across the boundary
  may be able to force liquidations; this is a new manipulation surface,
  not a demonstrated resistance mechanism.
- **Reject or delay liquidation:** This inherits the stuck-position and
  liveness problems of Options A and D.

No liquidation penalty, reward, insurance, or new incentive is assumed here.

**LONG/SHORT and unfavorable cases:** A margin-based liquidation check can
trigger either side depending on the mark and position equity, but
liquidating on boundary crossing alone is not inherently side-neutral once
the boundary is entry-relative. Any liquidation and forced-settlement rule
must specify the exact same raw/effective price used for margin and final
PnL.

## 4. Multi-position solvency

The movement constraint is per position because positions can have different
entry prices, ages, and settlement times. A per-position favorable cap
would preserve the simple aggregate upper bound even when entries differ:

```text
for every open position i:
    max(PnL_i, 0) <= size_i * DeltaP_max

therefore:
    sum(max(PnL_i, 0))
        <= DeltaP_max * sum(size_i)
```

If the market's `totalOI = longOI + shortOI` is a complete sum of all open
position sizes and remains at most `maxCapacity`, then:

```text
sum(max(PnL_i, 0))
    <= DeltaP_max * totalOI
    <= DeltaP_max * maxCapacity
```

The bound does not require all longs to share an entry, all shorts to share
an entry, or positions to have the same age. It holds across mixed sides
because it sums positive PnL per position and budgets the full size of every
position. Settlement at different times does not invalidate this
instantaneous worst-case bound if backing is measured consistently and
remaining open liabilities are still reserved.

It is not enough to compute one market-wide price cap and assume all entries
fall within it. Nor does a per-position cap prove that available backing is
reserved against *all* open positions or that capacity is reduced when
backing falls. These accounting/enforcement obligations remain necessary
for a formal solvency claim.

There is also a price-snapshot question for positions settled one after
another. The proposed `getCurrentAmmPrice` depends on current skew, and
closing a position changes OI/skew. If raw price is recomputed after every
close, otherwise identical requests in the same market step can receive
different raw marks based on settlement order. A protocol using this source
must define whether one market-step raw mark is snapshotted for all
settlements or each close uses the state immediately before its own OI
release. The repository and frozen proposal do not define this timing rule.
An entry-relative cap can preserve its per-position liability bound under
either choice, but the choice affects fairness and reproducibility.

## 5. Oracle manipulation and product requirement

Suppose an attacker moves `ammTwapPrice` far enough that
`getCurrentAmmPrice(market, config)` lies outside a position's entry-relative
band:

| Behavior | Extraction effect | Closeability effect | Manipulation / denial-of-service surface |
|---|---|---|---|
| Reject (A) | No immediate payout; profit is deferred, not necessarily prevented | Out-of-band trader cannot settle now | Attacker may keep mark outside and deny closes/liquidations |
| Per-position clamp (B) | Caps the specified favorable payout for each position; does not necessarily cap round-trip profit or other positions | Immediate settlement at an effective, position-specific price | The rail may be targeted; raw oracle still moves and can affect other risks |
| Market-wide range (C) | Caps the shared mark, conditional on a bounded entry range | Immediate settlement at an effective common mark | Reaching the rail can still extract up to it; range/anchor manipulation and policy risks remain |
| Delay (D) | Defers extraction and may expose trader to later price changes; does not prove it is prevented | Close is unavailable until recovery | Persistent manipulation can prolong close denial |
| Forced liquidation (E) | Raw settlement can exceed the cap; clamped settlement inherits B/C | Can close mechanically if a settlement price is defined | A boundary-triggered liquidation can itself be induced by moving the oracle |

“Every trader can close at every step” is treated here as a required product
property from the checkpoint prompt. It is stronger than allowing a close
request to be submitted: it requires the protocol to have deterministic,
completable settlement semantics at each step. Option A and D fail this
property in the out-of-bound case. Option E only preserves it if its forced
settlement rule resolves the same raw/effective-price conflict. Option B or C
can complete a close immediately, but only by defining a transformed price
and accepting its fairness and oracle-semantics consequences.

The repository's closeability tests cover releasing OI and removing
positions under selected market/capacity states. They do not establish
closeability under a solvency movement boundary, nor does the current close
path compute the proposed canonical settlement mark itself.

## 6. Solvency bound is not an oracle movement bound

The established conditional implication is:

```text
IF each effective settlement price is within DeltaP_max
   of that position's entry
AND total open position size <= maxCapacity
THEN maximum aggregate positive PnL
     <= DeltaP_max * maxCapacity
```

It does not establish:

```text
abs(rawSettlementPrice - entryPrice) <= DeltaP_max
```

`getCurrentAmmPrice` derives a price; neither that derivation nor the
external constant-product attack-cost experiments enforce a maximum
entry-to-settlement movement. A policy for out-of-bound raw marks must be
selected and implemented before the conditional solvency inequality
describes actual reachable settlement behavior.

## 7. Comparison and recommendation

Qualitative comparison for the proposed out-of-bound case:

| Option | Solvency | Closeability | Manipulation resistance | Fairness | Complexity | All Perps compatibility |
|---|---|---|---|---|---|---|
| A. Reject settlement | Prevents immediate over-bound payout only; liability remains | **Fails** until the mark returns | Does not prevent manipulation; creates close-denial/DoS risk | Raw price preserved, but profitable close can be blocked | Low implementation, high unresolved liveness burden | Conflicts with “every trader can close at every step” |
| B. Per-position clamp | Caps favorable PnL per position; aggregate bound is conditional on full OI accounting | Immediate close can complete | Caps additional favorable extraction for a position beyond its rail, but does not prevent raw manipulation | Position-specific effective marks; artificial/truncated PnL; favorable-only formula is asymmetric against adverse moves | Medium; must distinguish raw/effective marks across close and liquidation | Preserves immediate mechanics, but weak fit with a shared market mark and requires a project payout rule |
| C. Market-wide bounded mark | Can bound liability only if opening entries also lie in a compatible finite range | Immediate close can complete | Caps mark beyond a rail, not the cost of reaching it | Shared price is more consistent, but differs from raw oracle and depends on arbitrary range/anchor | High; requires range, anchor, entry bounds, and consistent use across paths | Potential fit with closeability, but adds a market-price policy not currently specified |
| D. Pause/delay | Defers payment; no eventual solvency proof | **Fails** while delayed | Can turn persistent manipulation into persistent close denial | Settlement depends on uncertain future price path | Medium; requires timeout/recovery semantics to be meaningful | Poor fit with immediate closeability and long-tail markets |
| E. Forced liquidation | Raw price may violate solvency; clamped price inherits B/C | Can close only if forced settlement has defined pricing | Boundary-triggered liquidation can be induced; margin-based liquidation alone does not cap PnL | Forced closure at an artificial or extreme price may harm either side | High if it introduces a new trigger; otherwise inherits selected policy | Not a standalone answer; no current paper/repo rule authorizes it |

**Recommendation: do not select a boundary mechanism at this checkpoint.**
No option among the stated choices simultaneously preserves the raw
canonical oracle semantics, a hard liability bound, and immediate closeability
without adding an unchosen price transformation or an unproven recovery rule.
Option B is the smallest direct way to cap favorable settlement liability
while allowing an immediate close, but it changes settlement semantics to a
per-position synthetic price. Selecting it would be a substantive
**PROJECT ASSUMPTION**, not a neutral implementation of the oracle or a
paper-supported rule. Option C has more conventional shared-mark semantics,
but needs bounded opening fills and a market-wide range that are not defined.

The next protocol decision must choose which invariant has priority when the
raw mark lies outside the movement band and explicitly define the raw/effective
price relationship for voluntary close, marking, and liquidation. It must
also decide whether the product permits any exception to close-at-every-step.
Until then, do not claim that the bound is enforced or that the product
requirement and solvency proof are jointly satisfied.

## Final decision

- **Raw settlement source (proposed):** `getCurrentAmmPrice(market, config)`.
- **Effective settlement price:** equal to raw only while in boundary;
  undefined outside it because no behavior is selected.
- **Boundary condition (proposed):**
  `abs(rawSettlementPrice - entryPrice) <= DeltaP_max`.
- **Behavior outside boundary:** unresolved; reject, clamp, delay, and forced
  settlement have materially different properties.
- **Closeability:** not guaranteed by the proposed boundary. Reject/delay
  block completion; clamp or forced settlement requires selecting a
  transformed-price policy.
- **Solvency:** the liability inequality remains conditional until the
  protocol guarantees that every completed settlement uses a price with
  bounded favorable movement and reserves backing against all open OI.
- **Classification:** the entry and settlement sources and `DeltaP_max` are
  **PROJECT ASSUMPTIONS**; no numerical movement boundary or out-of-bound
  settlement behavior is **PAPER-SUPPORTED** in the repository's research
  materials.

```text
SETTLEMENT BOUNDARY STATUS:
UNRESOLVED
```

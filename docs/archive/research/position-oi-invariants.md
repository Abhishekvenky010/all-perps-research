# Position and Open-Interest Invariants

> Historical pre-implementation audit. Its findings describe the baseline
> before checkpoint 1; see the implementation update at the end for the
> current position/OI lifecycle behavior.

## Conclusion

The repository does **not** guarantee a mathematically consistent
relationship between every open position and market-level OI across every
available state transition. The canonical `simulateTrade` path stages OI
changes in a copy and commits after all trade steps succeed, and the normal
close path releases the stored position's side and size after validation.
Those are useful local guarantees. They do not establish the global identity
because:

- `PositionManager.openPosition` can insert or overwrite a position without
  changing OI, and `PositionManager.closePosition` can remove one without
  changing OI;
- market OI fields are publicly mutable and are not reconciled against
  positions;
- duplicate position IDs overwrite map entries while canonical open has
  already included both sizes in market OI;
- close/liquidation settlement wrappers update vault PnL before releasing
  OI, so an OI-release failure leaves a partial state transition;
- the capacity gate reads only market OI, not the position ledger, and its
  tolerance allows a small amount above the configured maximum; and
- trade/position inputs are not validated for positive size, positive
  integral step count, unique IDs, or consistent initial market state.

This is a repository behavior audit, not a statement of paper requirements.
No position/OI accounting formula or these exact APIs are attributed to the
paper. The prior settlement-boundary question remains unresolved and is not
changed here.

## 1. Canonical accounting identity and scope

For a market identified by symbol `m`, the desired identity is:

```text
longOI(m) =
  sum(position.size for each open position where
      position.market == m and position.side == LONG)

shortOI(m) =
  sum(position.size for each open position where
      position.market == m and position.side == SHORT)

totalOI(m) = longOI(m) + shortOI(m)
totalOI(m) <= maxCapacity(m)
```

The sum must be market-scoped. `PositionManager.getAllPositions()` is a
single unpartitioned map and can contain positions from multiple markets;
summing all its records and comparing that sum with one `MarketState` would
be incorrect. The repository has no central reconciler that filters by
market and asserts the identity.

`MarketState` stores only `longOpenInterest` and `shortOpenInterest`.
`getTotalOpenInterest` derives their sum; there is no independently stored
`totalOI`. The desired identity between those counters and the position
ledger is not maintained by a shared ledger primitive or invariant check.

### Source-level mutation inventory

Within `src/`, the canonical position/OI mutation sites are:

| Operation | Function(s) | State effect |
|---|---|---|
| Open through trade flow | [`simulateTrade`](../../src/simulation/TradeSimulator.ts), private `applyExposure` | Adds each step to a working copy's side OI; then commits market state and stores one position |
| Direct position insertion | [`PositionManager.openPosition`](../../src/position/PositionManager.ts) | Inserts into the map by ID; does not touch market OI or validate uniqueness, market, side, size, or capacity |
| Direct position removal | [`PositionManager.closePosition`](../../src/position/PositionManager.ts) | Deletes by ID; does not touch market OI |
| Direct position mutation | `getPosition`, `getPositionsByTrader`, and `getAllPositions` return references to stored mutable `Position` objects | Callers can mutate size, side, or market without changing OI |
| Close and release OI | [`closePosition`](../../src/position/ClosePosition.ts) | Looks up stored position, validates market and sufficient same-side OI, subtracts its size, then removes its ID from the manager |
| Voluntary financial close | [`settleAndClosePosition`](../../src/settlement/SettleAndClosePosition.ts) | Calculates PnL, records it in vault, then invokes `closePosition` |
| Bare liquidation | [`liquidatePosition`](../../src/risk/LiquidationEngine.ts) | Marks the passed position, then invokes `closePosition`; this path does not record PnL in the vault |
| Financial liquidation | [`settleAndLiquidatePosition`](../../src/settlement/SettleAndLiquidatePosition.ts) | Looks up stored position, marks it, records PnL, then invokes `closePosition` |
| Direct state edits | `MarketState` fields and `Position` objects are mutable public data | Callers/tests can write OI or insert/remove/change positions independently |

No partial-close function exists in `src/`. The close paths remove the entire
stored position and release its entire stored `size`.

Experiments and tests also directly seed or mutate OI/positions. Those are
fixtures or simulations rather than additional production APIs, but they
demonstrate that the model does not enforce identity at object boundaries.

## 2. Opening lifecycle

The canonical path in `simulateTrade` is:

```text
request arguments
  -> construct temporary position and check leverage
  -> shallow-copy MarketState
  -> repeat for each step:
       check capacity against working OI
       calculate average execution price
       add step exposure to working OI
  -> construct Position with total simulated size and generated ID
  -> Object.assign original market from working state
  -> PositionManager.openPosition(position)
```

### Normal valid-input behavior

For finite positive `size`, positive integer `steps`, a consistent initial
market, a valid capacity configuration, and a fresh position ID:

- each step adds `size / steps` to exactly one OI side;
- the same step amounts are included in `totalSize`;
- any capacity or pricing error before the commit leaves the original
  `MarketState` unchanged;
- after all steps, the method commits OI and then synchronously inserts the
  resulting position.

Thus the **trade-step loop** is all-or-nothing with respect to failures thrown
before the commit. Tests in
[`capacityBoundary.test.ts`](../../tests/capacityBoundary.test.ts) cover exact
capacity, over-capacity rejection, failure partway through a multi-step
trade, and unchanged state on those failures.

### Commit ordering and position creation

The final commit order is:

```text
Object.assign(state, workingState)
positionManager.openPosition(position)
```

The map insertion normally does not throw for the built-in `PositionManager`,
but there is no rollback if it does throw (for example, if a caller supplies
a subclass overriding the method). More importantly, `openPosition` uses
`Map.set` without rejecting an existing ID. A duplicate ID therefore
silently replaces an existing record after market OI has already increased.
That operation returns success but leaves OI including both positions while
the manager contains only the newest record.

The default ID generator uses a module-level counter, which generates
increasing `position-N` values during a single module instance. It is not a
uniqueness guarantee across the public manager API: callers can manually
insert the next generated string first. For example, a caller can register
`position-1`, then the first `simulateTrade` generates `position-1` and
overwrites that ledger record.

The position records themselves are also mutable and are exposed by
reference. A caller can change a stored position's `size`, `side`, or
`market` through `getPosition`, `getPositionsByTrader`, `getAllPositions`,
or the `position` returned by `simulateTrade`, without updating any market
counter. This is a further direct path to break the identity, independent
of insertion or deletion.

### Invalid input and malformed starting state

`simulateTrade` does not validate that `size` is finite and strictly
positive or that `steps` is a positive integer:

- A negative size with positive margin can pass the leverage comparison;
  negative step exposure can reduce OI and create a negative-size position.
- A zero size with positive margin can create a zero-size position without
  changing OI.
- With zero or negative `steps`, the loop does not execute; the code then
  computes `0 / 0` for average price, commits an unchanged state, and opens
  a zero-size position with a non-finite entry price.
- A non-integral positive `steps` value is accepted by the `i < steps` loop;
  it executes `ceil(steps)` iterations, each of size `size / steps`, so the
  actual total size can exceed the requested size. Capacity checks still
  apply to each executed step, but the API contract is not the expected
  number of steps.

The capacity helper also trusts the supplied market counters and config.
It does not reject stale, negative, non-finite, or already-over-capacity
OI as a separate invariant. These cases are outside a disciplined
valid-input call, but the exported APIs do not enforce that discipline.

## 3. Voluntary close lifecycle

`settleAndClosePosition` performs:

```text
lookup position by ID
  -> validate its market symbol
  -> calculate PnL at caller-supplied currentPrice
  -> record PnL in vault
  -> closePosition:
       lookup stored position again
       validate market symbol
       validate same-side OI >= stored size
       subtract stored size from that side's OI
       delete ID from PositionManager
```

The movement from market OI is selected by the stored position's `side`.
There is no caller-provided close side and no partial amount. Under normal
finite positive-size state, a successful `closePosition` therefore executes:

```text
LONG:  longOI'  = longOI  - storedPosition.size
       shortOI' = shortOI

SHORT: shortOI' = shortOI - storedPosition.size
       longOI'  = longOI
```

The sufficient-OI check prevents a negative result for ordinary finite,
positive sizes. Wrong-market and missing-position errors occur before OI
mutation; repeating a successful close fails at lookup and does not subtract
again. Existing tests cover those cases and exact release for ordinary
positions.

However, the financial close is not atomic across the vault and market/ledger:
`recordTraderPnL` runs before `closePosition`. If same-side OI is insufficient
or the market is wrong at the second validation, `closePosition` throws
after the vault PnL has changed. The position and OI remain, while its PnL
has already been booked. This is a reachable failure with corrupted or
stale OI and violates failure-unchanged semantics for the overall operation.

`PositionManager.closePosition` returns `undefined` rather than throwing when
the ID is absent, and `closePosition` ignores that return value. In the
standard synchronous implementation the ID was just found, so deletion
normally succeeds. There is no transaction/rollback if a substituted
manager implementation throws or reports a missing entry after OI was
subtracted.

Direct calls to `PositionManager.closePosition` remove a record without
releasing OI. Direct calls to `closePosition` release OI and remove the
record but do not settle PnL. These APIs allow distinct state transitions;
no single enforced lifecycle requires settlement and OI/ledger mutation to
commit together.

## 4. Liquidation lifecycle

### Bare `liquidatePosition`

The lower-level function accepts a `Position` object, not just an ID:

```text
mark the supplied Position at currentPrice
  -> reject if not liquidatable
  -> closePosition(position.id, market, positionManager)
       -> use the stored manager position for market/OI release/removal
  -> return fields, some taken from the supplied object
```

It does not book PnL in a vault. A mark failure or healthy-position error
happens before state mutation. OI release follows `closePosition`'s stored
record, but the liquidation decision and returned trader/size/PnL use the
caller-supplied object. A mismatched object with a live ID can therefore be
marked/declared liquidatable differently from the registered position; if
the close then succeeds, it removes the registered record and subtracts its
stored side/size, while the result can report the supplied object's size.
The entry point does not itself verify that the supplied object equals the
manager's canonical object.

### `settleAndLiquidatePosition`

The financial wrapper does a manager lookup and market check first, marks
that registered position, rejects a healthy position before mutation, then
records PnL in the vault before calling `closePosition`. It has the same
partial-commit risk as voluntary financial close: if OI release fails after
PnL booking, the call throws but vault state has changed and the position
remains open.

Repeated liquidation after a successful close finds no managed position in
the wrapper and fails before mutation. In the lower-level function, a stale
position object may pass its mark check, but `closePosition` fails lookup
before changing OI.

For well-formed positive sizes and consistent state, liquidation releases
the same registered side and size as voluntary close. It has no independent
OI mutation formula. No liquidation penalty or incentive is added or
assumed.

## 5. Capacity invariant

`canIncreaseExposure` calculates:

```text
newExposure = longOI + shortOI + requestedStepSize
```

and returns true when:

```text
newExposure <= maxCapacity + abs(maxCapacity) * 1e-9
```

It reads only the market counters. It does not calculate the sum of
positions, validate initial OI, or repair divergence.

| Scenario | Repository behavior and conclusion |
|---|---|
| Open exactly to capacity | Accepted by design; tests exercise inclusive capacity. |
| Open one unit above capacity | Rejected in tested normal states. |
| Open in multiple sequential trades | Each trade checks each step against current OI; capacity is preserved if starting OI is valid, inputs are valid, and IDs do not corrupt the ledger. |
| Final step fails | `simulateTrade` has only changed `workingState`; original OI and manager remain unchanged. Tests exercise this case. |
| Close then open | A successful close subtracts its registered size, which permits a later open to consume released capacity. No combined transaction links them. |
| Liquidate then open | A successful liquidation's `closePosition` releases registered size. The financial wrapper can partially book vault PnL if that release fails. |
| Stale/corrupt OI | Capacity uses the stale value as truth. It may reject legitimate capacity or accept exposure from negative OI; no reconciliation exists. |
| Position sum differs from OI | Capacity continues to use OI only. It neither detects nor corrects missing/extra positions. |
| Tolerance boundary | The check allows `totalOI` up to `maxCapacity + relative tolerance`; therefore the strict invariant `totalOI <= maxCapacity` is not literally guaranteed for all accepted floating-point states. |

The final tolerance exists to absorb floating-point accumulation around
capacity. It makes the implementation's accepted limit slightly greater
than `maxCapacity`; it is not a proof of a strict mathematical inequality.
Tests pin exact-fill acceptance and selected over-capacity rejection, not
the absence of every tolerance-sized excess.

**Capacity-gate correctness** is conditional on the counters and inputs
being valid. **Position/OI correctness** is a separate invariant and is not
validated by the gate.

## 6. Position/OI conservation equations

For a canonical successful open of positive size `S` and valid steps, each
step increases exactly one OI side and contributes to the created
position's total size. Algebraically:

```text
open LONG S:
    longOI'  = longOI + S
    shortOI' = shortOI

open SHORT S:
    shortOI' = shortOI + S
    longOI'  = longOI
```

This holds for the staged numeric market state, subject to floating-point
rounding, but the resulting global ledger identity additionally requires a
fresh ID and a previously consistent state.

For a successful close of registered position size `S`:

```text
close LONG S:
    longOI'  = longOI - S
    shortOI' = shortOI

close SHORT S:
    shortOI' = shortOI - S
    longOI'  = longOI
```

The subtraction is exact as an operation on the stored `Number` values
only in the ordinary arithmetic sense; IEEE-754 rounding can affect the
result. More importantly, direct manager edits, duplicate IDs, malformed
sizes, and prior OI corruption invalidate the premise that the counter is
the sum of all registered sizes.

## 7. Position identity and orphan state

`PositionManager` stores positions in `Map<string, Position>`:

- `openPosition` is an unconditional `Map.set`. A repeated ID replaces the
  previous value; it is not rejected and does not return the displaced
  position.
- `getPosition` looks up only by ID, not by market or trader.
- `closePosition` deletes by ID and returns the prior record, or
  `undefined` if absent.
- `getAllPositions` enumerates current map values.

The generator in [`PositionId.ts`](../../src/position/PositionId.ts) is a
module-local incrementing counter. It provides distinct generated IDs while
used serially in one loaded module, but the manager does not enforce
uniqueness against explicit IDs, imported state, or IDs restored from
persistence. A second loaded module instance or a process restart also
resets the module-local counter. Therefore IDs are not globally guaranteed
unique.

Concrete divergence cases:

1. **Orphan OI after overwrite:** manually store ID `position-1`, then call
   the first canonical trade. Its generated `position-1` overwrites the
   manual position while OI includes both sizes.
2. **Orphan position without OI:** call `PositionManager.openPosition`
   directly. The map changes and market counters do not.
3. **Orphan OI without position:** mutate a market counter directly or call
   `PositionManager.closePosition` directly. OI is unchanged by manager
   removal.
4. **Cross-market collision:** if the manager contains the same explicit ID
   from another market, `Map.set` replaces it. The market that previously
   counted that position can retain its OI with no corresponding record.
5. **Reference mutation:** change a stored position's side, market, or size
   through a returned object reference. The manager now reports the changed
   record while market OI remains as before.

The individual close function validates that the stored position's market
matches the supplied market symbol. That check protects this close operation
from releasing OI on the wrong market object, but it does not provide
market-scoped storage or global reconciliation.

## 8. Multi-position ordering and settlement-price interaction

With distinct IDs and a consistent starting ledger, closing LONG A, LONG B,
SHORT C, and SHORT D in any order subtracts each stored position's same-side
size. The final counters are order-independent under ordinary arithmetic:

```text
longOI_final  = longOI_initial - size(A) - size(B)
shortOI_final = shortOI_initial - size(C) - size(D)
```

Interleaving valid opens and closes likewise preserves the ledger identity
if every operation uses the canonical paths and succeeds. This is a
conditional conservation argument, not a repository-wide guarantee:
duplicate IDs, direct manager mutation, direct OI writes, failed
cross-object settlement, or invalid sizes break its premises.

Accounting changes and settlement-price outcomes are separate concerns.
The production close and liquidation operations snapshot the canonical
`getSettlementPrice` result while the position is still OPEN and before its
OI is released. Thus a position's own close cannot change its settlement
price. There is no production batch-close operation; whether a future batch
should use one shared snapshot or one snapshot per position remains out of
scope.

## 9. Failed-operation atomicity

| Operation | Expected failure behavior | Actual behavior |
|---|---|---|
| Open: leverage rejection | Market OI and position ledger unchanged | Leverage check precedes state copy/commit; unchanged |
| Open: capacity/pricing failure at any step | Market OI and position ledger unchanged | OI is staged in `workingState`; tests cover capacity failure partway through |
| Open: position registration after OI commit | Either both OI and position commit, or neither | OI is committed before `openPosition`; no rollback if registration throws. Duplicate ID silently overwrites instead of failing |
| Direct manager open | Market OI should match new position | Manager mutates only its map; OI is untouched |
| Close: missing ID / wrong market / insufficient same-side OI | Vault, OI, and positions unchanged | Direct OI/position close validates before OI subtraction. Financial close has already recorded PnL before the second-stage close can fail |
| Close: manager deletion after OI subtraction | Either both OI and position commit, or neither | Standard manager deletion succeeds for the synchronously fetched ID; no rollback/return validation if deletion is substituted or fails |
| Liquidation: mark invalid / healthy position | Vault, OI, and positions unchanged | Mark/eligibility check precedes mutation |
| Bare liquidation: close fails | OI and positions unchanged | Close's missing/wrong-market/insufficient-OI checks precede OI mutation |
| Financial liquidation: OI release fails | Vault, OI, and positions unchanged | Vault PnL is booked before `closePosition`; OI/position remain if close then fails |
| Direct manager close | OI should be released with position | Manager deletes only its map entry; can create orphan OI |

The staged multi-step opening path is the strongest atomicity property in
the implementation. It does not make the final two-object commit atomic.
Financial close and liquidation are explicitly ordered as vault mutation
followed by position/OI mutation, and there is no rollback transaction.

## 10. Invariant status table

Statuses describe guarantees over the exposed repository APIs, not only
selected happy-path tests. `PROVEN` means the property follows from the
implementation under its stated domain; tests alone are not used as proof.

| Invariant | Current status | Evidence / reason | Risk |
|---|---|---|---|
| `longOI = sum(size of all open LONG positions)` | **VIOLATED** | Direct `PositionManager.openPosition` does not touch OI; duplicate IDs overwrite existing positions after canonical OI commit; direct market mutation is possible | Capacity and liability calculations can omit or invent long exposure |
| `shortOI = sum(size of all open SHORT positions)` | **VIOLATED** | Same independent mutation and ID-overwrite paths apply to SHORT positions | Capacity and liability calculations can omit or invent short exposure |
| `totalOI = longOI + shortOI` | **PROVEN** | `getTotalOpenInterest` returns this arithmetic sum; no separate stored total exists | Only a derived identity; invalid numeric values can still make the sum non-finite |
| `totalOI <= maxCapacity` | **VIOLATED** | Capacity comparison allows a configured relative tolerance above max; OI is directly mutable and can start stale/over limit | Market can exceed nominal configured capacity or admit trades against corrupted counters |
| Failed open is atomic | **PARTIALLY PROVEN** | Leverage/capacity/pricing errors before commit leave state unchanged; final market commit precedes manager registration and has no rollback | A registration failure can leave committed OI; duplicate IDs silently corrupt ledger identity |
| Failed close is atomic | **VIOLATED** | `settleAndClosePosition` books vault PnL before OI validation/release can throw | Vault and outstanding positions disagree after a failed operation |
| Failed liquidation is atomic | **VIOLATED** | `settleAndLiquidatePosition` books PnL before close/OI release; lower-level liquidation only atomically covers its narrower close path | Vault can book liquidation PnL while position and OI remain |
| Close releases exact OI | **PARTIALLY PROVEN** | `closePosition` subtracts the registered position's entire size from its side after market and sufficiency checks; no partial close; full identity still bypassable and arithmetic is floating point | Only reliable for valid positive positions and consistent counters |
| Liquidation releases exact OI | **PARTIALLY PROVEN** | Both liquidation paths delegate release to `closePosition`; bare path marks caller-supplied object and can report fields not matching registered record | Eligibility/result can refer to a different object than the position actually removed |
| No negative OI | **VIOLATED** | No positive-size validation; negative-size trade can reduce OI below zero, and OI fields are directly mutable | Invalid exposure corrupts capacity, skew, and close checks |
| Position IDs unique | **VIOLATED** | `Map.set` replaces duplicate IDs; generated counter is not checked against explicit/restored IDs | Lost position records and orphaned OI, including cross-market collisions |
| No orphan positions | **VIOLATED** | Direct manager insertion creates positions without OI; zero-step trades can create a zero-size position with non-finite entry price | Position ledger does not represent valid market exposure consistently |
| No orphan OI | **VIOLATED** | Direct OI writes and manager removal bypass OI release; duplicate overwrite leaves the displaced size counted | Capacity and skew can reflect nonexistent positions |

`tests/positionOiConsistency.test.ts` demonstrates equality for a small,
manually synchronized fixture and one close/liquidation sequence. Its setup
inserts records directly and separately writes OI, so it does not establish
that normal opening maintains the identity, nor does it test ID collisions,
malformed inputs, failure after vault mutation, or arbitrary operation order.
Other relevant evidence includes
[`capacityBoundary.test.ts`](../../tests/capacityBoundary.test.ts),
[`closeability.test.ts`](../../tests/closeability.test.ts),
[`closePosition.test.ts`](../../tests/closePosition.test.ts),
[`settleAndClosePosition.test.ts`](../../tests/settleAndClosePosition.test.ts),
and [`settleAndLiquidatePosition.test.ts`](../../tests/settleAndLiquidatePosition.test.ts).
These tests cover selected paths; they do not prove the global invariants.

## 11. Minimum unresolved protocol decisions

Before implementation can claim a position/OI invariant, decide:

1. **Canonical ownership and scope:** Is `PositionManager` the authoritative
   position ledger, and is it one ledger per market or a shared ledger
   reconciled by market symbol?
2. **Allowed mutations:** Are direct manager and direct `MarketState` OI
   mutations permitted, or must all opens/closes/liquidations go through
   lifecycle operations that update both objects?
3. **ID uniqueness:** What identity guarantee must hold across explicit
   IDs, generated IDs, process restarts, and multiple markets?
4. **Input domain:** Must size be finite and strictly positive, and must step
   count be a positive integer? The exact tolerated floating-point capacity
   boundary must also be defined if the protocol invariant is strict.
5. **Atomic transition semantics:** Must vault PnL, OI, and position
   insertion/removal commit as one operation, with all validation completed
   before any state mutation?
6. **Liquidation identity:** Must liquidation resolve the canonical managed
   position by ID before computing margin eligibility and reporting results?
7. **Price snapshot ordering:** Does a market step use one price snapshot
   for every close/liquidation, or is the raw mark recomputed after each
   OI/skew mutation? This is recorded as unresolved only; the settlement
   boundary decision is not revisited.

## Final conclusion

The canonical open loop has a staged-OI guarantee for failures before its
commit, and the canonical OI-release helper subtracts the registered
position's side and size in ordinary valid state. But the exposed APIs do
not preserve the global ledger identity or failure atomicity across all
reachable paths. The invariant set is therefore **violated**, not merely
untested: duplicate IDs and direct manager/OI mutation provide concrete
counterexamples.

```text
POSITION/OI STATUS: VIOLATED
```

## Checkpoint 1 implementation update

Checkpoint 1 implements the requested position/OI lifecycle contract:

- `PositionManager` snapshots and freezes positions, rejects duplicate IDs,
  validates positive finite size/entry price/margin, and requires the market
  state for every open or close transition.
- OI reconciliation is scoped by market symbol and checked before each
  transition. Opens insert the immutable position and derive both counters
  from the resulting open ledger; closes validate sufficient OI, terminalize
  the canonical position, and derive the remaining counter from the ledger.
- Trade simulation requires a finite positive size and positive integer step
  count. Capacity checks use exact `<= maxCapacity` comparisons without a
  floating-point tolerance.
- Terminal lifecycle values are `SETTLED` and `LIQUIDATED`; only OPEN records
  are returned by active-position queries and included in OI.
- Financial close/liquidation validates OI release and the vault PnL update
  before committing either state change.
- `tests/positionOiConsistency.test.ts` reconciles calculated ledger OI
  against market counters across open, close, and liquidation transitions.

Validation: `npx vitest run` passed all 227 tests; TypeScript type-check and
the targeted position, OI, capacity, failed-trade, close, liquidation, and
settlement test selection also passed.

## Checkpoint 2 settlement atomicity update

Financial position settlement is now performed only through
`settleAndClosePosition` or `settleAndLiquidatePosition`. The lower-level
`calculatePositionSettlement` helper is pure, and `settlePosition` no longer
books vault PnL independently of a position transition. The `closePosition`
entry point delegates to the canonical voluntary-settlement operation.

Both canonical operations calculate settlement first, prepare a vault PnL
update on validated values, and prepare the manager close (including OI and
field-mutability checks) before committing. The manager commits terminal
lifecycle, exact OI release, and the prevalidated vault accounting in one
synchronous commit method. Duplicate and missing IDs, invalid settlement calculations,
liquidation eligibility failures, OI mismatches, unwritable vault state, and
failed lifecycle commits do not update vault or position state.

Bare `liquidatePosition` and liquidation sweeps now require the vault and
delegate each close to the same atomic liquidation-settlement operation.
Terminal lifecycle state prevents a second settlement. The settlement result
includes the canonical position fields, settlement price, PnL, claim/margin,
and final lifecycle.

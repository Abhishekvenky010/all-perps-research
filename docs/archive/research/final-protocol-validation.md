# Final Protocol Validation

## 1. Protocol scope

This is a validation of the repository's off-chain TypeScript prototype
against the lifecycle and accounting invariants currently specified in the
project. It is not a formal proof, deployed-contract review, or production
readiness certification. Production-path means the current canonical
TypeScript path, not a deployed service or authenticated transaction boundary.

The final adversarial suite is
[`protocolFinalInvariants.test.ts`](../../tests/protocolFinalInvariants.test.ts).
It supplements the existing capacity, position/OI, settlement-atomicity,
oracle/TWAP, liquidation, and vault-solvency suites rather than replacing
them. The new suite has 21 tests; the final full run covered 57 test files.

## 2. Implemented invariants

- Position records are copied and frozen on insertion. Stored core fields
  cannot be changed through the caller's original object or the manager's
  returned view.
- Manager opens and closes reconcile market OI from OPEN positions. Duplicate
  IDs are rejected, terminal IDs cannot be reopened, and a close releases the
  stored position's exact size and side.
- The supported trade-entry path rejects capacity overflow using an exact
  `<= maxCapacity` comparison; equality is accepted.
- A failed open now validates writability of both OI counters before
  inserting a position or changing either counter. This closes a discovered
  partial-mutation case for a market with one read-only OI property.
- Canonical settlement derives its price internally, requires matching
  market/config symbols, and excludes only the target position's OI from a
  copied market state. Close and liquidation use the same helper.
- Settlement PnL and liquidation transition preparation check solvency and
  mutability before commit. Stale prepared vault accounting is rejected.
- Vault deposit and premium APIs reject non-finite values and arithmetic
  overflow before mutation.
- Liquidation remains strict: a margin ratio equal to maintenance margin is
  not liquidatable; only a lower ratio qualifies.

The lower-level `PositionManager.openPosition` retains an optional
`maxCapacity` argument for internal setup/bookkeeping use. Canonical
trade-entry through `simulateTrade` supplies the configured bound. Any
application exposing the lower-level manager directly must supply and enforce
the market capacity; this TypeScript prototype does not provide an external
authorization boundary.

## 3. Lifecycle validation

Tests cover exact OI addition/release, duplicate IDs, exact capacity and
overflow for LONG-heavy, SHORT-heavy, and balanced books, failed-open state
equality, close/liquidation terminal lifecycle, repeated/cross-terminal
settlement rejection, and close ordering for LONG A / LONG B / SHORT C.

Close ordering changes a position's mark when the other still-OPEN positions
change. This is expected under the defined per-position counterfactual rule:
each close prices against the then-current book with only itself excluded.
It is not an accidental sequential mutation before pricing. Liquidation batch
marks instead use the documented batch-start market snapshot.

The close-order tests exercise the current individual close API. A batch of
separate position settlements is a sequence of independently committed
transitions; the prototype does not promise all-or-nothing rollback of an
entire multi-position sweep if a later position cannot settle.

## 4. Oracle validation

The reference pipeline remains:

```text
reference observation
  -> validation
  -> complete 900-second arithmetic TWAP
  -> canonical protocol mark
  -> close/liquidation settlement
```

Tests reject negative, zero, NaN, infinite, future, and backward observations
without changing the previously supplied market or observation array.
Incomplete history does not fabricate a new TWAP. Existing reference-pipeline
tests verify the TWAP-to-mark-to-settlement connection.

The observation provider is still only a `ReferencePriceSource` interface.
Authentication, source aggregation, freshness/outage policy, and external
market integration are not implemented.

## 5. Vault solvency validation

Tests cover profitable settlement exactly equal to available backing,
underfunded settlement rejection with market/position/OI/vault unchanged,
signed loss accounting, zero-PnL accounting, liquidations, invalid vault
inputs, overflow, stale prepared PnL, and frozen-state rejection.

The invariant proven by implementation and tests is limited to the internal
`availableCapital` accounting field for committed operations. No token is
custodied or transferred by this TypeScript prototype, and position margin is
not represented as deposited collateral.

## 6. Economic-security validation

The five previously violating funded self-skew cases (TWAP 95; 600s at 40%
and 50%, 900s at 30%, 40%, and 50%) were rerun through the current production
scenario lifecycle. Each produced zero realized positive extraction; the
positions were liquidated before a profitable close. Their attack costs were
unchanged; with extraction equal to zero, cost/extraction is undefined.
Detailed historical inputs and previous/current results are in
[`07.5-self-skew-production-fix.md`](./07.5-self-skew-production-fix.md).

The current production-path 140-row matrix was also run at both $50,000 and
$10,000,000 backing:

| Backing | Scenarios | Rejected before position | Liquidated | Realized positive extraction | Cost/extraction below 1 |
|---:|---:|---:|---:|---:|---:|
| $50,000 | 140 | 65 | 75 | 0 | 0 |
| $10,000,000 | 140 | 65 | 75 | 0 | 0 |

For the representative 30%-utilization, TWAP-95, 900-second capacity
sensitivity, capacities of 50,000, 100,000, and 200,000 all liquidated before
positive extraction. Each retained the same modeled attack cost of
$197,335.97 and had zero realized extraction.

The legacy analytical `economicSecuritySweep.ts` was run separately: it
reported 343 measurements, of which 196 were unreachable and 147 were
classified LIQUIDATED; none survived. This is not production-lifecycle
evidence: the legacy sweep uses simplified analytical/experimental semantics
and is not combined with realized extraction in the current matrix.

These finite outcomes empirically support elimination of the specific
self-skew extraction in the measured paths. They do not establish the
minimum real attacker cost, a global maximum extraction, or a global
economic-security inequality. Economic security is therefore **UNPROVEN**.

## 7. Adversarial tests

The final suite attacks:

- exact and over-capacity opens in three OI compositions;
- duplicate identity and malformed sizes, prices, margins, steps, and market
  identities;
- market/config mismatch;
- partial-mutability failure before open;
- caller-supplied settlement-price injection;
- explicit simulation-only settlement by price;
- own-skew exclusion for LONG and SHORT sizes from 10% through 50%;
- expected order-dependent marks as live OI changes;
- strict LONG/SHORT liquidation boundaries;
- exact-backed and underfunded settlement;
- repeated close/liquidation and cross-terminal calls;
- invalid oracle observations and incomplete TWAP history;
- a deterministic seeded 100-step lifecycle sequence with OI, capacity, and
  vault reconciliation after each transition, and exact state snapshots after
  expected failed transitions.

`ExperimentalSettlement.settleAndClosePositionAtPriceForSimulation` remains
clearly named and labelled experimental/simulation-only. The production
voluntary-close and liquidation entry points do not accept a settlement
price. Pure calculation helpers may accept a price, but they do not commit a
position or vault transition.

## 8. Randomized/invariant tests

No property-testing dependency was added. The bounded deterministic seeded
sequence in the final suite mixes LONG/SHORT opens, capacity failures, and
closes. After each success it reconciles OPEN positions to both OI counters,
checks `totalOI <= maxCapacity`, and checks nonnegative vault capital. On
expected failed opens it compares the complete market/position/lifecycle/
vault snapshot with the pre-operation state.

This is a finite regression check, not exhaustive state-space exploration.

## 9. Remaining assumptions and limitations

The prototype still lacks:

- an enforced `DeltaP_max` or settlement-movement bound;
- a capital-to-capacity relationship;
- actual token custody and margin collateral transfers;
- LP withdrawal/reserve semantics;
- external reference-source authentication;
- stale-source and outage policy;
- attack-cost enforcement in protocol transitions;
- a formal global economic-security proof or proven global maximum extraction.

`MarketState` and `LiquidityVault` are mutable in-memory TypeScript objects.
Canonical methods guard their own transitions, but this is not a hostile
caller isolation boundary: an application must not expose mutable state
references or low-level methods such as
`PositionManager.prepareClosePosition`, `PositionManager.commitClosePosition`,
or `recordTraderPnL` as unauthenticated endpoints. Those helpers are used by
the internal transaction path, but the TypeScript module boundary does not
prevent a direct caller from bypassing canonical price derivation. The
standalone PnL calculator accepts a price but is not itself a settlement
commit API. Experimental and simulation-only code remains separate from the
canonical close/liquidation path. This is a concrete reason the prototype is
not production-ready without a restricted application boundary or stronger
encapsulation.

Validation was performed with:

```text
npx vitest run
57 test files passed
311 tests passed
0 failed
0 skipped

npx tsc --noEmit
passed

git diff --check
passed
```

## 10. Final classification

| Property | Status | Evidence |
|---|---|---|
| Position/OI conservation | EMPIRICALLY CHECKED | Exact open/close/liquidation deltas, reconciliation tests, and seeded lifecycle test |
| Capacity bound | ENFORCED ON CANONICAL TRADE ENTRY | Exact equality/overflow tests for LONG-heavy, SHORT-heavy, and balanced books; raw manager use must supply a bound |
| Atomic lifecycle | PASS FOR INDIVIDUAL TRANSITIONS | Failed close, liquidation, vault, OI, and open mutation tests preserve snapshots |
| Canonical settlement | PASS | Production close/liquidation derive price internally from canonical market/TWAP state |
| Self-skew protection | PASS | Only the target position is excluded; LONG/SHORT, size, background OI, and order cases tested |
| Margin/liquidation | PASS | LONG/SHORT ratios above, equal to, and below threshold tested |
| Vault realized-solvency | PASS FOR INTERNAL ACCOUNTING | Exact backing succeeds; excess claims reject atomically; `availableCapital` stays nonnegative |
| Oracle/TWAP | PASS FOR LOCAL VALIDATION AND CALCULATION | Invalid updates preserve supplied state; complete arithmetic 900-second TWAP path tested |
| Economic security | UNPROVEN; SAMPLED CASES EMPIRICALLY SUPPORTED | No positive extraction in the measured 140-row current-path matrices and five historical violations |
| Global maximum extraction | NOT ESTABLISHED | No global capacity/backing bound, attack-cost enforcement, custody model, or exhaustive feasible-attack proof |

The implementation satisfies the tested lifecycle/accounting invariants in
the defined prototype scope. This is distinct from a formal economic proof or
production deployment readiness.

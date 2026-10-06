# Final Protocol Specification

## Purpose and status

This document consolidates the protocol-design audits into an implementation
contract. It freezes behavior supported by the repository where appropriate,
identifies intended invariants that implementation must enforce, and leaves
economic decisions unresolved when the paper/research framing and prototype do
not select them.

This is a design specification, not an implementation. Existing source code
does not satisfy every requirement below. “Required contract” describes the
behavior a future implementation must provide once the blocking semantics
have been decided; it is not a claim that the current repository already does
so.

**No prototype formula below is attributed to the All Perps paper merely
because it exists in the repository.** The checked-in research describes an
All Perps-inspired prototype and does not include an authoritative paper text
or citation sufficient to verify detailed formula attribution.

## 1. Source-of-truth hierarchy

Apply this hierarchy when evidence or proposed rules conflict:

1. **PAPER-SUPPORTED PRINCIPLE** — high-level All Perps research framing
   represented in the repository: economic security should compare the cost
   of a TWAP attack with the maximum extractable profit. This is a design
   principle, not a complete numerical security or solvency specification.
   The exact authoritative paper source must be checked before attributing
   further requirements to the paper.
2. **REPOSITORY IMPLEMENTATION** — behavior actually defined by current
   source, with its inputs, callers, and limitations. Implemented behavior
   is evidence of prototype semantics, not proof that those semantics are
   the intended protocol or paper requirement.
3. **PROJECT ASSUMPTION** — a protocol choice made by this project because
   the paper and repository do not determine it. Such choices must be
   explicit, reviewable, and approved before implementation.
4. **EMPIRICAL EXPERIMENT** — an observed result under a selected script,
   configuration, input grid, and model. It can motivate a hypothesis; it
   does not prove a global invariant or an outcome outside the tested
   domain.

The required high-level research principle is:

```text
minimum attacker cost to execute an attack
    > maximum realizable attacker extraction from that attack
```

The following are prototype/project choices, not established paper
specifications: the arithmetic 900-second TWAP, the particular skew and
capacity equations, `totalOI` as the capacity measure, the position schema,
the PnL and margin equations, the proposed settlement mark, and every
numerical coefficient.

| Major rule | Classification |
|---|---|
| TWAP attack cost exceeds maximum realizable extraction | **PAPER-SUPPORTED PRINCIPLE** in the repository's research framing; not a numerical formula or proof |
| Arithmetic 900-second TWAP and observation rules | **REPOSITORY IMPLEMENTATION**; protocol adoption and source authority are **PROJECT ASSUMPTIONS** |
| Skew/capacity pricing equations and canonical step pricing | **REPOSITORY IMPLEMENTATION / PROJECT ASSUMPTION**; not attributed to the paper |
| Gross `totalOI` capacity and position/OI conservation identity | **PROJECT ASSUMPTION** and required invariant; current enforcement is incomplete |
| PnL, margin, and strict liquidation comparison | **REPOSITORY IMPLEMENTATION / PROJECT ASSUMPTION**; locally defined prototype behavior, not paper requirements |
| `DeltaP_max` and entry-relative movement limit | **PROJECT ASSUMPTION** if retained; only a conditional mathematical bound follows |
| External constant-product manipulation cost and finite sweep results | **EMPIRICAL EXPERIMENT** under configured assumptions; not global proof |
| Passive LPing as deposit-only exposure without active market making | **PROJECT ASSUMPTION** describing the intended product, not implemented LP ownership/custody |
| Atomic transitions and vault-backed payment | **REQUIRED PROJECT INVARIANTS**; not fully implemented and not established as paper formulas |

The consolidated audit evidence is in
[`research-report.md`](./research-report.md),
[`protocol-economic-state-machine.md`](./protocol-economic-state-machine.md),
[`price-semantics.md`](./price-semantics.md),
[`delta-p-max-design.md`](./delta-p-max-design.md),
[`settlement-boundary.md`](./settlement-boundary.md),
[`position-oi-invariants.md`](./position-oi-invariants.md),
[`vault-settlement-invariants.md`](./vault-settlement-invariants.md),
[`solvency-model.md`](./solvency-model.md),
[`solvency-design.md`](./solvency-design.md), and
[`end-to-end-economic-attack-model.md`](./end-to-end-economic-attack-model.md).
Experiment outputs and finite sweeps remain empirical evidence only.

## 2. Protocol actors

| Actor | Controls | Cannot control | State they may mutate | Economic claim / role |
|---|---|---|---|---|
| Trader | Requests LONG or SHORT exposure; supplies size and margin in the prototype; requests a close. | Must not choose authoritative mark or settlement price; must not directly alter market OI or another position. | Under the required contract, only their own position lifecycle through validated protocol operations. | Has the position's contractual PnL and returned margin/collateral claim under settlement rules. The current prototype only calculates a numeric claim; it does not transfer assets. |
| LP | Supplies base-asset capital to the passive pool. | Does not quote, choose execution prices, manage concentrated liquidity, or control oracle/settlement values. | Deposits and LP ownership state through protocol entry points; current prototype exposes only nominal vault deposits. | Has residual economic exposure to trader PnL and premiums under a future, defined vault/share model. Ownership and withdrawal rights are not implemented. |
| Protocol / market | Applies validated trading, risk, settlement, and accounting rules. | Must not silently substitute a caller-controlled price for the selected oracle authority or bypass state invariants. | Market state, positions, OI, risk state, and accounting through atomic protocol transitions. | No separate protocol revenue or balance sheet is implemented. |
| External AMM / price source | In the modeled threat, determines the external spot path and has finite liquidity. | It is not controlled by the protocol in the proposed abstraction. | Supplies observations only through a future-defined source adapter. No external-pool state is currently connected to production code. | Attack cost is borne in this external market. The experiment model does not implement an attacker's actual balance sheet or asset transfers. |
| Oracle / TWAP | Validates and aggregates timestamped observations according to an approved source and TWAP policy. | Must not create a price by mixing protocol OI-derived marks into an allegedly independent external observation without an explicit decision. | Observation history and derived TWAP. Current observation arrays are in-memory objects; persistence and source authentication are not provided. | No independent economic claim is modeled. |
| Liquidator / keeper (conditional actor) | If liquidation is retained, submits or performs a permitted liquidation operation after the protocol determines eligibility. | Must not set the authoritative mark, choose arbitrary PnL, or mutate OI outside the canonical liquidation transition. | Only the liquidation request/transition authorized by the final protocol. | No keeper reward, liquidation incentive, or penalty is currently defined; none is assumed by this specification. |

The oracle and external AMM are roles in the proposed price path, not currently
integrated production actors. Liquidation mechanics exist in the prototype,
but the liquidator's economic role is not specified.

## 3. Canonical market state and price fields

The canonical per-market state in the prototype is `MarketState`:

| Field | Meaning in the prototype | Unit | Authority and update path | Persisted / derived / trusted |
|---|---|---|---|---|
| `symbol` | Market identifier | Identifier, not a price unit | Configured market identity | Stored |
| `indexPrice` | Latest validated reference observation | Quote per base unit | Updated by `updateMarketFromReferencePrice`; experiments may set directly | Stored reference value, not settlement authority |
| `ammTwapPrice` | 900-second arithmetic TWAP of reference observations | Quote per base unit | Set by `updateMarketFromReferencePrice` when a complete observation window is available; otherwise left unchanged | Stored derived value; `ReferencePriceSource` is abstract and has no authenticated external implementation |
| `longOpenInterest` | Aggregate open LONG size | Prototype size units | Mutated by trade simulation and close paths, but also publicly mutable and not reconciled to positions | Stored counter; correctness is currently unproven |
| `shortOpenInterest` | Aggregate open SHORT size | Prototype size units | Same as LONG OI | Stored counter; correctness is currently unproven |

`totalOI` is derived, not independently stored:

```text
totalOI = longOpenInterest + shortOpenInterest
skew = longOpenInterest - shortOpenInterest
```

For the canonical prototype trading path, use `ammTwapPrice` as its base
price. `indexPrice` carries the latest reference point; `ammTwapPrice` is
the time-weighted signal and is the base for the protocol mark.

Distinct price concepts:

```text
externalSpotPrice       = price from the external source/market
observationPrice        = validated sample recorded at a timestamp
ammTwapPrice            = arithmetic 900-second time-weighted observation mean
rawProtocolMark         = getCurrentAmmPrice(ammTwapPrice, OI skew)
executionPrice          = side-specific step quote for opening exposure
settlementPrice         = getSettlementPrice, same protocol mark for close and liquidation
```

`ReferencePriceSource.getLatestObservation()` provides the reference sample;
the oracle service validates and records it, updates `indexPrice`, and only
updates `ammTwapPrice` when the complete 900-second window exists.
`getSettlementPrice` delegates to `getCurrentAmmPrice`. Production settlement
does not accept a caller-selected price.

## 4. External price and oracle path

The intended architecture is:

```text
External price source
        ↓
validated observation {timestamp, price}
        ↓
900-second arithmetic TWAP
        ↓
skew-adjusted protocol mark
        ↓
risk / canonical close and liquidation settlement
```

The external AMM remains an abstract assumption in the attack experiments.
There is no production reserve pool whose swaps generate the observations
used by `TWAPOracle`. Experiments often inject a manipulated spot or TWAP
directly. The constant-product pool and its reserves are experimental
assumptions, not live oracle infrastructure.

The explicitly simulation-only
`SimulatedProtocolMarkObservation.ts` / `recordSimulatedProtocolMarkObservation` obtains a sample from
`getCurrentAmmPrice`; production reference ingestion does not derive
observations from protocol state. The actual external source and its
authentication remain unimplemented.

The legacy Euler geometric-TWAP experiment is not the production TWAP and
must not be used as its specification or evidence.

## 5. TWAP semantics

### Existing arithmetic behavior

The repository defines:

- Window: `TWAP_WINDOW = 15 * 60 = 900` seconds.
- Timestamp unit: Unix seconds.
- Observation shape: `{ timestamp, price }`.
- Price validation: finite and strictly positive.
- Time weighting: an observation contributes from its timestamp until the
  next observation, capped to the requested window.
- Mean: arithmetic, not geometric.
- History requirement: there must be an observation at or before
  `now - 900`; otherwise calculation returns `null`.
- Same-timestamp update: the latest observation replaces the previous
  observation at that timestamp.
- Backward timestamp: rejected.
- Pruning: retains the latest observation at or before the 900-second
  cutoff as an anchor.
- Missing complete history: `updateAmmTwap` leaves `ammTwapPrice` unchanged.

The implemented calculation is:

```text
windowStart = now - 900
weightedPrice = Σ(observationPrice_i × coveredDuration_i)
TWAP = weightedPrice / 900
```

### Required policy not yet specified

The code's unchanged-value behavior on incomplete history does not establish
a safe stale-price policy. There is no defined maximum observation age,
oracle outage response, stale-price rejection rule, pause behavior, or
fallback authority. Before implementation, specify:

1. Which actor/source is authorized to submit observations and how they are
   authenticated.
2. What time source and ordering/clock assumptions apply.
3. What happens when history is incomplete, stale, missing, duplicated, or
   invalid.
4. Whether the market may open, mark, close, or liquidate during an oracle
   outage.
5. Whether a complete window is required after initialization or source
   changes.

Until decided, retaining the last `ammTwapPrice` is merely current code
behavior, not an approved stale-observation protocol rule.

## 6. Canonical opening and trading model

### Selected prototype opening path

For a valid request, the canonical opening path to preserve is:

```text
request
  → leverage check
  → capacity check for each step
  → stepwise getAverageExecutionPrice()
  → stage side OI changes
  → average execution price
  → commit market OI and create one position atomically
```

The current implementation performs leverage validation before step
execution; on each step it checks capacity, prices against the working state,
then adds that step's exposure to the working OI. The specification requires
the OI commit and position insertion to become one atomic transition.

Let:

```text
L = longOI
S = shortOI
C = maxCapacity
K_s = skewCoefficient
K_c = capacityCoefficient
```

Then the prototype equations are:

```text
skew            = L - S
skewRatio       = skew / C
totalOI         = L + S
capacityUsage   = totalOI / C

fairValue       = ammTwapPrice × (1 + K_s × skewRatio)
capacityImpact  = K_c × (capacityUsage / (1 - capacityUsage)) / 2

LONG step price  = fairValue × (1 + capacityImpact)
SHORT step price = fairValue × (1 - capacityImpact)

averageEntryPrice = Σ(stepPrice_i × stepSize_i) / Σ(stepSize_i)
```

This function prices against the current working OI at each step. It is a
prototype formula, not a paper formula. It is undefined or invalid when
`C <= 0`, when input state is malformed, or when utilization reaches one;
input and configuration validation are required before use.

`getCurrentAmmPrice` is not an opening execution function:

```text
rawProtocolMark =
  ammTwapPrice × (1 + K_s × skewRatio)
```

### Competing pricing functions

| Function | Specification status | Rationale |
|---|---|---|
| `getAverageExecutionPrice` | **Canonical opening path** | Used by `simulateTrade`; exact stepwise formula above |
| `getExecutionPrice` | **Non-canonical / legacy alternative** | Exists, but opening does not call it; do not expose as an equivalent protocol rule |
| `getBoundedExecutionPrice` | **Experimental / non-canonical** | Uses a bounded linear capacity impact and fixed default cap; not selected |
| `getConvexExecutionPrice` | **Experimental / non-canonical** | Uses `indexPrice` and squared absolute skew; not selected |

Future implementation must not silently switch among these models. Any
replacement requires an explicit protocol decision and revised economic
analysis. The capacity impact's division by two is part of the existing
`getAverageExecutionPrice` formula and must not be omitted in transcription.

### Atomic open contract

For any failed open, all of the following remain unchanged:

```text
market longOI and shortOI
position ledger
vault/accounting state
```

No position may be committed without the matching OI change, and no OI
increase may survive a failed or duplicate-ID position creation. Validate
finite positive size, positive integral step count, finite positive price,
valid margin/leverage, valid configuration, and unused position ID before
commit. The required atomicity is not fully provided by the current
`Object.assign` followed by `Map.set` ordering.

## 7. Position representation and OI invariants

### Canonical ledger identity

For each market `m`, the required invariant is:

```text
longOI(m) =
  Σ(position.size for every OPEN LONG position in market m)

shortOI(m) =
  Σ(position.size for every OPEN SHORT position in market m)

totalOI(m) = longOI(m) + shortOI(m)
totalOI(m) <= maxCapacity(m)
```

The sum is market-scoped. OI counts gross open size; longs and shorts do not
net against one another for `totalOI` or capacity.

### Position identity and fields

The prototype record is:

```text
Position = {
  id,
  trader,
  market,
  side,
  size,
  entryPrice,
  margin
}
```

Required lifecycle semantics:

- `id` is unique for the lifetime of a position and cannot be overwritten or
  reused while any record with that ID is open.
- `market`, `side`, `size`, `entryPrice`, and opening `margin` are immutable
  while the position is open under the current no-partial-close model.
- `trader` identifies the claimant and is immutable.
- Lifecycle state is exactly one of `OPEN`, `SETTLED`, or `LIQUIDATED` (if
  liquidation is retained). A closed record must not remain eligible for
  PnL realization. Whether terminal records are persisted or deleted is an
  implementation/storage choice; identity and one-time settlement are
  semantic requirements.
- Mutable position object references must not escape in a way that allows
  callers to mutate canonical ledger state without the OI transaction.
- No partial close is defined in the prototype. A close releases the full
  stored size. Adding partial close requires a separate accounting contract.

Current `PositionManager` uses a `Map` keyed only by ID, accepts duplicate
IDs by replacement, and returns mutable references. Direct manager insertion,
deletion, and mutation can bypass market OI. These APIs do not currently
enforce the required ledger identity.

### State-transition equations

For a successful open of positive size `Q`:

```text
open LONG Q:   longOI' = longOI + Q;   shortOI' = shortOI
open SHORT Q:  shortOI' = shortOI + Q; longOI' = longOI
```

For a successful full close of registered size `Q`:

```text
close LONG Q:  longOI' = longOI - Q;   shortOI' = shortOI
close SHORT Q: shortOI' = shortOI - Q; longOI' = longOI
```

Liquidation, if retained, releases exactly the same registered side and size
as close. Failed open, close, or liquidation changes no market, ledger, or
vault state. These are required contracts; global conservation is currently
**VIOLATED** by duplicate IDs, direct mutable APIs, independent manager
operations, malformed inputs, and non-atomic financial settlement.

## 8. Capacity

`maxCapacity` means the strict upper bound on gross total open interest:

```text
totalOI = longOI + shortOI
totalOI <= maxCapacity
```

Policy:

- Check capacity for every step of an open against the staged post-previous-
  step OI.
- Equality is allowed: a valid open may end exactly at `maxCapacity`.
- A request that would make `totalOI > maxCapacity` must fail without any
  state mutation.
- Capacity applies to gross open size, not net skew.
- No floating-point tolerance may redefine the economic limit as
  `maxCapacity + ε`. An implementation must choose a representation and
  comparison strategy that preserves exact protocol semantics; the current
  relative tolerance admits a small amount above the nominal bound.
- The gate must rely on a consistent OI ledger. A counter-only capacity
  check cannot repair or prove that OI equals the position sum.

No LP-capital-to-capacity formula is supported by the evidence. `maxCapacity`
is configured independently of deposits in the current code. A capital-based
capacity rule is therefore **UNRESOLVED**, not derivable from the current
implementation or the paper framing available in this repository.

## 9. Canonical position lifecycle

### Open

```text
request → validated/open transition → OPEN position + matching OI
```

The complete transition is atomic. The opening operation creates exposure;
it does not close, net, or mutate an existing position. Current opening does
not transfer margin to the vault or collect an automatic premium.

### Voluntary close

A close must settle the existing position ID. It must not be simulated as
`simulateTrade(oppositeSide)`: that creates a second position, adds gross
OI, and does not close the original.

Required successful transition:

```text
OPEN
  → determine approved settlement price
  → calculate realized PnL and trader claim
  → update vault/liability accounting and payout state
  → release exact registered side OI
  → mark position terminal/remove it
  → return/transfer settlement according to the custody design
```

All components commit atomically. The position is settled once only. Failed
settlement, accounting, OI release, or payout causes no partial update.
Exact payout/custody semantics remain unresolved in Section 14–15.

### Liquidation (conditional)

If liquidation is retained:

```text
OPEN
  → mark with the approved risk price
  → test liquidation condition
  → determine PnL and liquidation settlement
  → account for vault/liability and payout
  → release exact registered side OI
  → mark terminal/remove position
```

This must be atomic and must operate on the manager's canonical position,
not a caller-supplied divergent object. It must not create negative OI or
settle the same position twice. Liquidation penalties, keeper rewards,
insurance, and backstop behavior are not defined and must not be invented.

Current voluntary close and financial liquidation record PnL in the vault
before `closePosition`, so an OI failure leaves partial state. A bare
`liquidatePosition` removes OI/position without recording PnL in the vault.
The current lifecycle functions therefore do not satisfy the unified
contract above.

## 10. Settlement price authority — unresolved blocker

Candidate:

```text
rawProtocolMark = getCurrentAmmPrice(market, config)
```

This is a skew-adjusted function of `ammTwapPrice` and `longOI-shortOI`.
Current settlement entry points instead accept a caller-supplied
`currentPrice`. Experiments sometimes pass target TWAP and sometimes pass a
literal recovery price. Neither fact chooses a production settlement
authority.

No available repository or research evidence establishes whether the same
price must drive:

- mark-to-market and liquidation eligibility;
- voluntary close;
- liquidation realization;
- recovery after oracle manipulation.

Nor does the evidence settle whether a mark is snapshotted once per
market-step or recomputed after each close. Because `getCurrentAmmPrice`
depends on skew, removing OI changes a subsequent computed mark; settlement
order could therefore affect results.

**UNRESOLVED — BLOCKING IMPLEMENTATION DECISION**

Before implementation, select and specify:

1. Authoritative observation source and price path.
2. Risk mark and whether it is identical to settlement price.
3. Voluntary-close and liquidation price semantics.
4. Recovery semantics and any time/snapshot boundary.
5. Price snapshot timing across multiple closes in the same market step.

The repository now implements the shared canonical settlement path through
`getSettlementPrice`; the abstract external source remains unauthenticated.

## 11. Settlement boundary and `DeltaP_max`

The previous audits establish only a conditional liability inequality. If
every position's favorable settlement movement from its own entry is bounded
by `DeltaP_max`, and OI is the complete sum of open position sizes, then:

```text
positive PnL_i <= position.size_i × DeltaP_max

Σ positive PnL_i
    <= DeltaP_max × totalOI
    <= DeltaP_max × maxCapacity
```

This is **FORMAL, conditional** on the PnL formula, movement rule, exact
position/OI invariant, and strict capacity invariant. It is not currently
enforced. `DeltaP_max` is not uniquely derived by the paper or the attack
experiments; it remains a project risk parameter if retained.

`DeltaP_max` in this bound is a favorable entry-to-settlement movement in
raw price units, not a percentage, a spot deviation, or a TWAP deviation.
The experiments' manipulated spot, target TWAP, recovery price, and
execution-price differences are distinct quantities. No validated mapping
connects them to a universal `DeltaP_max`.

The boundary question is the behavior when the raw price violates the
proposed movement restriction. No option is selected:

| Option | Benefit | Drawback | Closeability | Oracle semantics | Solvency | Fairness |
|---|---|---|---|---|---|---|
| A. Reject out-of-bound settlement | Prevents that settlement from paying the raw over-bound value at that instant | Leaves exposure and liability open; does not guarantee future in-bound price | Violates “every trader can close at every step”; permits stuck positions and can obstruct liquidation | Preserves raw price but makes settlement unavailable | Avoids immediate over-bound payment only; does not prove solvency | Traders are treated differently by whether a position is outside the band |
| B. Per-position clamp to entry ± bound | Caps each position's settlement movement and can allow immediate closure | Creates a position-specific effective price and artificial PnL; changes attack economics | Can preserve immediate settlement if all sides/directions are handled symmetrically | Effective price diverges from raw mark; creates incentive to push raw price beyond the rail | Can support the conditional PnL bound if consistently applied to close, mark, and liquidation | Positions in one market/time can settle at different prices |
| C. Market-wide bounded mark | One effective price for all positions at a time | Global bounds do not bound entry-to-settlement movement unless entries are also bounded; needs range, anchor, and update rules | May allow immediate close | Transforms raw oracle outside rails | Does not by itself establish the entry-relative liability bound | More consistent across positions, but can create boundary PnL and manipulation-to-rail incentives |
| D. Delay until price returns | Avoids immediately realizing a disallowed price | No guarantee of return; creates time option and liveness/griefing risk | Violates immediate closeability while delayed | Makes settlement depend on future oracle path | Delays rather than caps liability | Exposes trader to post-request price and timing changes |
| E. Forced liquidation at/outside boundary | Can remove positions if it uses a defined settlement mechanism | Boundary crossing is not current margin liquidation; raw settlement can violate bound, while clamped settlement inherits B/C tradeoffs | May close, but can force healthy traders out; rejection/delay variants still lock positions | Requires one explicit price for risk and realization | No solvency guarantee unless coupled to a valid settlement-price bound | Boundary-triggered liquidation can be manipulated and may be asymmetric by entry/side |

None of these choices cleanly satisfies solvency, closeability at every step,
oracle-price fidelity, fairness, and minimal invented machinery at once.
Therefore the boundary is **UNRESOLVED**. Do not silently reject, clamp,
delay, or force-liquidate.

`attackCost > maximum extraction` does not imply LP backing covers trader
payout, and LP backing does not imply attack resistance. Do not infer an
attack-cost-derived `DeltaP_max` or a single combined capacity formula.

## 12. PnL and settlement quantities

Freeze the prototype's PnL equations as the intended calculation absent a
separate economic decision:

```text
LONG  PnL = (settlementPrice - entryPrice) × size
SHORT PnL = (entryPrice - settlementPrice) × size
```

Terms:

- **Unrealized PnL:** the signed result of the same side/entry/size equation
  evaluated at a risk mark; it is not yet booked to the vault.
- **Realized PnL:** the signed PnL booked once when an approved close or
  liquidation transition commits.
- **Settlement PnL:** realized PnL evaluated at the selected authoritative
  settlement price.
- **Trader claim:** what the protocol owes the trader under the contract,
  potentially including margin plus PnL; the precise collateral/cash
  semantics remain unresolved.
- **LP liability:** the positive amount the LP-backed pool is contractually
  required to pay, after whatever margin/collateral treatment is eventually
  specified. It is not automatically identical to raw PnL or the trader
  claim.
- **Attacker extraction:** the attacker's net realizable economic benefit
  over the full attack lifecycle. It is not automatically equal to PnL,
  fill-price differences, or trader claim.
- **Attack cost:** the attacker's complete economic cost, not merely capital
  temporarily required or an experiment's slippage proxy.

The current voluntary close returns `margin + pnl` without a nonnegative
floor; liquidation reports `max(margin + pnl, 0)`. This inconsistency must
be resolved alongside margin custody and settlement terms. A settlement
result value is not an asset transfer.

## 13. Margin and liquidation

Current risk equations:

```text
equity = margin + PnL
marginRatio = equity / size
liquidatable iff marginRatio < maintenanceMargin
```

The strict `<` comparison is current repository behavior; equality is not
liquidatable. Preserve this boundary unless a separately approved rule
changes it. The prototype's leverage check is `size / margin <= maxLeverage`.

These equations assume valid positive finite size, margin, and configured
thresholds; the current code does not enforce every such precondition.
Liquidation eligibility price authority remains blocked by Section 10.

Unspecified; do not invent:

- liquidation incentive or keeper reward;
- liquidation penalty;
- insurance fund or deficit backstop;
- whether and how margin is actually held or transferred;
- liquidation execution price if distinct from the risk mark;
- liquidation claim/payout when PnL exceeds margin or vault backing.

If liquidation is retained, its close and accounting transition must be
atomic, use the canonical position record, release exact OI once, and apply
the approved price and claim semantics.

## 14. LP vault and passive LPing

### Existing accounting fields

| Field | Current implementation meaning | Limitation |
|---|---|---|
| `totalDeposited` | Cumulative nominal deposits | No LP share/ownership ledger and no withdrawal flow |
| `availableCapital` | Mutable nominal accounting capital used as realized-PnL backing | Successful close/liquidation PnL cannot make it negative; not a verified cash balance and does not reserve open-position liabilities |
| `traderPnL` | Cumulative signed PnL booked | No corresponding asset transfer is implemented |
| `premiums` | Cumulative nominal premiums added by a direct helper | No automatic premium collection in opening; no transfer/custody is shown |

For ordinary finite updates, the intended arithmetic is:

```text
availableCapital = totalDeposited - traderPnL + premiums
```

This is an accounting identity, not proof of assets held or available for
payout. The vault has no reserve for open positions, no withdrawal logic, no
actual cash/token interface, and no rule preventing `availableCapital < 0`.

`Position.margin` is stored separately on each position and used for
leverage/equity calculations. It is not transferred into or recorded by the
LP vault or a distinct custody ledger. Treat it as an accounting/risk field
only until a custody decision is made. Do not count it as LP backing or as
cash available to pay a trader without evidence of custody.

### Passive LPing intent

Passive LPing in this prototype means:

- LP deposits the base asset into the protocol's passive liquidity pool.
- LP receives economic exposure to market/trader PnL under the eventual
  ownership and vault rules.
- LP performs no quoting, active market making, or concentrated-liquidity
  management.

No strategy, rebalancing algorithm, or active market-making behavior is
implied. Actual token custody, LP shares, ownership attribution, withdrawal
rights, and realized asset returns are not implemented and remain design
work.

## 15. Vault solvency — unresolved blocker

The desired property must ultimately be stated over actual payable
liabilities and assets, for example:

```text
all positive trader settlement liabilities
    <= assets legally and operationally available to pay them
```

The exact accounting must state how trader margin/collateral, realized trader
losses, premiums, open-position liabilities, and any permitted withdrawals
enter both sides. `availableCapital` alone is not an established measure of
available assets.

The current design has not selected or enforced a complete mechanism:

- no settlement rejection/payability guard;
- no opening-time liability reserve;
- no approved LP-capital-to-capacity formula;
- no enforced `DeltaP_max` movement rule or boundary behavior;
- no implemented asset transfer/custody;
- no atomic cross-object settlement.

Thus a negative vault balance can be recorded, and a reported settlement
claim is not necessarily payable. The conditional bound
`DeltaP_max × maxCapacity` could bound aggregate positive PnL only if all
its premises are made protocol rules and applied to the actual payout
liability. Neither the premise nor a backing mechanism is currently
established. Do not invent a capital ratio or claim a formal solvency proof.

**UNRESOLVED / BLOCKING.** Before implementation, choose and specify the
asset/collateral model, the liability definition, when backing is reserved or
checked, what happens on insufficient backing, and how capacity relates to
capital (if at all).

## 16. Economic security — separate invariant

The high-level economic-security objective is:

```text
for every feasible attack scenario:
  minimum complete attacker cost
      > maximum realizable attacker extraction
```

The same scenario must define and use:

- one external manipulation path and spot path;
- its resulting observation and TWAP path;
- protocol execution prices and position/OI transitions;
- mark, liquidation, close, settlement, and recovery;
- one common numeraire and time horizon;
- complete cost definition, distinguishing capital required from economic
  loss;
- maximum extraction that is actually realizable after the complete
  lifecycle.

The current repository does not connect the external constant-product pool
to production observation generation. Many experiments inject manipulated
prices; selected recovery prices are caller inputs; some “round-trip”
comparisons open an opposite-side position instead of closing the original;
the cost model is an experimental slippage/loss proxy; and the experiment
grids are finite. Therefore they do not establish a global minimum-cost /
maximum-extraction inequality.

Do not infer:

```text
attackCost > DeltaP_max × maxCapacity
```

from the All Perps principle or the existing experiments. Attack cost and LP
payout are different quantities. Economic attack resistance remains
**UNPROVEN** independently of the unresolved vault-solvency property.

## 17. Atomicity requirements

Every state-changing protocol operation must be all-or-nothing across the
market, position ledger, vault/liability ledger, and asset-transfer ledger
once those objects exist.

| Operation | Success | Any failure |
|---|---|---|
| Open | Validated position created; exactly matching side OI committed; any required margin/premium/accounting handled according to approved terms | OI unchanged; no position; vault and custody unchanged |
| Voluntary close | Existing position settled once; approved PnL and claim recorded/paid; exact OI released; position terminal/removed | Position remains open; OI, vault, liability, and custody state unchanged |
| Liquidation | Canonical position passes approved liquidation rule; settlement/accounting/payout and exact OI release commit together; position terminal/removed | Position remains in a consistent pre-operation state; OI, vault, liability, and custody unchanged |
| Deposit | Deposit amount accepted and corresponding assets/LP accounting recorded once | No asset or ledger mutation |

Staging calculations before mutation is necessary but not sufficient if the
subsequent sequence can fail. The implementation needs a transaction or
equivalent rollback/commit boundary. Repeated close/liquidation must not
double-book PnL or release OI twice. Direct manager APIs and mutable
references must not bypass the transaction boundary.

## 18. Formal invariant status

Statuses describe the **current repository**, not the target contract.

| Invariant | Mathematical / semantic definition | Current status | Required implementation |
|---|---|---|---|
| Capacity | `longOI + shortOI <= maxCapacity` | **PARTIALLY PROVEN** — checked per step in canonical opening, but tolerance admits a small excess and starting OI may be stale/corrupt | Enforce strict gross cap for every step from a valid reconciled ledger; exact equality allowed |
| Position/OI conservation | Side OI equals sum of corresponding open position sizes per market | **VIOLATED** — duplicate ID replacement, direct manager edits, mutable references, and malformed inputs can desynchronize | One authoritative atomic ledger transition; reconcile/check invariants |
| Unique position IDs | No two live positions share an ID; open cannot overwrite | **VIOLATED** — `Map.set` replaces duplicates | Enforce uniqueness before mutation and protect canonical records |
| TWAP correctness | `ammTwapPrice` equals arithmetic 900-second weighted mean of valid reference observations when history is complete | **IMPLEMENTED, SOURCE UNAUTHENTICATED** — production-facing service validates/records observations and preserves incomplete-history behavior; no real provider or persistence is supplied | Integrate/authenticate a reference source and later define stale/outage behavior |
| Settlement authority | One protocol-derived price determines production risk and settlement prices | **IMPLEMENTED** — close/liquidation derive `getSettlementPrice` from `getCurrentAmmPrice`, before OI release | Price movement bounds, provider authority/authentication, and outage policy remain separate |
| PnL correctness | Side-specific PnL follows the frozen equations for valid inputs and the approved settlement price | **PARTIALLY PROVEN** — local arithmetic is defined, but settlement semantics and end-to-end lifecycle are not | Validate inputs; bind to selected authoritative price and one-time lifecycle |
| Vault accounting | For ordinary finite updates, `availableCapital = totalDeposited - traderPnL + premiums` | **PARTIALLY PROVEN** — arithmetic updates support identity; direct mutation/non-finite edge cases and no cash ledger | Protect ledger and define custody/transfer semantics |
| Vault solvency | Payable positive trader liabilities never exceed available assets | **VIOLATED** — positive PnL can exceed capital and accounting becomes negative; no payout guard | Define liabilities/assets and enforce reserve, payability, or another approved mechanism |
| Closeability | Every eligible trader can close at every protocol step | **UNPROVEN** — canonical settlement price is implemented, but solvency rejection and deferred oracle-outage behavior can still prevent a close | Resolve close guarantees, backing, and outage behavior without silently changing settlement economics |
| Liquidation correctness | Only canonical unhealthy positions liquidate once at approved prices with exact settlement and OI release | **PARTIALLY PROVEN** — strict local margin check and OI release exist; bare and financial paths differ and are non-atomic | Select liquidation price/claim semantics; unify atomic canonical path |
| Atomicity | Failed open/close/liquidation leaves all participating state unchanged | **VIOLATED** — financial close/liquidation book vault PnL before OI release; opening commits market before manager insertion | Transactional cross-object commit/rollback |
| Economic security | Minimum complete attack cost exceeds maximum realizable extraction for every feasible attack | **UNPROVEN** — finite experiments and disconnected external cost proxy do not prove global inequality | Define complete attack domain/path, calibrate cost, and prove or bound the inequality |

The prototype PnL arithmetic is locally defined; this must not be confused
with proven realized settlement, trader payment, vault solvency, or attack
resistance.

## 19. Implementation blockers

### P0 — protocol semantics

These decisions remain open beyond the implemented settlement path:

1. **Oracle provider and operations:** `ReferencePriceSource` is abstract;
   the actual external provider, authentication, staleness, and outage
   behavior remain unimplemented.
2. **Price movement boundary:** production mark and settlement path are
   canonicalized; recovery prices remain experiment inputs, while movement
   bounds and recovery behavior are deferred.
3. **Settlement snapshot timing:** one market-step snapshot or recalculation
   after each OI-changing close.
4. **Settlement boundary:** whether to retain `DeltaP_max`; if retained,
   choose its value/derivation scope and the behavior outside the movement
   bound. It is not uniquely derived.
5. **Trader claim and margin custody:** whether margin is actual collateral,
   where it is held, voluntary-close negative claims, and consistency between
   close and liquidation claims.
6. **LP solvency mechanism:** define available assets and outstanding
   liabilities; decide reservation/payability behavior and any capacity
   relationship. No capital-to-capacity ratio is supported.
7. **Liquidation economics:** retain liquidation and define its settlement
   and claimant semantics. Do not add incentives, penalties, insurance, or
   backstops without an explicit decision.
8. **Economic-security scope:** define attack cost, feasible strategy space,
   extraction lifecycle, common unit/time horizon, and what evidence is
   required for the global inequality.
9. **Paper provenance:** verify the authoritative paper and attribute only
   requirements it actually states.

The production price authority path is implemented. Oracle-provider
authentication, movement bounds, global liability solvency, and actual cash
custody remain unresolved, so this does not establish global economic
settlement safety.

### P1 — invariant enforcement

After P0 semantics are approved, implementation must enforce:

1. One atomic open/close/liquidation transition across market OI, the
   position ledger, vault/liability state, and actual custody/transfer state.
2. Position/OI conservation, unique IDs, canonical immutable records, and
   prevention of direct API/reference mutation that bypasses accounting.
3. Finite valid inputs and configuration; positive size/margin as required
   by the approved margin semantics; positive integral step count.
4. Strict gross capacity at each step, with equality allowed and no economic
   tolerance above `maxCapacity`.
5. Exactly-once realization, no negative OI, no orphan positions/OI, and
   no repeat settlement after terminal state.
6. Valid observation time/history/source handling and consistent price
   snapshots.
7. A formally testable solvency check against defined payable assets and
   liabilities.

### P2 — cleanup / refactoring

Once the canonical behavior is fixed:

1. Remove or clearly isolate non-canonical execution-price alternatives so
   they cannot be mistaken for protocol rules.
2. Consolidate bare and financial liquidation/close entry points around the
   approved atomic lifecycle.
3. Remove or restrict direct mutable position-manager and market-state
   surfaces that bypass invariant enforcement.
4. Label experiment-only price injection, recovery inputs, and external-pool
   cost estimates as experimental interfaces, not production protocol paths.

These are correctness and ambiguity cleanup items, not cosmetic work.

## 20. Final protocol statement

The specification freezes the prototype's canonical opening formula, gross
OI accounting target, PnL equation, and strict liquidation comparison as
explicitly classified project behavior. It does not select authoritative
settlement pricing, out-of-bound settlement behavior, margin custody, or a
complete LP solvency mechanism. Making those choices implicitly in code
would invent economic semantics and could violate both solvency and trader
closeability.

## PROTOCOL STATUS

```text
BLOCKED — PROTOCOL SEMANTICS UNRESOLVED
```

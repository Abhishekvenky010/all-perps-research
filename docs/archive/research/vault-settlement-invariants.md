# Vault and Settlement Invariants

## Conclusion

### Current realized-settlement rule

Profitable PnL is now checked in `prepareTraderPnL` before the atomic close
or liquidation commit. A settlement is rejected with
`INSUFFICIENT_LP_BACKING` if applying the signed PnL would make
`availableCapital` negative. Equality is allowed, so consuming exactly all
available backing leaves the vault at zero. The same check applies to direct
`recordTraderPnL` callers.

For this check, `availableCapital` is the implemented LP backing value.
Positive trader PnL reduces it; negative PnL increases it under the existing
signed-accounting convention. `Position.margin` is not included because it is
not transferred into the vault. `addPremium` currently increases
`availableCapital`, so already-booked premiums are included in this value;
there is no automatic premium collection from trades. This is accounting
solvency for realized settlements, not proof of custody or cash transfer.

Position margin remains trader-side risk accounting. Opening requires finite
positive margin, and production trade simulation enforces
`size / margin <= maxLeverage`. Risk calculations use
`equity = margin + pnl` and `marginRatio = equity / size`; neither opening
nor settlement transfers margin into vault state. Margin custody remains an
implementation limitation. Production liquidation uses the same canonical
price helper as settlement, tests the strict boundary
`marginRatio < maintenanceMargin`, and reports a nonnegative claim
`max(equity, 0)`. That claim is checked against current `availableCapital`
before the atomic liquidation commit; this is an accounting guard and does
not imply that margin or any returned claim is actually held/transferred.

This does not reserve backing for unrealized positions, establish a
capital-to-capacity formula, or prove global solvency. Negative PnL credits
the accounting vault even though no margin custody/collection mechanism
proves that the trader loss was received as cash.

### Historical pre-enforcement findings

The vault maintains a simple arithmetic ledger for ordinary finite inputs:

```text
availableCapital
  = totalDeposited - traderPnL + premiums
  = getLpEquity(vault)
```

That identity is not a cash-conservation proof and does not establish
global solvency. The repository has no separate cash-transfer accounting,
no reserved backing for open positions, and no withdrawal API. `Position.margin`
is used in leverage/equity calculations and included in the reported close
claim, but it is not transferred into or accounted for by the LP vault.

The cases below describing negative realized vault capital and non-atomic
settlement document the pre-enforcement implementation and are superseded by
the current realized-settlement rule above.

This is a repository behavior audit. These exact vault fields, accounting
formulae, and lifecycle functions are **PROJECT ASSUMPTIONS**, not
paper-derived accounting requirements. The prior settlement-boundary
decision remains unresolved and is not changed here.

## 1. Canonical economic state

| Repository state | Source / use | Economic interpretation actually supported by code |
|---|---|---|
| `totalDeposited` | `LiquidityVault`; increased by initialization and `depositLP` | Cumulative nominal LP deposits. There is no withdrawal decrement or share/ownership ledger. |
| `availableCapital` | `LiquidityVault`; changed by deposits, premiums, and signed trader PnL | The accounting backing used for realized-settlement solvency checks. It is not tied to a cash balance or reserve transfer. |
| `traderPnL` | `LiquidityVault`; increased by `recordTraderPnL(vault, pnl)` | Cumulative signed realized PnL booked against LP accounting. Positive values are trader wins; negative values are trader losses. |
| `premiums` | `LiquidityVault`; increased by `addPremium` | Cumulative nominal premiums. No trade/opening path in `src/` automatically collects or transfers a premium. |
| `Position.margin` | `Position`; supplied to `simulateTrade` and stored at open | A numeric field used in leverage and equity calculations. It is not deposited into the vault or a separate margin ledger. |
| Position equity | `calculateEquity(position, pnl)` | `position.margin + pnl`; a per-position risk calculation, not a vault asset balance. |
| Unrealized PnL | `calculateUnrealizedPnL(position, price)` and `markPosition` | Calculated from position side, entry, size, and a supplied price. It is not booked to the vault by marking alone. |
| Realized PnL | `recordTraderPnL` from settlement wrappers or callers | The signed amount applied to cumulative trader PnL and available capital. It can be booked without a corresponding cash transfer. |
| Voluntary close claim | `calculatePositionSettlement` / `settleAndClosePosition` | `position.margin + pnl`, with no nonnegative floor. The claim is reported, not transferred; positive PnL must fit within available backing before commit. |
| Liquidation claim | `settleAndLiquidatePosition` and `liquidatePosition` | `max(position.margin + pnl, 0)` as reported remaining margin. Positive PnL must fit within available backing before commit. |
| Withdrawals / reserve | No implementation found in `src/` | No LP withdrawal, per-position capital reservation, or total outstanding-liability state exists. |

The repository therefore does not distinguish these concepts with separate
state:

```text
LP capital
available capital
reserved backing
accounting equity
cash actually transferable
```

`totalDeposited`, `availableCapital`, and `getLpEquity` are the only vault
capital-like values. There is no cash-in/cash-out interface, no escrowed
margin balance, and no reserved-liability field. A returned
`traderSettlement` is a calculation/result value, not proof that cash was
transferred.

## 2. Implemented vault accounting identity

[`LiquidityVault.ts`](../../src/liquidity/LiquidityVault.ts) implements:

```text
initialization:
  totalDeposited = initialDeposit
  availableCapital = initialDeposit
  traderPnL = 0
  premiums = 0

LP deposit amount x:
  totalDeposited' = totalDeposited + x
  availableCapital' = availableCapital + x

trader PnL p:
  traderPnL' = traderPnL + p
  availableCapital' = availableCapital - p

premium q:
  premiums' = premiums + q
  availableCapital' = availableCapital + q

getLpEquity:
  totalDeposited - traderPnL + premiums
```

For a normal vault state and finite successful updates:

```text
availableCapital
  = totalDeposited - traderPnL + premiums
```

This is an **accounting identity** implied by the initial values and update
rules, not an independent valuation model. `availableCapital` is mutated
directly while `getLpEquity` recomputes the expression. Tests verify equality
for selected finite deposits, premiums, and positive/negative PnL sequences.

It is not sufficient to call the expression either actual cash or a
solvency metric:

- no token/bank balance is read or transferred;
- no open-position liability is subtracted or reserved;
- no check requires the result to stay nonnegative;
- no check requires it to cover positive settlement claims; and
- a negative `availableCapital` remains representable.

For pathological numeric inputs, even the arithmetic invariant is not
protected: the validation predicates do not reject all non-finite values,
and repeated finite additions can overflow to infinity. Direct mutation of
the public vault object can also break the identity.

## 3. LP deposits

The only deposit operations found are initial construction through
`createLiquidityVault(initialDeposit)` and `depositLP(vault, amount)`.

- A successful `depositLP(x)` increments both `totalDeposited` and
  `availableCapital` by `x`.
- Calling it repeatedly is allowed; there is no deposit ID or duplicate
  transaction detection. Repeated calls are treated as repeated deposits.
- `depositLP` rejects `amount <= 0`, so zero and negative finite amounts
  fail.
- It does **not** check `Number.isFinite(amount)`: `NaN` passes the
  `amount <= 0` test and poisons both fields; positive infinity is accepted
  and makes both fields infinite.
- `createLiquidityVault` rejects `initialDeposit < 0` but does not reject
  `NaN` or positive infinity.
- There is no check against open positions or currently unsettled
  liabilities; deposits can be made while positions are open.
- Deposits do not update `MarketConfig.maxCapacity`, call the capacity gate,
  or trigger any capacity recalculation.

No capital-to-capacity formula is implemented. In particular, this audit
does not infer a formula such as `maxCapacity = LP capital / X`.

## 4. LP withdrawals

No withdrawal function or withdrawal lifecycle exists in `src/`: there is
no withdrawal request, validation, solvency test, vault decrement, LP share
accounting, or OI adjustment.

Consequently, the current code cannot execute an LP withdrawal from which
to determine whether capital needed for open-position liabilities can be
removed. It also has no explicit reserved-backing amount. Whether and how
withdrawals should work is an unresolved protocol decision, not a behavior
to infer or invent here.

## 5. Trader PnL and position margin

### Positive trader PnL

For positive PnL `p`:

```text
traderPnL' = traderPnL + p
availableCapital' = availableCapital - p
traderSettlement = position.margin + p
```

`recordTraderPnL` rejects a non-finite input `p`, but it does not reject a
positive `p` greater than available capital. The result can be
`availableCapital < 0`; no rollback or error is triggered.

### Negative trader PnL

For negative PnL `p`:

```text
traderPnL' = traderPnL + p
availableCapital' = availableCapital - p
```

Since `p < 0`, available capital increases by `abs(p)`. This is accounting
for an LP gain/ trader loss, but the code does not collect that loss from
the trader or transfer margin into the vault. Thus a losing trader PnL is
credited as if it were received even when the repository has no corresponding
cash-transfer operation.

### Margin is separate in the implementation

`simulateTrade` uses `size / margin` through `isLeverageAllowed`, and stores
the supplied margin in the `Position`. `calculateEquity` adds that margin
to PnL. However:

- opening does not call `depositLP`, transfer margin to the vault, or
  record it in a margin-custody structure;
- `LiquidityVault` has no margin field;
- `recordTraderPnL` changes the vault only by signed PnL, not by margin; and
- settlement returns a numeric `margin + pnl` claim but moves no cash.

The implementation neither establishes that margin is already included in
LP deposits nor that margin is separate collateral actually held by the
protocol. Treating it as vault capital would double-count it; treating it
as available trader cash would assume custody that is not implemented.
Accordingly, the source only supports calling it a position/risk-accounting
field.

## 6. Voluntary close settlement

The path through
[`settleAndClosePosition`](../../src/settlement/SettleAndClosePosition.ts) is:

```text
lookup position
  -> validate market symbol
  -> calculate PnL at caller-supplied currentPrice
  -> calculate traderSettlement = margin + PnL
  -> record signed PnL in vault
  -> release side OI and remove position
  -> return PnL, claim, and released size
```

The current settlement price is supplied as `currentPrice`; this audit does
not resolve or change the prior settlement-boundary decision.

The financial operation is not atomic across `LiquidityVault`,
`MarketState`, and `PositionManager`. `recordTraderPnL` mutates the vault
before `closePosition` revalidates the manager record, market, and sufficient
same-side OI. If that later validation fails:

```text
vault has booked PnL
position remains open
OI remains unchanged
close call throws
```

There is no transaction, snapshot rollback, or compensating vault update.
The recorded PnL can consequently be applied again on a later successful
close while the position still exists.

On a successful close, the position and its OI are released, but
`traderSettlement` is not transferred from a cash balance. It can be
negative (`margin + pnl < 0`) because voluntary close does not floor or
reject it. Independently, a positive PnL can exceed vault capital because
there is no vault-payability check.

`PositionSettlement.ts` also exports `settlePosition(position, currentPrice,
vault)`. It calculates and books PnL without removing a position or updating
OI, and does not mark the position settled or prevent repeated calls. A
caller can therefore book the same position's PnL more than once while that
position remains open. This helper is not an atomic close lifecycle.

## 7. Liquidation settlement

There are two materially different paths:

### `liquidatePosition` (lower-level engine)

[`LiquidationEngine.ts`](../../src/risk/LiquidationEngine.ts) marks the
caller-supplied `Position`, checks `mark.liquidatable`, and invokes
`closePosition` to release OI and remove the managed record. It returns:

```text
realizedPnL = mark.pnl
remainingMargin = max(mark.equity, 0)
```

It does **not** call `recordTraderPnL` or mutate a vault. Tests explicitly
connect its result to `recordTraderPnL` externally. Therefore calling this
function alone performs position/OI removal without vault PnL accounting.
It also marks the supplied position object, which need not be the exact
object currently registered under its ID.

### `settleAndLiquidatePosition` (financial wrapper)

[`SettleAndLiquidatePosition.ts`](../../src/settlement/SettleAndLiquidatePosition.ts)
looks up the managed position, validates its market, marks it, and rejects
a healthy position before mutation. It then:

```text
records full signed mark.pnl in the vault
  -> releases OI and removes the position
  -> returns max(margin + pnl, 0) as remaining trader claim
```

The PnL booked to the vault is the full signed PnL, regardless of the
remaining-margin floor. If PnL is positive, vault capital decreases by that
amount; if negative, vault capital increases by the loss amount. If the OI
release fails after PnL recording, the vault changes while the position
remains open, just as in voluntary close.

### Accounting differences

- Voluntary close reports `margin + pnl` without a floor; financial
  liquidation reports `max(margin + pnl, 0)`.
- Both financial wrappers record the full signed PnL in vault accounting.
- The bare liquidation engine does not record PnL in the vault.
- None of these paths transfers margin or settlement cash.
- There is no liquidation penalty, keeper reward, or insurance fund in this
  accounting path, and none is assumed here.

The floor on the liquidation claim prevents a negative reported remaining
margin, but it does not change the full negative PnL credited to the LP
vault. The repository has no explicit accounting entry for any shortfall
between trader collateral and the loss credited to LPs.

## 8. Negative PnL and positive-PnL insolvency

### Negative PnL is booked, not collected

For example, a position with a nominal 20,000 loss causes:

```text
recordTraderPnL(vault, -20_000)
  -> traderPnL decreases by 20_000
  -> availableCapital increases by 20_000
```

The repository's arithmetic does this. It does not demonstrate a 20,000
transfer from the trader's margin or any other asset. `position.margin`
remains a field on the position and does not get debited from a custody
account. Any interpretation of the credit as realized cash received is
therefore a project accounting assumption, not an implemented transfer.

### Profit above backing

For the specified conceptual scenario:

```text
initial LP capital = 50,000
position size = 30,000
entryPrice ≈ 97.64
settlement price = 100
LONG PnL ≈ (100 - 97.64) * 30,000 = 70,800
```

Using exactly 97.64 gives 70,800; using a nearby entry gives the
correspondingly nearby profit. With 70,800 PnL and a vault initialized at
50,000:

```text
traderPnL = 70,800
availableCapital = 50,000 - 70,800 = -20,800
getLpEquity(vault) = -20,800
```

**Can the current financial close settle this profit? Yes, as bookkeeping.**
`recordTraderPnL` accepts this finite PnL without checking available capital,
and the close wrapper does not check vault solvency. If the position and OI
are otherwise consistent and the close succeeds, it removes the position,
releases OI, returns `margin + 70,800` as the trader settlement result, and
leaves the vault's accounting capital at -20,800. The actual cash payment is
not implemented, so this is not evidence that the amount can be transferred.

No current invariant prevents:

```text
positive trader PnL > LP backing
availableCapital < 0
```

The repository explicitly tests negative `availableCapital` after a
100,000-profit settlement against 50,000 initial vault capital in
[`endToEndSettlement.test.ts`](../../tests/endToEndSettlement.test.ts). That
test demonstrates permissive accounting behavior, not an acceptable or
solvent economic outcome.

## 9. Solvency versus economic security

These are separate properties:

```text
SOLVENCY:
  maximum protocol payout <= LP backing

ECONOMIC SECURITY:
  cost of TWAP manipulation > extractable profit
```

The vault arithmetic proves neither.

- `availableCapital = totalDeposited - traderPnL + premiums` is an
  accounting relation, not an upper bound on trader payout.
- There is no outstanding positive-PnL liability/reserve calculated from
  open positions and no rejection when payout exceeds backing.
- The attack experiments compare modeled external manipulation cost with
  selected modeled extraction scenarios; they do not enforce vault
  solvency, and this vault contains no attack-cost state.
- A negative vault accounting balance is allowed even if an attack was
  expensive; an economically unattractive attack would not make the
  settlement payable.
- A solvent vault balance would not by itself establish that manipulation
  cost exceeds profit.

The prior conditional inequality

```text
maximum aggregate positive PnL <= available LP backing
```

is **UNPROVEN** as a repository invariant and has counterexamples to
enforcement: settlement can reduce available capital below zero. The
conditional capacity expression

```text
DeltaP_max * maxCapacity <= LP backing
```

is also **UNPROVEN** as an enforced rule. `DeltaP_max` is not enforced in
settlement, and no deposit or vault operation derives or validates
`maxCapacity` from capital. A design document stating the inequality does
not cause the code to enforce it.

## 10. Settlement accounting and multiple positions

For a completed position with PnL `p`, the vault bookkeeping changes by:

```text
delta traderPnL = p
delta availableCapital = -p
delta getLpEquity = -p
```

Ignoring deposits, premiums, and unsupported cash/margin transfers, a set
of completed positions with already-fixed PnLs `p_i` produces:

```text
vault change = -sum(p_i)
```

The implemented `premiums` term changes available capital by `+q` when
`addPremium(q)` is called; there is no automatic premium collection tied to
trades. Deposits change the capital base separately. It is therefore more
precise to say the supported ledger rule is:

```text
availableCapital
  = totalDeposited
    - cumulative booked traderPnL
    + cumulative recorded premiums
```

It is not a complete two-sided trader/LP settlement identity. Trader
`margin + pnl` results are not debited from a vault cash balance, losses are
not collected from margin, and there is no claim/share state for LPs.

For a fixed set of PnL values and successful `recordTraderPnL` calls, the
mathematical sum is order-independent. In JavaScript `Number` arithmetic,
different accumulation orders can differ by rounding, and updates are not
transactional. More importantly, actual per-position PnL need not be fixed
when settlement prices are recomputed from skew-changing market state; that
price-snapshot/order issue remains unresolved and is not decided here.

For positions LONG A, LONG B, SHORT C, and SHORT D with respective realized
PnLs `p_A`, `p_B`, `p_C`, and `p_D`, the vault records their signed sum
regardless of side. The signs do not automatically net counterparties or
prove that one trader's loss is the asset used to pay another trader's
profit. This is cumulative LP bookkeeping only.

There is no implemented conservation identity of the form:

```text
trader final claim + LP final economic claim
  = initial trader assets + initial LP assets
```

The source does not specify/custody initial trader margin as an asset, track
cash transfers for trader claims or losses, or represent LP ownership
claims. PnL entries alone therefore cannot prove conservation of the
intended base asset value. No missing balance variables are inferred here.

## 11. Failed-operation atomicity

| Operation | Expected atomicity | Actual behavior | Risk |
|---|---|---|---|
| LP deposit | Either capital fields both update by a valid deposit or neither changes | For ordinary positive finite amounts, both fields increment synchronously; invalid zero/negative finite values reject first. `NaN` and positive infinity pass validation and poison fields | Invalid capital state; no transaction ledger or transfer proof |
| LP withdrawal | Validation, solvency check, and capital mutation commit together | No withdrawal operation exists | No conclusion about withdrawal safety; no implementation to enforce reserves |
| Profitable close | Vault PnL, position removal, and OI release commit together | Vault PnL is recorded first; then OI/position close is attempted | If close fails, profit is booked while position remains open; over-backing profit is accepted |
| Losing close | Vault PnL credit and position/OI close commit together | Full negative PnL increases available capital before close is attempted; no loss collection occurs | Failed close leaves credit booked against an open position; successful bookkeeping may represent an uncollected receivable as capital |
| Liquidation (bare engine) | Eligibility, PnL accounting, OI release, and removal commit together | Marks supplied position and closes/release OI; does not update vault | Position can be removed without vault PnL accounting unless caller separately books it |
| Liquidation (financial wrapper) | Vault PnL, OI release, and removal commit together | Records full signed PnL before `closePosition`; no rollback if close fails | Vault can book PnL while position remains; no cash transfer or solvency guard |
| Failed settlement validation | No financial or position/OI state changes | Missing/wrong-market and invalid/non-finite PnL generally fail before vault mutation; after PnL booking, later OI failure is not atomic | Validation order determines whether a thrown call has already changed vault |
| Failed OI release after PnL booking | No vault, position, or OI state changes | Vault has already changed; `closePosition` throws on insufficient same-side OI or market mismatch | Cross-object state divergence and possible duplicate PnL on retry |

The common state participants are three independently mutable objects:

```text
LiquidityVault
PositionManager
MarketState
```

No transaction or rollback layer commits them together. The voluntary close
and financial liquidation wrappers have an explicit cross-object partial
commit path.

## 12. Formal invariant status

Statuses cover the exposed repository behavior. **PROVEN** is limited to
the stated arithmetic/domain; it is not inferred solely from passing tests.

| Invariant | Status | Evidence | Risk |
|---|---|---|---|
| LP accounting identity: `availableCapital = totalDeposited - traderPnL + premiums` | **PARTIALLY PROVEN** | Follows from valid initialization and ordinary finite update rules; selected tests assert it. Public mutable fields and non-finite deposit/premium inputs can break it | Ledger may become non-finite or inconsistent |
| `availableCapital` reflects booked trader PnL | **PARTIALLY PROVEN** | `recordTraderPnL` increments cumulative PnL and subtracts it from capital | Reflects bookkeeping only, not cash transfer or outstanding PnL |
| Realized positive PnL cannot exceed backing | **ENFORCED** | `prepareTraderPnL` rejects a resulting negative `availableCapital`; close, liquidation, and direct `recordTraderPnL` share this preparation path | Does not reserve backing for unrealized claims or prove actual cash custody |
| Negative PnL credits vault correctly | **PARTIALLY PROVEN** | Signed arithmetic adds `abs(p)` to `availableCapital` | No trader loss/margin collection supports the credit as cash |
| Margin is accounted exactly once | **UNPROVEN** | Margin is used in leverage/equity and returned in `margin + pnl`; it is not held or represented in vault state | Could be omitted from backing or double-counted by any external interpretation |
| Successful realized settlement leaves nonnegative backing | **ENFORCED** | PnL preparation rejects negative resulting `availableCapital`; equality to zero succeeds | Publicly mutable vault fields and non-settlement operations are not a custody guarantee |
| Voluntary settlement is atomic | **ENFORCED** | Solvency validation runs during preparation, before atomic lifecycle/OI/vault commit | None within the implemented in-memory state boundary |
| Financial liquidation settlement is atomic | **ENFORCED** | The same prepared-PnL and atomic commit path is used for liquidation | Liquidation can fail for insufficient realized backing; no alternative funding mechanism is defined |
| Outstanding liability is backed | **UNPROVEN** | No open-liability reserve or per-position payout aggregation exists | Future claims from open positions have no enforced reserve |
| Deposits preserve accounting | **PARTIALLY PROVEN** | Finite positive deposit increments both deposit and available-capital values; no capital-to-capacity link | Non-finite values pass checks; deposits do not establish solvency/capacity |
| Withdrawals preserve solvency | **UNPROVEN** | No withdrawal implementation exists | No supported behavior to assess or invariant to verify |
| Aggregate PnL is order-independent | **PARTIALLY PROVEN** | Fixed signed PnL additions are mathematically commutative | Floating-point rounding, failure order, and skew-dependent settlement prices can make outcomes order-sensitive |

## 13. Minimum protocol decisions before implementation

At minimum, the protocol must decide:

1. **Meaning of vault capital:** whether the vault is intended to represent
   accounting equity, immediately transferable cash, or both, and what
   asset/custody mechanism backs it.
2. **Margin ownership and transfer:** whether position margin is actual
   trader collateral, how it is held, and how realized trader losses are
   collected. Do not count margin as vault capital without an explicit
   accounting path.
3. **Liability reservation and solvency enforcement:** whether open positions
   reserve backing and what operation prevents/handles payout exceeding
   backing. No capital-to-capacity ratio is inferred here.
4. **Settlement commit semantics:** whether vault PnL, position status, and
   OI release must be atomic, including behavior after failed OI release.
5. **Liquidation accounting path:** whether the lower-level result-only
   engine or the vault-settling wrapper is canonical, and how their
   different PnL-recording behavior is reconciled.
6. **LP deposits and withdrawals:** validate deposit numeric domain and
   decide whether withdrawals will exist and, if so, define their treatment
   of outstanding liabilities. No withdrawal rule is selected here.
7. **PnL and settlement claims:** define whether trader settlement values
   are claims, actual transfers, or risk calculations, including the
   difference between negative voluntary-close claims and floored
   liquidation claims.
8. **Price timing:** define whether settlement PnL uses one price snapshot
   or a price recomputed after OI/skew changes. This remains separate from
   the unresolved settlement-boundary design.
9. **Paper-supported scope:** confirm the paper's actual balance-sheet,
   margin, and settlement requirements from an authoritative paper source;
   repository prototype conventions alone cannot establish them.

## Final conclusion

The vault remains bookkeeping rather than a complete economic balance
sheet. Realized settlement PnL is now checked against `availableCapital`
atomically, but there is no margin custody, outstanding-liability reserve,
or cash-transfer accounting. This proves only the implemented
realized-settlement accounting invariant, not global or actual-cash
solvency. Withdrawal semantics remain outside the implementation because
there is no withdrawal API.

```text
REALIZED SETTLEMENT ACCOUNTING SOLVENCY: ENFORCED
GLOBAL / CUSTODY SOLVENCY: UNPROVEN
```

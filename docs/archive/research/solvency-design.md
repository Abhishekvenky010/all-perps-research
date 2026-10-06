# 1. Start From the Required Invariant

Fundamental invariant:

```text
For every reachable protocol state and every allowed settlement price:

Maximum protocol payout to traders <= available LP backing
```

Definitions:

- LP capital / LP backing
  - PROJECT ASSUMPTION: current prototype backing is `LiquidityVault.availableCapital` / `getLpEquity`, supplied by LP deposits plus premiums and minus realized trader PnL.

- Trader liability
  - PROJECT ASSUMPTION: trader liability to LPs is zero when trader PnL is positive; LP liability to traders is positive trader PnL.

- Maximum trader payout
  - PROJECT ASSUMPTION: for solvency design, this is the maximum positive PnL that all open traders can realize at allowed settlement prices.

- Market capacity
  - PROJECT ASSUMPTION: `maxCapacity` bounds total open interest:

```text
totalOI = longOI + shortOI
totalOI <= maxCapacity
```

- Allowed settlement-price movement
  - PROJECT ASSUMPTION: a finite bound on favorable movement between a position's entry price and the protocol-derived settlement price:

```text
abs(settlementPrice - entryPrice) <= DeltaP_max
```

Capacity alone is insufficient because it bounds size, not price movement:

```text
PnL = size * favorablePriceMove
```

Even if:

```text
size <= maxCapacity
```

LP liability is unbounded unless:

```text
favorablePriceMove
```

is also bounded.

PAPER-SUPPORTED: the All Perps problem statement motivates bounded extractable profit through attack-cost economics.  
PROJECT ASSUMPTION: the exact LP vault solvency invariant and `DeltaP_max` parameter are not specified by the paper in this repository.

# 2. Freeze the Price Semantics

Opening is unchanged:

```text
ammTwapPrice
  -> getAverageExecutionPrice()
  -> Position.entryPrice
```

PAPER-SUPPORTED: the protocol research cares about TWAP manipulation economics.  
PROJECT ASSUMPTION: `ammTwapPrice` and `getAverageExecutionPrice()` are the prototype's canonical opening path.

Candidate mark / settlement sources:

| Choice | Meaning | Manipulable? | Bounded liability? | All Perps compatibility | Attack-cost argument |
|---|---|---:|---:|---|---|
| A. raw `ammTwapPrice` | 15-minute arithmetic AMM TWAP | Yes, through TWAP manipulation | No, unless TWAP movement is bounded | Compatible with TWAP-focused research | Directly aligned, but needs attack-cost model |
| B. `getCurrentAmmPrice()` | `ammTwapPrice` adjusted by current skew | Yes, via TWAP and protocol skew | No, unless TWAP/settlement movement is bounded | Compatible with current AMM state machine | Preserves skew feedback and TWAP attack model |
| C. external/index price | Reference field `indexPrice` | Undefined | No, unless index movement is bounded | Not authoritative in current implementation | Weakly connected to current attack experiments |
| D. another repo-defined price | None currently specified | Undefined | Undefined | Not available | Not available |

Chosen canonical model for the prototype:

```text
settlementMarkPrice = getCurrentAmmPrice(market, config)
```

for both voluntary close and liquidation.

This choice is a PROJECT ASSUMPTION. The paper/problem statement in this repository does not dictate this exact settlement source. It is chosen because it is the only current repository-defined price that:

- comes from the AMM/TWAP path;
- incorporates skew;
- is already used by `runLiquidationSweep`;
- avoids introducing a new oracle mechanism;
- keeps the economic-security question tied to TWAP manipulation cost.

This choice alone does not make solvency provable. It must be paired with a finite allowed settlement movement bound.

# 3. Define Settlement Price Authority

Required authority model:

```text
settlementPrice = getCurrentAmmPrice(market, config)
```

The protocol, not the caller, computes settlement price.

Required state:

- `MarketState.ammTwapPrice`
- `MarketState.longOpenInterest`
- `MarketState.shortOpenInterest`
- `MarketConfig.maxCapacity`
- `MarketConfig.skewCoefficient`

Required oracle/TWAP:

- PROJECT ASSUMPTION: use the current arithmetic 15-minute `ammTwapPrice` already implemented by `TWAPOracle`.

Caller authority:

- The caller may request close or liquidation.
- The caller must not supply trusted `currentPrice`.

Validation required:

```text
settlementPrice is finite
settlementPrice > 0
abs(settlementPrice - position.entryPrice) <= DeltaP_max
```

Close and liquidation:

- PROJECT ASSUMPTION: voluntary close and liquidation use the same price source.
- Liquidation also checks margin health at the same derived mark.

This is necessary for solvency because caller-controlled `currentPrice` lets a caller choose the exact variable that determines LP payout:

```text
LP payout = max(PnL(currentPrice), 0)
```

No solvency proof can hold if an untrusted caller controls settlement price.

# 4. Derive Maximum Trader Liability

For one position:

```text
abs(settlementPrice - entryPrice) <= DeltaP_max
size > 0
```

LONG:

```text
PnL_long = (settlementPrice - entryPrice) * size

maximumPositivePnL_long
  = max(PnL_long, 0)
  <= size * DeltaP_max
```

SHORT:

```text
PnL_short = (entryPrice - settlementPrice) * size

maximumPositivePnL_short
  = max(PnL_short, 0)
  <= size * DeltaP_max
```

All open positions:

```text
maximumPositivePnL_all
  <= sum(position.size * DeltaP_max)
  = DeltaP_max * totalOI
```

Because:

```text
totalOI <= maxCapacity
```

the protocol-wide liability bound is:

```text
maximumPositivePnL_all <= DeltaP_max * maxCapacity
```

If the design instead uses explicit global price bounds:

```text
P_min <= settlementPrice <= P_max
```

then:

```text
LONG liability <= size * max(P_max - entryPrice, 0)
SHORT liability <= size * max(entryPrice - P_min, 0)
```

The entry-relative `DeltaP_max` form is the minimum proof parameter because it directly bounds the PnL formula currently implemented.

PROJECT ASSUMPTION: `DeltaP_max` must be set by the prototype before implementation. The paper in this repository does not supply its value.

# 5. Connect Capacity to Solvency

From Section 4:

```text
maximumPositivePnL_all <= DeltaP_max * maxCapacity
```

Solvency requires:

```text
DeltaP_max * maxCapacity <= available LP backing
```

Therefore:

```text
maxCapacity <= available LP backing / DeltaP_max
```

This is the derived capacity relationship.

No fixed ratio such as:

```text
LP capital = maxCapacity / 2
```

is justified unless it is equivalent to choosing a specific `DeltaP_max`.

Example:

```text
available LP backing = 50,000
maxCapacity = 100,000
```

Then solvency requires:

```text
DeltaP_max <= 50,000 / 100,000
DeltaP_max <= 0.5
```

If the project wants to allow a larger favorable movement, capacity must fall:

```text
maxCapacity <= 50,000 / DeltaP_max
```

PROJECT ASSUMPTION: `size` and price units remain the same units as the current PnL implementation, where `PnL = priceDifference * size`.

# 6. Connect This to the All Perps Security Argument

PAPER-SUPPORTED: the important economic-security condition is represented in repository research as:

```text
Cost of TWAP attack > Maximum Extractable Profit
```

Property A - protocol solvency:

```text
DeltaP_max * maxCapacity <= available LP backing
```

Property B - economic security:

```text
attackCost(priceMove) > extractableProfit(priceMove)
```

These are not the same invariant.

Solvency asks whether LPs can pay if settlement occurs.

Economic security asks whether an attacker can profit after paying to create the price movement.

Capacity must satisfy both:

```text
maxCapacity <= available LP backing / DeltaP_max
```

and, for every allowed modeled TWAP move `d`:

```text
attackCost(d) > maxCapacity * d
```

Equivalently:

```text
maxCapacity < attackCost(d) / d
```

for every `d` in the allowed movement set.

If the attack-cost model is empirical or prototype-only, then this second condition is:

```text
EMPIRICALLY TESTED ONLY
```

not a formal proof.

PROJECT ASSUMPTION: the repository's current constant-product manipulation-cost experiments are not paper-specified protocol rules.

# 7. Compare Candidate Solvency Designs

Design A - Fixed settlement-price bound

- Definition:

```text
settlementPrice is internally derived
abs(settlementPrice - entryPrice) <= DeltaP_max
```

- Simplicity: high. It directly bounds current PnL equations.
- Capital efficiency: depends on `DeltaP_max`; smaller movement bounds allow larger capacity.
- Manipulation resistance: not enough by itself. It bounds payout, but does not prove manipulation is unprofitable.
- Compatibility with paper: compatible with the paper's attack-cost framing only if economic-security checks still compare attack cost to bounded extraction.
- Classification: PROJECT ASSUMPTION.

Design B - LP-capital-derived capacity

- Definition:

```text
maxCapacity <= available LP backing / DeltaP_max
```

- Mathematical solvency: yes, if settlement movement is bounded by `DeltaP_max` and all OI is included.
- Capital efficiency: directly scales with LP backing.
- Assumptions required: finite `DeltaP_max`, internally derived settlement price, no caller-controlled settlement.
- Classification: PROJECT ASSUMPTION derived from current PnL math.

Design C - Attack-cost-derived capacity

- Definition:

```text
for every allowed move d:
  maxCapacity * d < attackCost(d)
```

- Relationship to paper: closest to the All Perps economic-security argument.
- Does it guarantee LP solvency? no. An unprofitable attack can still create a payout larger than LP backing if it happens.
- Additional condition required:

```text
maxCapacity * DeltaP_max <= available LP backing
```

- Classification: PAPER-SUPPORTED as an economic-security direction; PROJECT ASSUMPTION for exact cost model and capacity formula.

# 8. Choose the Prototype Design

Chosen minimum design:

```text
1. Opening remains:
   ammTwapPrice -> getAverageExecutionPrice -> Position.entryPrice

2. Mark and settlement use:
   getCurrentAmmPrice(market, config)

3. Caller-supplied currentPrice is not trusted.

4. Every settlement price must satisfy:
   abs(settlementPrice - position.entryPrice) <= DeltaP_max

5. Capacity must satisfy:
   maxCapacity <= available LP backing / DeltaP_max

6. Economic security remains separately checked:
   for every allowed move d:
     attackCost(d) > maxCapacity * d
```

PAPER-SUPPORTED:

- TWAP manipulation resistance matters.
- Attack cost must exceed extractable profit.
- Capacity/skew-based pricing is relevant to limiting extractable profit in the research framing.

PROJECT ASSUMPTION:

- `getCurrentAmmPrice()` is the unified mark/settlement source.
- `DeltaP_max` exists as the allowed favorable settlement movement.
- Capacity is derived from LP backing and `DeltaP_max`.
- The current arithmetic 15-minute TWAP remains the prototype TWAP.
- Close and liquidation use the same internally derived price.

This is the minimum design because it avoids adding:

- insurance funds;
- liquidation rewards;
- funding;
- LP share accounting;
- new oracle formulas;
- arbitrary payout caps detached from PnL.

It only adds the missing mathematical variable needed for solvency: a finite allowed settlement movement.

# 9. Define the Solvency Invariants

Capacity:

```text
totalOI <= maxCapacity
```

Formal invariant.

LP solvency:

```text
DeltaP_max * totalOI <= available LP backing
```

or conservatively:

```text
DeltaP_max * maxCapacity <= available LP backing
```

Formal invariant if `DeltaP_max` is fixed.

Settlement bound:

```text
settlementPrice = getCurrentAmmPrice(market, config)
settlementPrice > 0
isFinite(settlementPrice)
abs(settlementPrice - position.entryPrice) <= DeltaP_max
```

Formal invariant if implemented.

No arbitrary caller settlement:

```text
close and liquidation derive settlementPrice internally
caller does not supply trusted currentPrice
```

Formal invariant if implemented.

Economic security:

```text
for every modeled allowed TWAP move d:
  attackCost(d) > maxExtractableProfit(d)
```

Status: EMPIRICALLY TESTED ONLY until the attack-cost model and allowed movement set are specified as protocol rules.

Price-source consistency:

```text
voluntary close and liquidation use the same canonical mark/settlement source
```

Formal invariant if implemented.

# 10. Stress the Model

Existing failing scenario:

```text
LP capital = 50,000
maxCapacity = 100,000
manipulated TWAP = 95
recovery = 100
position size = 30,000
entry ~= 97.64
trader profit ~= (100 - 97.64) * 30,000
trader profit ~= 70,700
```

Why the current model fails:

```text
totalOI = 30,000 <= 100,000
```

but:

```text
traderProfit ~= 70,700 > 50,000 LP capital
```

Capacity bounded size, but not favorable settlement movement.

Under the proposed design, there are two ways to prevent the same liability:

1. Keep `maxCapacity = 100,000`.

Then:

```text
DeltaP_max <= LP backing / maxCapacity
DeltaP_max <= 50,000 / 100,000
DeltaP_max <= 0.5
```

The scenario's favorable move is:

```text
100 - 97.64 ~= 2.36
```

Since:

```text
2.36 > 0.5
```

the settlement movement is outside the allowed solvency range.

2. Keep the scenario's favorable move around `2.36`.

Then:

```text
maxCapacity <= 50,000 / 2.36
maxCapacity <= ~21,186
```

A `30,000` position would exceed the capacity implied by available LP backing and the allowed movement.

Therefore the proposed design either rejects the settlement movement under the chosen capacity, or requires a lower capacity before the position can be opened.

# 11. Do NOT Implement

This checkpoint is design only.

No TypeScript source was modified by this design.

This document does not add:

- liquidation incentives;
- insurance funds;
- LP share tokens;
- new contracts;
- funding;
- new oracle formulas;
- source-code price caps;
- source-code settlement logic.

Implementation must come later only after the project accepts the PROJECT ASSUMPTION parameters:

- unified settlement price source;
- `DeltaP_max`;
- capacity derivation;
- treatment when the derived settlement mark is outside the allowed range.

# 12. Final Section

## Solvency Design Verdict

1. What is the authoritative opening price?

`Position.entryPrice`, derived from:

```text
ammTwapPrice -> getAverageExecutionPrice() -> average entry
```

PROJECT ASSUMPTION based on current implementation.

2. What is the authoritative mark price?

`getCurrentAmmPrice(market, config)`.

PROJECT ASSUMPTION. It is current liquidation-sweep behavior, not paper-specified.

3. What is the authoritative settlement price?

`getCurrentAmmPrice(market, config)`, internally derived at settlement time.

PROJECT ASSUMPTION.

4. Can a caller choose settlement price?

No under the design. Caller-controlled `currentPrice` must be removed as trusted authority.

5. What bounds maximum trader liability?

The finite allowed favorable movement:

```text
abs(settlementPrice - entryPrice) <= DeltaP_max
```

so:

```text
maximum trader liability <= DeltaP_max * totalOI
```

6. What mathematical relationship determines capacity?

```text
maxCapacity <= available LP backing / DeltaP_max
```

and for economic security:

```text
for every allowed move d:
  maxCapacity * d < attackCost(d)
```

7. Does LP capital alone provide the backstop?

Yes in the current prototype design. PROJECT ASSUMPTION.

8. How does the design preserve `attack cost > extractable profit`?

It preserves it as a separate condition by bounding extractable profit:

```text
maximumExtractableProfit(d) <= maxCapacity * d
```

and requiring the modeled attack cost to exceed that value for every allowed movement.

9. Which parts are paper-supported?

- TWAP manipulation economics matter.
- Attack cost should exceed extractable profit.
- Skew/capacity pricing is part of the project's All Perps-inspired research direction.

10. Which parts are project assumptions?

- `getCurrentAmmPrice()` as the unified mark and settlement source.
- `DeltaP_max` as a finite allowed favorable settlement movement.
- Capacity derived from LP backing and `DeltaP_max`.
- Current arithmetic 15-minute TWAP as the prototype TWAP.
- LP vault as the sole backstop.

11. What exact invariants must the implementation enforce?

```text
totalOI <= maxCapacity

settlementPrice = getCurrentAmmPrice(market, config)

caller cannot supply trusted settlement price

isFinite(settlementPrice) && settlementPrice > 0

abs(settlementPrice - position.entryPrice) <= DeltaP_max

DeltaP_max * totalOI <= available LP backing

DeltaP_max * maxCapacity <= available LP backing

for modeled attacks:
  attackCost(d) > maxCapacity * d
```

The final attack-cost invariant is EMPIRICALLY TESTED ONLY until the attack-cost model is made a protocol rule.

12. Is the prototype now mathematically capable of a solvency proof?

Yes, conditionally. With `DeltaP_max` fixed and settlement price internally derived, the prototype has a finite liability bound and a capacity relationship:

```text
maximum payout <= DeltaP_max * maxCapacity <= available LP backing
```

Without accepting `DeltaP_max` and the settlement authority rule, it remains not provable.

```text
SOLVENCY STATUS: PROVABLE
```

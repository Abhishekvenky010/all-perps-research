# Protocol Behavior in the Prototype

This document describes behavior present in the current repository. The
specific equations and parameter values are prototype choices; they are not
asserted here as authoritative specifications of the All Perps design.

## Market capacity and opening

The canonical trade path checks total open interest against configured
`maxCapacity` (`K`). An accepted trade cannot increase total OI above `K`.
Opening stages OI in steps and records the average of the resulting execution
quotes. The quotes incorporate the current TWAP, signed market skew, and
capacity impact; this is not a fixed-price fill with a separate fee.

Leverage is checked as position size divided by margin:

```text
leverage = size / margin
```

Margin is supplied as a number to the simulator. It is not debited from a
trader balance or held as collateral.

## Reference price and AMM mark

The reference-price service validates timestamped observations and updates a
900-second arithmetic time-weighted TWAP. The pricing model uses that value
with current OI skew and configured coefficients. It is deterministic for a
fixed market state, configuration, side, and trade size.

An observation-source interface exists, but the repository does not
authenticate a real provider or connect an external AMM pool to that source.

## Positions, PnL, and liquidation

The position manager records open positions and OI changes. LONG and SHORT
PnL are signed oppositely around the entry and settlement prices. Margin
ratio is evaluated by the risk modules; liquidation eligibility uses a
strictly-below-maintenance comparison.

## Canonical settlement

The canonical settlement-price helper validates the position and market,
subtracts the position's stored size from its own side in a copied market
state, and derives the mark from that counterfactual state. Other open
positions continue to contribute to skew. The helper does not mutate the
market, position, or vault.

Voluntary close and liquidation derive their settlement price internally.
They prepare PnL and vault accounting, check relevant backing/solvency
conditions, and commit the individual lifecycle transition atomically.
Caller-priced simulation settlement is a separate experimental helper and is
not the canonical lifecycle.

## Vault scope

The vault tracks numeric capital and PnL accounting. Deposits do not mint LP
shares; there is no LP withdrawal or redemption claim, no transfer of tokens,
and no formal rule coupling capital to market capacity. A successful internal
accounting transition is not evidence that real collateral is held or paid.

## Insurance and fees

The prototype has no insurance fund. Do not infer an insurance backstop,
funding payment, keeper incentive, token transfer, or trading fee where the
code does not implement one.

For the exact modeled attacker lifecycle and the boundaries of the resulting
claims, see [economic-security.md](economic-security.md) and
[limitations.md](limitations.md).

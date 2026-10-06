# All Perps Research Prototype

## Problem

Long-tail assets can have spot markets without permissionless perpetual
markets. Centralized exchange listings and professional market-making do not
scale to every asset, leaving many markets without continuous leveraged
exposure.

## Prototype

This repository is an **All Perps-inspired bounded-capacity perpetual AMM
research prototype** implemented in TypeScript. It is a local reference and
simulation model, not a deployed protocol or production-ready exchange.

Its modeled lifecycle is:

```text
reference observations / TWAP
  -> skew-aware AMM pricing
  -> bounded open interest
  -> position, margin, and PnL
  -> liquidation or canonical close
  -> LP-vault accounting
```

The prototype explores bounded market capacity, progressive skew pricing,
passive LP exposure, and a vault modeled as the counterparty to trader PnL.
There is no insurance fund. Pricing is deterministic for a given state and
configuration. The vault is numeric accounting only: LP share issuance,
withdrawal, collateral custody, and asset transfers are not implemented.

Settlement pricing excludes the position being settled from its own open
interest contribution. It computes the mark from a copied, counterfactual
market state while preserving other positions' skew. This prevents a position
from raising or lowering its own settlement mark through its own OI.

## Validation

The tests cover OI/capacity invariants, pricing, the position lifecycle,
margin and liquidation, canonical settlement, vault backing checks,
atomicity, and the local oracle/TWAP pipeline. Economic scenarios exercise
selected modeled attacks; they are not a global security proof.

```sh
npm test
npx tsc --noEmit
```

See [docs/protocol.md](docs/protocol.md) for implemented behavior,
[docs/architecture.md](docs/architecture.md) for code paths,
[docs/economic-security.md](docs/economic-security.md) for the attack model,
and [docs/limitations.md](docs/limitations.md) for unresolved work.

> **Economic security is UNPROVEN.** The target is
> `C_min(z) > P_max(z; B, K)` for the same manipulated reference-price path.
> Existing manipulation costs are model proxies; finite simulations do not
> establish this inequality for every admissible path.

> **Research prototype — not production-ready.**

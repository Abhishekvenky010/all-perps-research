# Limitations and Unproven Properties

This repository is a research prototype and is not production-ready.

## Incomplete production boundaries

- The external reference-price source is represented by an interface and
  simulation helpers. There is no authenticated provider, aggregation policy,
  or complete external-market integration.
- The model does not establish that manipulating an external AMM changes the
  reference observations consumed by the TWAP.
- The constant-product attack-cost model is a proxy. It does not model an
  attacker's complete hold, arbitrage, unwind, fees, financing, inventory,
  or recovery strategy.
- The vault is numeric in-memory accounting. Actual collateral custody,
  margin transfers, and token payments are not implemented.
- LP deposits do not issue shares; LP withdrawal/redemption claims are not
  implemented.
- There is no formally derived or enforced relationship between LP capital
  and market capacity.
- There is no insurance fund.
- Local TypeScript state and module calls do not provide production
  authorization or hostile-caller isolation.

## Economic-security status

- A global maximum extractable profit is not proven.
- A global minimum manipulation cost is not proven.
- The condition `C_min(z) > P_max(z; B, K)` is not proven for every admissible
  path `z`.
- The finite cost proxy is not a lower bound on minimum net attack cost.
- Accounting solvency of the in-memory vault is not equivalent to complete
  economic solvency or payment from real assets.

The proof gap requires a complete external-market/oracle path, a model of
observation control and the attacker's net unwind economics, explicit
liquidation timing and collateral constraints, and global optimization of
attainable extraction under capacity and backing. The current repository
does not supply these.

Implementation tests, economic simulations, and a formal economic-security
proof are distinct evidence categories. Passing the first and observing
finite outcomes in the second do not establish the third.

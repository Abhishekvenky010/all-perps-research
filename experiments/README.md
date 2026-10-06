# Research Experiments

The small set of experiments at this directory's top level supports the
current research story:

| File | Question | Model and limitation |
|---|---|---|
| `implementedEconomicSecurity.ts` | What happens through the current reference/TWAP, open, risk, settlement, and vault-accounting path for sampled scenarios? | Local simulated observations and a modeled vault; the finite matrix is not a global proof. |
| `manipulationCostModel.ts` | What spot-cost proxy follows from the assumed constant-product pool and selected TWAP path? | Repeated one-way slippage proxy, not minimum net manipulation cost. |
| `twapManipulation.ts` | How does the local arithmetic TWAP respond to a selected observation path? | Oracle arithmetic only; does not establish an external-AMM-to-oracle connection. |
| `riskFeedbackLoop.ts` | How do mark, margin, liquidation, OI release, and capacity recovery interact in a simulation? | Deterministic scenario, not a complete economic-market model. |

Other scripts are preserved under `archive/` and are not part of the
founder-facing experiment surface. Run a retained scenario with `npx tsx
experiments/<file>.ts`. Some scripts write generated output under `results/`;
that output is intentionally not versioned as protocol evidence.

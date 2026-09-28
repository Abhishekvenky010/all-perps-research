1. Problem Statement

Traditional perpetual exchanges need to handle:

- directional imbalance
- market capacity
- trader risk
- liquidation

A market with excessive LONG or SHORT demand can expose the protocol to large inventory risk.

2. Prototype Objective

Build a prototype AMM that adjusts pricing based on:

1. Market skew
2. Capacity utilization

and study whether these mechanisms:

- discourage excessive imbalance
- maintain bounded exposure
- allow market recovery

3. Architecture

                 Trade Request
                       |
                       v

              Trade Simulator

                       |
        +--------------+--------------+
        |                             |
        v                             v

   AMM Pricing                  Risk Engine

        |                             |
        |                             |
        v                             v

 Market State                Margin / Liquidation

                       |
                       v

              Position Manager

4. Pricing Model

Skew Impact

Purpose:

Control directional imbalance

Formula concept:

impact = coefficient × |skew|

Behaviour:

More imbalance
        |
        v
Higher execution cost
Capacity Impact

Purpose:

Control utilization near maximum capacity

Formula concept:

impact = coefficient × usage/(1-usage)

Behaviour:

Closer to capacity
        |
        v
Nonlinear price increase

5. Experiments

Experiment 1: Skew Impact

Question:

Does imbalance increase trading cost?

Result:

Exposure	Impact
0	0%
10k	2.56%
20k	5.25%
50k	15%
80k	36%
90k	63%

Conclusion:

Increasing directional imbalance causes increasing execution cost.
Experiment 2: Capacity Stress Test

Question:

Does the AMM prevent unlimited exposure?

Result:

100,000 exposure accepted

110,000 exposure rejected

Conclusion:

The capacity boundary prevents unlimited growth.
Experiment 3: Recovery

Question:

Can opposite trading reduce imbalance?

Result:

Initial:

LONG = 50000
SHORT = 0

After SHORT traders:

LONG = 50000
SHORT = 30000

Execution price:

90 → 92 → 94

Conclusion:

Reducing skew moves price closer to oracle.
Experiment 4: Parameter Analysis
Skew Coefficient
Coefficient	Impact
0.05	4%
0.2	16%
0.5	40%
1	80%

Finding:

Higher skew coefficient creates stronger resistance against imbalance.
Capacity Coefficient
Coefficient	Impact
0.01	4%
0.05	20%
0.1	40%
0.2	80%

Finding:

Higher capacity coefficient creates stronger resistance near utilization limits.
6. Current Limitations

Important to mention:

Current prototype is an off-chain simulation.

It does not yet model:

- oracle manipulation
- funding rates
- LP accounting
- insurance fund
- liquidation incentives
- real blockchain execution
7. Future Work

Possible extensions:

1. Funding rate mechanism

2. LP profit/loss simulation

3. More advanced AMM curves

4. Compare with existing perpetual protocols

5. On-chain implementation
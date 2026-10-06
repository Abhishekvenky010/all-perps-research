# Design Decisions


## Separate MarketState and MarketConfig

Reason:

Market state changes frequently.

Risk parameters are protocol configuration.

Keeping them separate allows multiple markets.


Example:

BTC-PERP:

capacity: 10M


SOL-PERP:

capacity: 2M


Same engine, different config.


## Why simulation before smart contracts?

The economic model should be validated before implementation.

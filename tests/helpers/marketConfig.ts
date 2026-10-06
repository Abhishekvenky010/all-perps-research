import type { MarketConfig } from "../../src/config/MarketConfig.js";

export function createMarketConfig(
  symbol = "BTC-PERP",
  overrides: Partial<MarketConfig> = {},
): MarketConfig {
  return {
    symbol,
    maxCapacity: 100_000,
    skewCoefficient: 0,
    capacityCoefficient: 0.05,
    maxLeverage: 20,
    ...overrides,
  };
}

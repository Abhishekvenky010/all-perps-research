import type { MarketState } from "../market/MarketState.js";
import type { MarketConfig } from "../config/MarketConfig.js";
import { SimulatedPriceFeed } from "../oracle/SimulatedPriceFeed.js";

export interface SimulationEnvironment {
  market: MarketState;
  config: MarketConfig;
  priceFeed: SimulatedPriceFeed;
  timestamp: number;
}

import type { MarketState } from "../market/MarketState.js";
import { SimulatedPriceFeed } from "./SimulatedPriceFeed.js";
import { updateAmmTwap } from "./TWAPOracle.js";

export function recordPriceAndUpdateTwap(
  state: MarketState,
  feed: SimulatedPriceFeed,
  price: number,
  timestamp: number,
): MarketState {
  // 1. Record the new price.
  feed.recordPrice(price, timestamp);

  // 2. Calculate the TWAP and update the market state.
  return updateAmmTwap(
    state,
    feed.getObservations(),
    timestamp,
  );
}
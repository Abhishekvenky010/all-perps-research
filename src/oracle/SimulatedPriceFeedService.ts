
import type { MarketState } from "../market/MarketState.js";
import { SimulatedPriceFeed } from "./SimulatedPriceFeed.js";
import { updateMarketFromReferencePrice } from "./ReferencePriceService.js";

// Simulation/test adapter: records a synthetic price through the same
// validated observation and TWAP rules as the reference-price pipeline.
export function recordSimulatedPriceAndUpdateTwap(
  state: MarketState,
  feed: SimulatedPriceFeed,
  price: number,
  timestamp: number,
): MarketState {
  const update = updateMarketFromReferencePrice(
    state,
    feed.getObservations(),
    {
      getLatestObservation: () => ({ price, timestamp }),
    },
    timestamp,
  );

  feed.recordPrice(price, timestamp);
  return update.market;
}
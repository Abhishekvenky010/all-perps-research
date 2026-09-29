
import { describe, it, expect } from "vitest";
import { SimulatedPriceFeed } from "../src/oracle/SimulatedPriceFeed.js";
import { recordPriceAndUpdateTwap } from "../src/oracle/PriceFeedService.js";
import type { MarketState } from "../src/market/MarketState.js";

describe("PriceFeedService", () => {
  it("updates the market TWAP after 15 minutes of observations", () => {
    const feed = new SimulatedPriceFeed();

    let state: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };

    state = recordPriceAndUpdateTwap(state, feed, 100, 0);
    state = recordPriceAndUpdateTwap(state, feed, 102, 300);
    state = recordPriceAndUpdateTwap(state, feed, 101, 600);
    state = recordPriceAndUpdateTwap(state, feed, 103, 900);

    expect(state.ammTwapPrice).toBeCloseTo(101, 5);
  });
});
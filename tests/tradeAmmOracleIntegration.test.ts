import { describe, expect, it } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";
import type { PriceObservation } from "../src/oracle/TWAPOracle.js";

import { PositionManager } from "../src/position/PositionManager.js";
import { simulateTrade } from "../src/simulation/TradeSimulator.js";

import { recordAmmPriceObservation } from "../src/oracle/AmmPriceService.js";
import { updateAmmTwap } from "../src/oracle/TWAPOracle.js";

describe("Trade → AMM → Oracle integration", () => {
  it("updates AMM price and feeds the resulting price into the TWAP", () => {
    const config: MarketConfig = {
      symbol: "BTC-PERP",
      maxCapacity: 100_000,
      skewCoefficient: 0.2,
      capacityCoefficient: 0.05,
      maxLeverage: 20,
    };

    const positionManager = new PositionManager();

    let state: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 10_000,
      shortOpenInterest: 10_000,
    };

    let observations: PriceObservation[] = [];

    // Initial AMM observation.
    observations = recordAmmPriceObservation(
      observations,
      state,
      config,
      0,
    );

    const initialPrice = observations.at(-1)?.price;

    expect(initialPrice).toBeDefined();

    // Execute a LONG trade.
    const trade = simulateTrade(
      state,
      "LONG",
      20_000,
      10,
      config,
      "trader-1",
      1_000,
      positionManager,
    );

    state = trade.finalState;

    // AMM price should have increased because long OI increased.
    observations = recordAmmPriceObservation(
      observations,
      state,
      config,
      300,
    );

    const postTradePrice = observations.at(-1)?.price;

    expect(postTradePrice).toBeDefined();

    expect(postTradePrice!).toBeGreaterThan(
      initialPrice!,
    );

    // Advance the Oracle with the new AMM price.
    state = updateAmmTwap(
      state,
      observations,
      900,
    );

    console.log("Initial AMM price:", initialPrice);
    console.log("Post-trade AMM price:", postTradePrice);
    console.log("Updated TWAP:", state.ammTwapPrice);
    console.log("Final market state:", state);

    expect(state.ammTwapPrice).toBeGreaterThan(0);
  });
});
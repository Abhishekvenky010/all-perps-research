import { describe, expect, it } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";
import type { PriceObservation } from "../src/oracle/TWAPOracle.js";

import { PositionManager } from "../src/position/PositionManager.js";
import { simulateTrade } from "../src/simulation/TradeSimulator.js";

import { recordSimulatedProtocolMarkObservation } from "../src/oracle/SimulatedProtocolMarkObservation.js";
import { updateAmmTwap } from "../src/oracle/TWAPOracle.js";

describe("Trade → simulated protocol-mark feedback integration", () => {
  it("feeds the trade-responsive protocol mark into a simulation TWAP", () => {
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
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };
    positionManager.openPosition({
      id: "existing-long",
      trader: "existing-long",
      market: state.symbol,
      side: "LONG",
      size: 10_000,
      entryPrice: 100,
      margin: 1_000,
    }, state);
    positionManager.openPosition({
      id: "existing-short",
      trader: "existing-short",
      market: state.symbol,
      side: "SHORT",
      size: 10_000,
      entryPrice: 100,
      margin: 1_000,
    }, state);

    let observations: PriceObservation[] = [];

    // Initial AMM observation.
    observations = recordSimulatedProtocolMarkObservation(
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
    observations = recordSimulatedProtocolMarkObservation(
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
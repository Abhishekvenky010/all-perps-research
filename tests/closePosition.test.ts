import { describe, expect, it } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";

import { PositionManager } from "../src/position/PositionManager.js";
import { closePosition } from "../src/position/ClosePosition.js";

describe("Normal position close", () => {
  it("releases market capacity when a LONG position is closed", () => {
    const market: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 20_000,
      shortOpenInterest: 0,
    };

    const positionManager = new PositionManager();

    positionManager.openPosition({
      id: "position-1",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG",
      size: 20_000,
      entryPrice: 100,
      margin: 1_000,
    });

    const closed = closePosition(
      "position-1",
      market,
      positionManager,
    );

    expect(closed.id).toBe("position-1");

    expect(market.longOpenInterest).toBe(0);

    expect(
      positionManager.getPosition("position-1"),
    ).toBeUndefined();
  });

  it("releases market capacity when a SHORT position is closed", () => {
    const market: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 0,
      shortOpenInterest: 20_000,
    };

    const positionManager = new PositionManager();

    positionManager.openPosition({
      id: "position-2",
      trader: "Bob",
      market: "BTC-PERP",
      side: "SHORT",
      size: 20_000,
      entryPrice: 100,
      margin: 1_000,
    });

    closePosition(
      "position-2",
      market,
      positionManager,
    );

    expect(market.shortOpenInterest).toBe(0);

    expect(
      positionManager.getPosition("position-2"),
    ).toBeUndefined();
  });

  it("rejects closing a position that does not exist", () => {
    const market: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 20_000,
      shortOpenInterest: 0,
    };

    const positionManager = new PositionManager();

    expect(() => {
      closePosition(
        "missing-position",
        market,
        positionManager,
      );
    }).toThrow("POSITION_NOT_FOUND");
  });
});
import { describe, expect, it } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { Position } from "../src/position/Position.js";

import { PositionManager } from "../src/position/PositionManager.js";
import { closePosition } from "../src/position/ClosePosition.js";
import { liquidatePosition } from "../src/risk/LiquidationEngine.js";

function calculateOpenInterest(
  positions: Position[],
) {
  let longOpenInterest = 0;
  let shortOpenInterest = 0;

  for (const position of positions) {
    if (position.side === "LONG") {
      longOpenInterest += position.size;
    } else {
      shortOpenInterest += position.size;
    }
  }

  return {
    longOpenInterest,
    shortOpenInterest,
  };
}

describe("Position / Market OI consistency", () => {
  it("keeps market OI equal to the sum of open positions", () => {
    const market: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };

    const positionManager = new PositionManager();

    const long1: Position = {
      id: "long-1",
      trader: "alice",
      market: "BTC-PERP",
      side: "LONG",
      size: 10_000,
      entryPrice: 100,
      margin: 2_000,
    };

    const long2: Position = {
      id: "long-2",
      trader: "bob",
      market: "BTC-PERP",
      side: "LONG",
      size: 20_000,
      entryPrice: 100,
      margin: 4_000,
    };

    const short1: Position = {
      id: "short-1",
      trader: "charlie",
      market: "BTC-PERP",
      side: "SHORT",
      size: 5_000,
      entryPrice: 100,
      margin: 1_000,
    };

    positionManager.openPosition(long1);
    positionManager.openPosition(long2);
    positionManager.openPosition(short1);

    market.longOpenInterest = 30_000;
    market.shortOpenInterest = 5_000;

    let calculated = calculateOpenInterest(
      positionManager.getAllPositions(),
    );

    expect(calculated.longOpenInterest).toBe(
      market.longOpenInterest,
    );

    expect(calculated.shortOpenInterest).toBe(
      market.shortOpenInterest,
    );

    closePosition(
      long1.id,
      market,
      positionManager,
    );

    calculated = calculateOpenInterest(
      positionManager.getAllPositions(),
    );

    expect(calculated.longOpenInterest).toBe(
      market.longOpenInterest,
    );

    expect(calculated.shortOpenInterest).toBe(
      market.shortOpenInterest,
    );

    expect(market.longOpenInterest).toBe(20_000);
    expect(market.shortOpenInterest).toBe(5_000);
  });
  it("keeps OI consistent after liquidation", () => {
  const market: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: 100,
    longOpenInterest: 100,
    shortOpenInterest: 0,
  };

  const positionManager = new PositionManager();

  const position: Position = {
    id: "liquidation-long",
    trader: "alice",
    market: "BTC-PERP",
    side: "LONG",
    size: 100,
    entryPrice: 100,
    margin: 100,
  };

  positionManager.openPosition(position);

  const result = liquidatePosition(
    position,
    99,
    market,
    positionManager,
    0.05,
  );

  expect(result.closed).toBe(true);

  expect(
    positionManager.getPosition(position.id),
  ).toBeUndefined();

  expect(market.longOpenInterest).toBe(0);

  const calculated = calculateOpenInterest(
    positionManager.getAllPositions(),
  );

  expect(calculated.longOpenInterest).toBe(
    market.longOpenInterest,
  );

  expect(calculated.shortOpenInterest).toBe(
    market.shortOpenInterest,
  );
});
});
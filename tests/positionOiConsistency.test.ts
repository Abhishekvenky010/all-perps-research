import { describe, expect, it } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { Position } from "../src/position/Position.js";

import { PositionManager } from "../src/position/PositionManager.js";
import { closePosition } from "../src/position/ClosePosition.js";
import { liquidatePosition } from "../src/risk/LiquidationEngine.js";
import { createLiquidityVault } from "../src/liquidity/LiquidityVault.js";
import { createMarketConfig } from "./helpers/marketConfig.js";

function calculateOpenInterest(
  positions: readonly Position[],
  marketSymbol: string,
) {
  let longOpenInterest = 0;
  let shortOpenInterest = 0;

  for (const position of positions) {
    if (position.market !== marketSymbol) {
      continue;
    }

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

function expectOiConserved(
  market: MarketState,
  positionManager: PositionManager,
) {
  const calculated = calculateOpenInterest(
    positionManager.getAllPositions(),
    market.symbol,
  );

  expect(calculated.longOpenInterest).toBe(market.longOpenInterest);
  expect(calculated.shortOpenInterest).toBe(market.shortOpenInterest);
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

    positionManager.openPosition(long1, market);
    positionManager.openPosition(long2, market);
    positionManager.openPosition(short1, market);

    expectOiConserved(market, positionManager);
    let calculated = calculateOpenInterest(
      positionManager.getAllPositions(),
      market.symbol,
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
      createMarketConfig(),
      positionManager,
      createLiquidityVault(50_000),
    );

    expectOiConserved(market, positionManager);
    calculated = calculateOpenInterest(
      positionManager.getAllPositions(),
      market.symbol,
    );

    expect(calculated.longOpenInterest).toBe(
      market.longOpenInterest,
    );

    expect(calculated.shortOpenInterest).toBe(
      market.shortOpenInterest,
    );

    expect(market.longOpenInterest).toBe(20_000);
    expect(market.shortOpenInterest).toBe(5_000);
    expect(positionManager.getPositionLifecycle(long1.id)).toBe("SETTLED");
    expect(() =>
      closePosition(
        long1.id,
        market,
        createMarketConfig(),
        positionManager,
        createLiquidityVault(50_000),
      ),
    ).toThrow("POSITION_NOT_FOUND");
    expectOiConserved(market, positionManager);
  });
  it("keeps OI consistent after liquidation", () => {
  const market: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: 99,
    longOpenInterest: 0,
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

  positionManager.openPosition(position, market);
  expectOiConserved(market, positionManager);

  const result = liquidatePosition(
    position,
    market,
    createMarketConfig(),
    positionManager,
    createLiquidityVault(50_000),
    0.05,
  );

  expect(result.closed).toBe(true);
  expect(positionManager.getPositionLifecycle(position.id)).toBe("LIQUIDATED");
  expectOiConserved(market, positionManager);

  expect(
    positionManager.getPosition(position.id),
  ).toBeUndefined();

  expect(market.longOpenInterest).toBe(0);

  const calculated = calculateOpenInterest(
    positionManager.getAllPositions(),
    market.symbol,
  );

  expect(calculated.longOpenInterest).toBe(
    market.longOpenInterest,
  );

  expect(calculated.shortOpenInterest).toBe(
    market.shortOpenInterest,
  );
});

describe("Position close atomicity", () => {
  it("does not release more OI than is open or terminalize the position", () => {
    const market: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };
    const positionManager = new PositionManager();
    const position: Position = {
      id: "over-release",
      trader: "alice",
      market: "BTC-PERP",
      side: "LONG",
      size: 100,
      entryPrice: 100,
      margin: 20,
    };

    positionManager.openPosition(position, market);
    market.longOpenInterest = 50;

    expect(() =>
      closePosition(
        position.id,
        market,
        createMarketConfig(),
        positionManager,
        createLiquidityVault(50_000),
      ),
    ).toThrow("POSITION_OPEN_INTEREST_MISMATCH");

    expect(positionManager.getPosition(position.id)).toEqual(position);
    expect(positionManager.getPositionLifecycle(position.id)).toBe("OPEN");
    expect(market.longOpenInterest).toBe(50);
  });
});
});
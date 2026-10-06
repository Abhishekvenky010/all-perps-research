
import { describe, expect, it } from "vitest";

import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import { PositionManager } from "../src/position/PositionManager.js";
import { closePosition as settleClose } from "../src/position/ClosePosition.js";
import { createLiquidityVault } from "../src/liquidity/LiquidityVault.js";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: 100_000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 10,
};

function closePosition(
  positionId: string,
  market: MarketState,
  positionManager: PositionManager,
  vaultBacking = 100_000,
) {
  return settleClose(
    positionId,
    market,
    config,
    positionManager,
    createLiquidityVault(vaultBacking),
  );
}

function createMarket(
  overrides: Partial<MarketState> = {},
): MarketState {
  return {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: 100,
    longOpenInterest: 0,
    shortOpenInterest: 0,
    ...overrides,
  };
}

function openPosition(
  market: MarketState,
  positionManager: PositionManager,
  side: "LONG" | "SHORT",
  size: number,
  trader: string,
) {
  if (positionManager.getAllPositions().length === 0) {
    const longSize = market.longOpenInterest;
    const shortSize = market.shortOpenInterest;
    market.longOpenInterest = 0;
    market.shortOpenInterest = 0;

    if (longSize > 0) {
      positionManager.openPosition({
        id: "fixture-existing-long",
        trader: "existing-long",
        market: market.symbol,
        side: "LONG",
        size: longSize,
        entryPrice: market.indexPrice,
        margin: longSize,
      }, market);
    }
    if (shortSize > 0) {
      positionManager.openPosition({
        id: "fixture-existing-short",
        trader: "existing-short",
        market: market.symbol,
        side: "SHORT",
        size: shortSize,
        entryPrice: market.indexPrice,
        margin: shortSize,
      }, market);
    }
  }

  return simulateTrade(
    market,
    side,
    size,
    5,
    config,
    trader,
    size / 5,
    positionManager,
  );
}

describe("Closeability", () => {
  it("opens and closes a LONG position in a healthy market", () => {
    const market = createMarket();
    const positionManager = new PositionManager();

    const trade = openPosition(
      market,
      positionManager,
      "LONG",
      10_000,
      "alice",
    );

    expect(market.longOpenInterest).toBe(10_000);
    expect(positionManager.getPosition(trade.position.id)).toBeDefined();

    const closed = closePosition(
      trade.position.id,
      market,
      positionManager,
    );

    expect(closed.positionId).toBe(trade.position.id);
    expect(market.longOpenInterest).toBe(0);
    expect(market.shortOpenInterest).toBe(0);
    expect(positionManager.getPosition(trade.position.id)).toBeUndefined();
  });

  it("opens and closes a SHORT position in a healthy market", () => {
    const market = createMarket();
    const positionManager = new PositionManager();

    const trade = openPosition(
      market,
      positionManager,
      "SHORT",
      10_000,
      "bob",
    );

    expect(market.shortOpenInterest).toBe(10_000);

    closePosition(
      trade.position.id,
      market,
      positionManager,
    );

    expect(market.shortOpenInterest).toBe(0);
    expect(positionManager.getPosition(trade.position.id)).toBeUndefined();
  });

  it("closes a LONG position from a highly long-skewed market", () => {
    const market = createMarket({
      longOpenInterest: 70_000,
      shortOpenInterest: 10_000,
    });

    const positionManager = new PositionManager();

    const trade = openPosition(
      market,
      positionManager,
      "LONG",
      5_000,
      "alice",
    );

    expect(market.longOpenInterest).toBe(75_000);

    closePosition(
      trade.position.id,
      market,
      positionManager,
      1_000_000,
    );

    expect(market.longOpenInterest).toBe(70_000);
    expect(market.shortOpenInterest).toBe(10_000);
  });

  it("closes a SHORT position from a highly short-skewed market", () => {
    const market = createMarket({
      longOpenInterest: 10_000,
      shortOpenInterest: 70_000,
    });

    const positionManager = new PositionManager();

    const trade = openPosition(
      market,
      positionManager,
      "SHORT",
      5_000,
      "bob",
    );

    expect(market.shortOpenInterest).toBe(75_000);

    closePosition(
      trade.position.id,
      market,
      positionManager,
    );

    expect(market.longOpenInterest).toBe(10_000);
    expect(market.shortOpenInterest).toBe(70_000);
  });

  it("can close when the market is near capacity", () => {
    const market = createMarket({
      longOpenInterest: 49_000,
      shortOpenInterest: 49_000,
    });

    const positionManager = new PositionManager();

    const trade = openPosition(
      market,
      positionManager,
      "LONG",
      1_000,
      "alice",
    );

    expect(
      market.longOpenInterest +
        market.shortOpenInterest,
    ).toBe(99_000);

    closePosition(
      trade.position.id,
      market,
      positionManager,
    );

    expect(
      market.longOpenInterest +
        market.shortOpenInterest,
    ).toBe(98_000);
  });

  it("can close after the market price moves", () => {
    const market = createMarket();

    const positionManager = new PositionManager();

    const trade = openPosition(
      market,
      positionManager,
      "LONG",
      10_000,
      "alice",
    );

    /*
     * Simulate an external market move.
     *
     * Closing must not depend on the market
     * remaining at the entry price.
     */
    market.indexPrice = 80;
    market.ammTwapPrice = 80;

    closePosition(
      trade.position.id,
      market,
      positionManager,
    );

    expect(market.longOpenInterest).toBe(0);
    expect(positionManager.getPosition(trade.position.id)).toBeUndefined();
  });

  it("releases exactly the closed position's OI", () => {
    const market = createMarket();

    const positionManager = new PositionManager();

    const first = openPosition(
      market,
      positionManager,
      "LONG",
      10_000,
      "alice",
    );

    const second = openPosition(
      market,
      positionManager,
      "LONG",
      20_000,
      "bob",
    );

    expect(market.longOpenInterest).toBe(30_000);

    closePosition(
      first.position.id,
      market,
      positionManager,
    );

    expect(market.longOpenInterest).toBe(20_000);
    expect(
      positionManager.getPosition(
        second.position.id,
      ),
    ).toBeDefined();
  });

  it("does not modify the other side's OI when closing", () => {
    const market = createMarket();

    const positionManager = new PositionManager();

    const longTrade = openPosition(
      market,
      positionManager,
      "LONG",
      10_000,
      "alice",
    );

    openPosition(
      market,
      positionManager,
      "SHORT",
      20_000,
      "bob",
    );

    expect(market.longOpenInterest).toBe(10_000);
    expect(market.shortOpenInterest).toBe(20_000);

    closePosition(
      longTrade.position.id,
      market,
      positionManager,
    );

    expect(market.longOpenInterest).toBe(0);
    expect(market.shortOpenInterest).toBe(20_000);
  });

  it("rejects closing a position that does not exist", () => {
    const market = createMarket();
    const positionManager = new PositionManager();

    expect(() =>
      closePosition(
        "missing-position",
        market,
        positionManager,
      ),
    ).toThrow("POSITION_NOT_FOUND");

    expect(market.longOpenInterest).toBe(0);
    expect(market.shortOpenInterest).toBe(0);
  });

  it("rejects closing a position against the wrong market", () => {
    const market = createMarket();
    const wrongMarket = createMarket({
      symbol: "ETH-PERP",
    });

    const positionManager = new PositionManager();

    const trade = openPosition(
      market,
      positionManager,
      "LONG",
      10_000,
      "alice",
    );

    expect(() =>
      closePosition(
        trade.position.id,
        wrongMarket,
        positionManager,
      ),
    ).toThrow("POSITION_MARKET_MISMATCH");

    /*
     * The original position and OI must remain intact.
     */
    expect(market.longOpenInterest).toBe(10_000);
    expect(
      positionManager.getPosition(
        trade.position.id,
      ),
    ).toBeDefined();
  });

  it("rejects closing the same position twice", () => {
    const market = createMarket();
    const positionManager = new PositionManager();

    const trade = openPosition(
      market,
      positionManager,
      "LONG",
      10_000,
      "alice",
    );

    closePosition(
      trade.position.id,
      market,
      positionManager,
    );

    expect(market.longOpenInterest).toBe(0);

    expect(() =>
      closePosition(
        trade.position.id,
        market,
        positionManager,
      ),
    ).toThrow("POSITION_NOT_FOUND");

    expect(market.longOpenInterest).toBe(0);
  });

  it("keeps remaining positions closeable after another position closes", () => {
    const market = createMarket();
    const positionManager = new PositionManager();

    const first = openPosition(
      market,
      positionManager,
      "LONG",
      10_000,
      "alice",
    );

    const second = openPosition(
      market,
      positionManager,
      "SHORT",
      15_000,
      "bob",
    );

    closePosition(
      first.position.id,
      market,
      positionManager,
    );

    expect(market.longOpenInterest).toBe(0);
    expect(market.shortOpenInterest).toBe(15_000);

    closePosition(
      second.position.id,
      market,
      positionManager,
    );

    expect(market.longOpenInterest).toBe(0);
    expect(market.shortOpenInterest).toBe(0);
  });

  it("restores the exact pre-position OI after closing", () => {
    const market = createMarket({
      longOpenInterest: 20_000,
      shortOpenInterest: 30_000,
    });

    const positionManager = new PositionManager();

    const initialLongOI =
      market.longOpenInterest;

    const initialShortOI =
      market.shortOpenInterest;

    const trade = openPosition(
      market,
      positionManager,
      "LONG",
      5_000,
      "alice",
    );

    expect(market.longOpenInterest).toBe(
      initialLongOI + 5_000,
    );

    closePosition(
      trade.position.id,
      market,
      positionManager,
    );

    expect(market.longOpenInterest).toBe(
      initialLongOI,
    );

    expect(market.shortOpenInterest).toBe(
      initialShortOI,
    );
  });

  it("remains closeable after TWAP changes", () => {
    const market = createMarket();

    const positionManager = new PositionManager();

    const trade = openPosition(
      market,
      positionManager,
      "LONG",
      10_000,
      "alice",
    );

    market.ammTwapPrice = 150;
    market.indexPrice = 150;

    closePosition(
      trade.position.id,
      market,
      positionManager,
      1_000_000,
    );

    expect(market.longOpenInterest).toBe(0);
    expect(positionManager.getPosition(trade.position.id)).toBeUndefined();
  });

  it("allows exposure to be reduced even when the market was previously near capacity", () => {
    const market = createMarket({
      longOpenInterest: 48_000,
      shortOpenInterest: 48_000,
    });

    const positionManager = new PositionManager();

    const trade = openPosition(
      market,
      positionManager,
      "LONG",
      2_000,
      "alice",
    );

    expect(
      market.longOpenInterest +
        market.shortOpenInterest,
    ).toBe(98_000);

    /*
     * Closing is exposure reduction.
     *
     * It must not be blocked by the capacity gate.
     */
    closePosition(
      trade.position.id,
      market,
      positionManager,
    );

    expect(
      market.longOpenInterest +
        market.shortOpenInterest,
    ).toBe(96_000);
  });
});

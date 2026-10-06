import { describe, it, expect } from "vitest";

import {
  PositionManager,
} from "../src/position/PositionManager.js";

import type { MarketState } from "../src/market/MarketState.js";
import { createLiquidityVault } from "../src/liquidity/LiquidityVault.js";
import { settleAndClosePosition } from "../src/settlement/SettleAndClosePosition.js";
import { createMarketConfig } from "./helpers/marketConfig.js";

function createMarket(): MarketState {
  return {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: 100,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };
}

describe("Position System", () => {


  it("creates and stores a position", () => {


    const manager =
      new PositionManager();
    const market = createMarket();


    const position = {

      id: "position-1",

      trader: "Alice",

      market: "BTC-PERP",

      side: "LONG" as const,

      size: 10000,

      entryPrice: 105,

      margin: 1000,

    };


    manager.openPosition(position, market);


    const stored =
      manager.getPosition(
        "position-1",
      );


    expect(stored)
      .toBeDefined();


    expect(stored?.trader)
      .toBe("Alice");


    expect(stored?.size)
      .toBe(10000);


    expect(stored?.entryPrice)
      .toBe(105);
    expect(market.longOpenInterest).toBe(position.size);

  });



  it("closes a position", () => {


    const manager =
      new PositionManager();
    const market = createMarket();


    manager.openPosition({

      id: "position-2",

      trader: "Bob",

      market: "BTC-PERP",

      side: "SHORT",

      size: 5000,

      entryPrice: 100,

      margin: 500,

    }, market);


    const closed = settleAndClosePosition(
      "position-2",
      market,
      createMarketConfig(),
      manager,
      createLiquidityVault(),
    );


    expect(closed.positionId).toBe("position-2");


    expect(
      manager.getPosition(
        "position-2",
      ),
    )
    .toBeUndefined();
    expect(market.shortOpenInterest).toBe(0);
    expect(manager.getPositionLifecycle("position-2")).toBe("SETTLED");


  });



  it("returns all positions", () => {


    const manager =
      new PositionManager();
    const market = createMarket();


    manager.openPosition({

      id: "position-1",

      trader: "Alice",

      market: "BTC-PERP",

      side: "LONG",

      size: 10000,

      entryPrice: 105,

      margin: 1000,

    }, market);


    manager.openPosition({

      id: "position-2",

      trader: "Bob",

      market: "BTC-PERP",

      side: "SHORT",

      size: 5000,

      entryPrice: 110,

      margin: 500,

    }, market);


    const positions =
      manager.getAllPositions();


    expect(positions.length)
      .toBe(2);
    expect(market.longOpenInterest).toBe(10_000);
    expect(market.shortOpenInterest).toBe(5_000);

  });

  it("reconciles positions independently per market", () => {
    const manager = new PositionManager();
    const btc = createMarket();
    const eth = {
      ...createMarket(),
      symbol: "ETH-PERP",
    };

    manager.openPosition({
      id: "btc-long",
      trader: "Alice",
      market: btc.symbol,
      side: "LONG",
      size: 10,
      entryPrice: 100,
      margin: 5,
    }, btc);
    manager.openPosition({
      id: "eth-short",
      trader: "Bob",
      market: eth.symbol,
      side: "SHORT",
      size: 20,
      entryPrice: 100,
      margin: 10,
    }, eth);

    expect(btc.longOpenInterest).toBe(10);
    expect(btc.shortOpenInterest).toBe(0);
    expect(eth.longOpenInterest).toBe(0);
    expect(eth.shortOpenInterest).toBe(20);
    expect(() => manager.assertOpenInterestMatches(btc)).not.toThrow();

    settleAndClosePosition(
      "eth-short",
      eth,
      createMarketConfig(eth.symbol),
      manager,
      createLiquidityVault(),
    );

    expect(eth.shortOpenInterest).toBe(0);
    expect(btc.longOpenInterest).toBe(10);
    expect(manager.getPositionLifecycle("btc-long")).toBe("OPEN");
  });

  it("rejects duplicate open IDs without changing either state", () => {
    const manager = new PositionManager();
    const market = createMarket();
    const position = {
      id: "duplicate",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 10,
      entryPrice: 100,
      margin: 5,
    };

    const opened = manager.openPosition(position, market);
    const originalPosition = { ...opened };
    const originalOi = market.longOpenInterest;

    expect(() =>
      manager.openPosition({ ...position, size: 20 }, market),
    ).toThrow("POSITION_ID_ALREADY_EXISTS");

    expect(manager.getPosition(position.id)).toEqual(originalPosition);
    expect(market.longOpenInterest).toBe(originalOi);
    expect(manager.getPositionLifecycle(position.id)).toBe("OPEN");
  });

  it("returns immutable snapshots and validates exposure inputs", () => {
    const manager = new PositionManager();
    const market = createMarket();
    const input = {
      id: "immutable",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 10,
      entryPrice: 100,
      margin: 5,
    };
    const stored = manager.openPosition(input, market);

    input.size = 100;
    expect(stored.size).toBe(10);
    expect(() => {
      (stored as { size: number }).size = 200;
    }).toThrow();
    expect(market.longOpenInterest).toBe(10);

    for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        manager.openPosition({ ...input, id: `bad-size-${String(size)}`, size }, market),
      ).toThrow("INVALID_POSITION_SIZE");
    }
    for (const entryPrice of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        manager.openPosition({
          ...input,
          id: `bad-entry-${String(entryPrice)}`,
          entryPrice,
        }, market),
      ).toThrow("INVALID_POSITION_ENTRY_PRICE");
    }
    for (const margin of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        manager.openPosition({
          ...input,
          id: `bad-margin-${String(margin)}`,
          margin,
        }, market),
      ).toThrow("INVALID_POSITION_MARGIN");
    }
    expect(market.longOpenInterest).toBe(10);
    expect(manager.getAllPositions()).toHaveLength(1);
  });

});
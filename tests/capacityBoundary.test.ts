import { describe, expect, it } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

import { PositionManager } from "../src/position/PositionManager.js";
import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import {
  canIncreaseExposure,
  getRemainingCapacity,
} from "../src/amm/Capacity.js";

const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: 100_000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 20,
};


function createState(
  longOpenInterest: number,
  shortOpenInterest: number,
): MarketState {
  return {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: 100,
    longOpenInterest,
    shortOpenInterest,
  };
}


function total(state: MarketState): number {
  return state.longOpenInterest + state.shortOpenInterest;
}


describe("Capacity boundary", () => {

  /*
    A trade that exactly fills the remaining capacity must
    succeed. maxCapacity is inclusive.
  */
  it("accepts a trade that exactly fills remaining capacity", () => {
    // 20_000 of room, 20_000 trade.
    const state = createState(80_000, 0);
    const positionManager = new PositionManager();

    expect(getRemainingCapacity(state, config)).toBe(20_000);

    const result = simulateTrade(
      state,
      "LONG",
      20_000,
      10,
      config,
      "trader-1",
      1_500,
      positionManager,
    );

    expect(total(state)).toBe(100_000);
    expect(result.position.size).toBe(20_000);
    expect(positionManager.getAllPositions()).toHaveLength(1);
  });

  it("accepts a trade filling the final single unit of capacity", () => {
    const state = createState(99_999, 0);
    const positionManager = new PositionManager();

    expect(getRemainingCapacity(state, config)).toBe(1);

    simulateTrade(
      state,
      "LONG",
      1,
      1,
      config,
      "trader-1",
      1,
      positionManager,
    );

    expect(total(state)).toBe(100_000);
  });

  it("fills capacity from either side", () => {
    // 80_000 total leaves exactly 20_000 of room.
    const longFill = createState(40_000, 40_000);
    const shortFill = createState(40_000, 40_000);

    expect(getRemainingCapacity(longFill, config)).toBe(20_000);
    expect(getRemainingCapacity(shortFill, config)).toBe(20_000);

    simulateTrade(
      longFill,
      "LONG",
      20_000,
      10,
      config,
      "trader-1",
      1_500,
      new PositionManager(),
    );

    simulateTrade(
      shortFill,
      "SHORT",
      20_000,
      10,
      config,
      "trader-2",
      1_500,
      new PositionManager(),
    );

    expect(total(longFill)).toBe(100_000);
    expect(total(shortFill)).toBe(100_000);
  });


  /*
    At exactly maxCapacity there is no room, so any further
    trade is rejected.
  */
  it("rejects any additional trade at exactly maxCapacity", () => {
    const state = createState(100_000, 0);
    const positionManager = new PositionManager();

    expect(getRemainingCapacity(state, config)).toBe(0);

    expect(() =>
      simulateTrade(
        state,
        "LONG",
        1,
        1,
        config,
        "trader-1",
        1,
        positionManager,
      ),
    ).toThrow("MARKET_CAPACITY_EXCEEDED");
  });

  it("rejects a trade one unit over capacity", () => {
    const state = createState(99_999, 0);
    const positionManager = new PositionManager();

    expect(() =>
      simulateTrade(
        state,
        "LONG",
        2,
        2,
        config,
        "trader-1",
        1,
        positionManager,
      ),
    ).toThrow("MARKET_CAPACITY_EXCEEDED");
  });

  it("rejects both directions at capacity", () => {
    for (const side of ["LONG", "SHORT"] as const) {
      const state = createState(50_000, 50_000);
      const positionManager = new PositionManager();

      expect(() =>
        simulateTrade(
          state,
          side,
          1,
          1,
          config,
          "trader-1",
          1,
          positionManager,
        ),
      ).toThrow("MARKET_CAPACITY_EXCEEDED");
    }
  });

  it("reports the capacity gate directly", () => {
    const exact = createState(80_000, 0);

    // Exactly enough room.
    expect(
      canIncreaseExposure(exact, config, 20_000),
    ).toBe(true);

    // One unit too many.
    expect(
      canIncreaseExposure(exact, config, 20_001),
    ).toBe(false);

    const full = createState(100_000, 0);

    expect(canIncreaseExposure(full, config, 1)).toBe(false);
    expect(canIncreaseExposure(full, config, 0)).toBe(true);
  });


  /*
    A rejected trade must leave no trace: no open interest
    change, no position, no other state mutation.
  */
  describe("failed trade leaves state unchanged", () => {
    it("leaves open interest untouched", () => {
      const state = createState(90_000, 5_000);
      const positionManager = new PositionManager();

      const before = { ...state };

      expect(() =>
        simulateTrade(
          state,
          "LONG",
          10_000,
          10,
          config,
          "trader-1",
          1_000,
          positionManager,
        ),
      ).toThrow("MARKET_CAPACITY_EXCEEDED");

      expect(state.longOpenInterest)
        .toBe(before.longOpenInterest);
      expect(state.shortOpenInterest)
        .toBe(before.shortOpenInterest);
      expect(total(state)).toBe(total(before));
    });

    it("opens no position", () => {
      const state = createState(90_000, 5_000);
      const positionManager = new PositionManager();

      expect(() =>
        simulateTrade(
          state,
          "LONG",
          10_000,
          10,
          config,
          "trader-1",
          1_000,
          positionManager,
        ),
      ).toThrow("MARKET_CAPACITY_EXCEEDED");

      expect(
        positionManager.getAllPositions(),
      ).toHaveLength(0);
    });

    it("preserves pre-existing positions", () => {
      const state = createState(90_000, 5_000);
      const positionManager = new PositionManager();

      positionManager.openPosition({
        id: "pre-existing",
        trader: "alice",
        market: "BTC-PERP",
        side: "LONG",
        size: 90_000,
        entryPrice: 100,
        margin: 5_000,
      });

      expect(() =>
        simulateTrade(
          state,
          "LONG",
          10_000,
          10,
          config,
          "bob",
          1_000,
          positionManager,
        ),
      ).toThrow("MARKET_CAPACITY_EXCEEDED");

      // The other trader's position is untouched.
      expect(
        positionManager.getPosition("pre-existing"),
      ).toBeDefined();
      expect(
        positionManager.getAllPositions(),
      ).toHaveLength(1);
    });

    it("leaves the whole state object identical", () => {
      const state = createState(90_000, 5_000);
      const positionManager = new PositionManager();

      const snapshot = JSON.stringify(state);

      expect(() =>
        simulateTrade(
          state,
          "SHORT",
          10_000,
          10,
          config,
          "trader-1",
          1_000,
          positionManager,
        ),
      ).toThrow("MARKET_CAPACITY_EXCEEDED");

      expect(JSON.stringify(state)).toBe(snapshot);
    });

    it("leaves state unchanged when the trade fails partway", () => {
      /*
        The trade is split into steps and the market is only
        committed after every step succeeds. A trade that
        passes the first steps and then hits the boundary must
        still roll back completely.
      */
      const state = createState(95_000, 0);
      const positionManager = new PositionManager();

      // 5_000 of room, so a 10_000 trade fails partway through
      // its steps rather than on the first.
      const snapshot = JSON.stringify(state);

      expect(() =>
        simulateTrade(
          state,
          "LONG",
          10_000,
          10,
          config,
          "trader-1",
          1_000,
          positionManager,
        ),
      ).toThrow("MARKET_CAPACITY_EXCEEDED");

      expect(JSON.stringify(state)).toBe(snapshot);
      expect(total(state)).toBe(95_000);
      expect(
        positionManager.getAllPositions(),
      ).toHaveLength(0);
    });

    it("stays usable after a rejected trade", () => {
      const state = createState(95_000, 0);
      const positionManager = new PositionManager();

      expect(() =>
        simulateTrade(
          state,
          "LONG",
          10_000,
          10,
          config,
          "trader-1",
          1_000,
          positionManager,
        ),
      ).toThrow("MARKET_CAPACITY_EXCEEDED");

      // A smaller trade still goes through afterwards.
      const result = simulateTrade(
        state,
        "LONG",
        5_000,
        5,
        config,
        "trader-1",
        1_000,
        positionManager,
      );

      expect(total(state)).toBe(100_000);
      expect(result.position.size).toBe(5_000);
    });
  });


  /*
    A trade that exactly fills capacity must be accepted at any
    step count, including when size / steps is not exact in
    binary floating point. The capacity gate carries a tiny
    relative tolerance to absorb that rounding.
  */
  describe("float precision at the boundary", () => {
    it("accepts an exact fit when the step size is not exact", () => {
      // 20_000 / 3 does not divide evenly.
      for (const steps of [1, 3, 6, 7, 9, 13]) {
        const state = createState(80_000, 0);
        const positionManager = new PositionManager();

        const result = simulateTrade(
          state,
          "LONG",
          20_000,
          steps,
          config,
          "trader-1",
          1_500,
          positionManager,
        );

        expect(total(state)).toBeCloseTo(100_000, 6);
        expect(result.position.size)
          .toBeCloseTo(20_000, 6);
        expect(positionManager.getAllPositions())
          .toHaveLength(1);
      }
    });

    it("still rejects a trade that is genuinely oversized", () => {
      // The tolerance must not let real overshoot through.
      for (const size of [20_001, 20_500, 25_000]) {
        const state = createState(80_000, 0);
        const positionManager = new PositionManager();

        expect(() =>
          simulateTrade(
            state,
            "LONG",
            size,
            3,
            config,
            "trader-1",
            1_500,
            positionManager,
          ),
        ).toThrow("MARKET_CAPACITY_EXCEEDED");
      }
    });

    it("never materially exceeds capacity", () => {
      /*
        Rounding at the boundary can leave open interest a few
        ULPs above maxCapacity (~1e-11 here). What matters is
        that the overshoot stays negligible, not that it is
        exactly zero.
      */
      for (const steps of [1, 3, 6, 7, 9, 13]) {
        const state = createState(80_000, 0);

        simulateTrade(
          state,
          "LONG",
          20_000,
          steps,
          config,
          "trader-1",
          1_500,
          new PositionManager(),
        );

        expect(total(state)).toBeCloseTo(100_000, 6);
        expect(total(state)).toBeLessThan(
          100_000 + 1e-6,
        );
      }
    });
  });
});

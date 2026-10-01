import { describe, expect, it } from "vitest";

import type { Position } from "../src/position/Position.js";

import {
  isLiquidatable,
} from "../src/risk/Liquidation.js";

import {
  calculateMarginRatio,
  calculateEquity,
} from "../src/risk/Margin.js";

import {
  markPosition,
} from "../src/risk/PositionMark.js";

import {
  liquidatePosition,
} from "../src/risk/LiquidationEngine.js";

import { PositionManager } from "../src/position/PositionManager.js";
import type { MarketState } from "../src/market/MarketState.js";


const MAINTENANCE_MARGIN = 0.05;


function makePosition(
  overrides: Partial<Position> = {},
): Position {
  return {
    id: "pos-1",
    trader: "Alice",
    market: "BTC-PERP",
    side: "LONG",
    size: 100,
    entryPrice: 100,
    margin: 5,
    ...overrides,
  };
}


function makeState(
  overrides: Partial<MarketState> = {},
): MarketState {
  return {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: 100,
    longOpenInterest: 100_000,
    shortOpenInterest: 0,
    ...overrides,
  };
}


describe("Liquidation boundary", () => {

  /*
    1. marginRatio > maintenanceMargin -> not liquidatable.
  */
  it("does not liquidate above the maintenance margin", () => {
    // Equity 6 on size 100 -> ratio 0.06.
    const position = makePosition({ margin: 6 });

    expect(
      calculateMarginRatio(position, 0),
    ).toBeCloseTo(0.06, 12);

    expect(
      isLiquidatable(position, 0, MAINTENANCE_MARGIN),
    ).toBe(false);
  });

  it("does not liquidate well above the maintenance margin", () => {
    // Ratio 1.0, far above the threshold.
    const position = makePosition({ margin: 100 });

    expect(
      isLiquidatable(position, 0, MAINTENANCE_MARGIN),
    ).toBe(false);
  });


  /*
    2. marginRatio = maintenanceMargin -> exact boundary.

    The comparison is strict (<), so a position sitting
    exactly on the maintenance margin survives. Liquidation
    requires being strictly below it.
  */
  it("does not liquidate at exactly the maintenance margin", () => {
    // Equity exactly 5 on size 100 -> ratio exactly 0.05.
    const position = makePosition({ margin: 5 });

    const ratio = calculateMarginRatio(position, 0);

    expect(ratio).toBe(MAINTENANCE_MARGIN);

    expect(
      isLiquidatable(position, 0, MAINTENANCE_MARGIN),
    ).toBe(false);
  });

  it("reaches the same boundary through PnL", () => {
    // margin 5, pnl 0 -> equity 5. Instead take margin 0 and
    // add exactly 5 of PnL to land on the same equity.
    const position = makePosition({ margin: 0 });

    expect(
      calculateMarginRatio(position, 5),
    ).toBe(MAINTENANCE_MARGIN);

    expect(
      isLiquidatable(position, 5, MAINTENANCE_MARGIN),
    ).toBe(false);
  });

  it("survives the exact boundary through the liquidation engine", () => {
    const position = makePosition({ margin: 5 });
    const state = makeState();
    const positionManager = new PositionManager();

    positionManager.openPosition(position);

    // Mark at entry, so PnL is 0 and the ratio is exactly 0.05.
    expect(() =>
      liquidatePosition(
        position,
        100,
        state,
        positionManager,
        MAINTENANCE_MARGIN,
      ),
    ).toThrow("POSITION_HEALTHY");

    // Position and open interest both survive.
    expect(
      positionManager.getPosition("pos-1"),
    ).toBeDefined();

    expect(state.longOpenInterest).toBe(100_000);
  });

  it("marks the exact boundary as not liquidatable", () => {
    const mark = markPosition(
      makePosition({ margin: 5 }),
      100,
      MAINTENANCE_MARGIN,
    );

    expect(mark.marginRatio).toBe(MAINTENANCE_MARGIN);
    expect(mark.equity).toBe(5);
    expect(mark.liquidatable).toBe(false);
  });


  /*
    3. marginRatio < maintenanceMargin -> liquidatable.
  */
  it("liquidates below the maintenance margin", () => {
    // Equity 4 on size 100 -> ratio 0.04.
    const position = makePosition({ margin: 4 });

    expect(
      calculateMarginRatio(position, 0),
    ).toBeCloseTo(0.04, 12);

    expect(
      isLiquidatable(position, 0, MAINTENANCE_MARGIN),
    ).toBe(true);
  });

  it("liquidates just below the boundary", () => {
    // Equity 4.999 on size 100.
    const position = makePosition({ margin: 4.999 });

    expect(
      calculateMarginRatio(position, 0),
    ).toBeLessThan(MAINTENANCE_MARGIN);

    expect(
      isLiquidatable(position, 0, MAINTENANCE_MARGIN),
    ).toBe(true);
  });

  it("liquidates through the engine below the boundary", () => {
    const position = makePosition({ margin: 4 });
    const state = makeState();
    const positionManager = new PositionManager();

    positionManager.openPosition(position);

    const result = liquidatePosition(
      position,
      100,
      state,
      positionManager,
      MAINTENANCE_MARGIN,
    );

    expect(result.closed).toBe(true);
    expect(result.marginRatio).toBeCloseTo(0.04, 12);
    expect(
      positionManager.getPosition("pos-1"),
    ).toBeUndefined();
  });

  it("liquidates when equity goes negative", () => {
    const position = makePosition({ margin: 5 });

    expect(
      isLiquidatable(position, -10, MAINTENANCE_MARGIN),
    ).toBe(true);
  });


  /*
    The boundary is a step function: crossing it changes the
    outcome, and nothing in between is ambiguous.
  */
  it("flips from alive to liquidatable across the boundary", () => {
    const outcomes = [6, 5.5, 5.0001, 5, 4.9999, 4.5, 4]
      .map((margin) =>
        isLiquidatable(
          makePosition({ margin }),
          0,
          MAINTENANCE_MARGIN,
        ),
      );

    // Alive, alive, alive, alive (boundary), then liquidatable.
    expect(outcomes).toEqual([
      false, false, false, false, true, true, true,
    ]);
  });

  it("liquidates on both sides of the boundary", () => {
    // LONG loses as price falls; SHORT loses as price rises.
    const long = makePosition({
      side: "LONG",
      margin: 5,
    });

    const short = makePosition({
      side: "SHORT",
      margin: 5,
    });

    // LONG at entry: exactly the boundary, safe.
    expect(
      isLiquidatable(long, 0, MAINTENANCE_MARGIN),
    ).toBe(false);

    // Any adverse move liquidates.
    expect(
      isLiquidatable(long, -0.01, MAINTENANCE_MARGIN),
    ).toBe(true);

    // SHORT at entry: exactly the boundary, safe.
    expect(
      isLiquidatable(short, 0, MAINTENANCE_MARGIN),
    ).toBe(false);

    expect(
      isLiquidatable(short, -0.01, MAINTENANCE_MARGIN),
    ).toBe(true);
  });

  it("scales the boundary with the configured maintenance margin", () => {
    for (const maintenanceMargin of [0.02, 0.05, 0.1, 0.25]) {
      // Equity exactly at the threshold: size * maintenanceMargin.
      const position = makePosition({
        margin: 100 * maintenanceMargin,
      });

      expect(
        calculateMarginRatio(position, 0),
      ).toBeCloseTo(maintenanceMargin, 12);

      // At the boundary the position survives.
      expect(
        isLiquidatable(
          position,
          0,
          maintenanceMargin,
        ),
      ).toBe(false);

      // A whisker below is liquidated.
      expect(
        isLiquidatable(
          makePosition({ margin: 100 * maintenanceMargin - 0.01 }),
          0,
          maintenanceMargin,
        ),
      ).toBe(true);
    }
  });


  /*
    Known limitation, consistent with the float tolerance added
    to the capacity gate.

    A margin ratio derived from a price move is computed as
    equity = margin + (mark - entry) * size. Solving that for
    the exact boundary price yields 100.02499999999999 rather
    than 100.025, which puts the ratio just below the
    threshold. A position sitting exactly on that boundary is
    therefore liquidated, because the boundary is not reachable
    from a price input.

    Positions defined by margin (as above) are unaffected:
    size 100 with margin 5 gives exactly 0.05.
  */
  describe("float precision at the boundary", () => {
    it("liquidates at the boundary price derived from entry", () => {
      const size = 100;
      const entryPrice = 100;
      const margin = 0;

      // ratio = margin/size + (mark - entry) = 0.05
      //   =>  mark = 100 + 0.05
      const boundaryMark = entryPrice + 0.05;

      const pnl = (boundaryMark - entryPrice) * size;

      const position = makePosition({
        size,
        entryPrice,
        margin,
      });

      // The arithmetic is sound, but the ratio lands a hair
      // under the threshold due to rounding.
      expect(
        calculateMarginRatio(position, pnl),
      ).toBeLessThan(MAINTENANCE_MARGIN);

      expect(
        isLiquidatable(
          position,
          pnl,
          MAINTENANCE_MARGIN,
        ),
      ).toBe(true);
    });

    it("keeps the exact boundary reachable through margin", () => {
      // The margin-based path is exact and stable.
      const position = makePosition({ size: 100, margin: 5 });

      expect(
        calculateMarginRatio(position, 0),
      ).toBe(MAINTENANCE_MARGIN);

      expect(
        isLiquidatable(position, 0, MAINTENANCE_MARGIN),
      ).toBe(false);
    });
  });
});

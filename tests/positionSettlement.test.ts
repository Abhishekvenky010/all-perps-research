import { describe, expect, it } from "vitest";
import { calculatePositionSettlement } from "../src/settlement/PositionSettlement.js";

describe("Position settlement calculation", () => {
  it("calculates LONG profit without mutating lifecycle state", () => {
    const position = {
      id: "1",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 100,
      entryPrice: 100,
      margin: 1_000,
    };

    expect(calculatePositionSettlement(position, 120)).toEqual({
      positionId: "1",
      side: "LONG",
      size: 100,
      entryPrice: 100,
      settlementPrice: 120,
      pnl: 2_000,
      traderSettlement: 3_000,
    });
  });

  it("preserves the established LONG and SHORT PnL formulas", () => {
    const base = {
      id: "2",
      trader: "Alice",
      market: "BTC-PERP",
      size: 100,
      entryPrice: 100,
      margin: 1_000,
    };

    expect(
      calculatePositionSettlement(
        { ...base, side: "LONG" },
        90,
      ).pnl,
    ).toBe(-1_000);
    expect(
      calculatePositionSettlement(
        { ...base, side: "SHORT" },
        90,
      ).pnl,
    ).toBe(1_000);
    expect(
      calculatePositionSettlement(
        { ...base, side: "SHORT" },
        110,
      ).pnl,
    ).toBe(-1_000);
  });

  it("rejects a non-finite calculated result", () => {
    const position = {
      id: "3",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 100,
      entryPrice: 100,
      margin: 1_000,
    };

    expect(() =>
      calculatePositionSettlement(position, Number.NaN),
    ).toThrow("INVALID_POSITION_SETTLEMENT");
  });
});

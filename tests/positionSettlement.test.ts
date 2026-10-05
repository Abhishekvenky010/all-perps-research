import { describe, it, expect } from "vitest";

import {
  settlePosition,
  calculatePositionSettlement,
} from "../src/settlement/PositionSettlement.js";
import {
  createLiquidityVault,
} from "../src/liquidity/LiquidityVault.js";

describe("Position settlement", () => {
  it("settles a LONG trader profit", () => {
    const vault = createLiquidityVault(50_000);

    const position = {
      id: "1",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 100,
      entryPrice: 100,
      margin: 1_000,
    };

    const result = settlePosition(
      position,
      120,
      vault,
    );

    expect(result.pnl).toBe(2_000);
    expect(result.traderSettlement).toBe(3_000);

    expect(vault.traderPnL).toBe(2_000);
    expect(vault.availableCapital).toBe(48_000);
  });

  it("settles a LONG trader loss", () => {
    const vault = createLiquidityVault(50_000);

    const position = {
      id: "2",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 100,
      entryPrice: 100,
      margin: 1_000,
    };

    const result = settlePosition(
      position,
      90,
      vault,
    );

    expect(result.pnl).toBe(-1_000);
    expect(result.traderSettlement).toBe(0);

    expect(vault.traderPnL).toBe(-1_000);
    expect(vault.availableCapital).toBe(51_000);
  });

  it("settles a SHORT trader profit", () => {
    const vault = createLiquidityVault(50_000);

    const position = {
      id: "3",
      trader: "Bob",
      market: "BTC-PERP",
      side: "SHORT" as const,
      size: 100,
      entryPrice: 100,
      margin: 1_000,
    };

    const result = settlePosition(
      position,
      90,
      vault,
    );

    expect(result.pnl).toBe(1_000);
    expect(result.traderSettlement).toBe(2_000);

    expect(vault.traderPnL).toBe(1_000);
    expect(vault.availableCapital).toBe(49_000);
  });

  it("settles a SHORT trader loss", () => {
    const vault = createLiquidityVault(50_000);

    const position = {
      id: "4",
      trader: "Bob",
      market: "BTC-PERP",
      side: "SHORT" as const,
      size: 100,
      entryPrice: 100,
      margin: 1_000,
    };

    const result = settlePosition(
      position,
      110,
      vault,
    );

    expect(result.pnl).toBe(-1_000);
    expect(result.traderSettlement).toBe(0);

    expect(vault.traderPnL).toBe(-1_000);
    expect(vault.availableCapital).toBe(51_000);
  });
  it("calculates settlement without changing the vault", () => {
  const vault = createLiquidityVault(50_000);

  const position = {
    id: "5",
    trader: "Alice",
    market: "BTC-PERP",
    side: "LONG" as const,
    size: 100,
    entryPrice: 100,
    margin: 1_000,
  };

  const result = calculatePositionSettlement(
    position,
    120,
  );

  expect(result.pnl).toBe(2_000);
  expect(result.traderSettlement).toBe(3_000);

  expect(vault.traderPnL).toBe(0);
  expect(vault.availableCapital).toBe(50_000);
});
});
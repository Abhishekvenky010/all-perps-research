import { describe, it, expect } from "vitest";

import {
  createLiquidityVault,
  recordTraderPnL,
  getLpEquity,
} from "../src/liquidity/LiquidityVault.js";

import {
  calculateUnrealizedPnL,
} from "../src/risk/PnL.js";


describe("Vault settlement", () => {

  it("settles LONG trader profit against LP equity", () => {

    const vault =
      createLiquidityVault(50_000);

    const position = {
      id: "1",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 1000,
      entryPrice: 100,
      margin: 10_000,
    };

    const pnl =
      calculateUnrealizedPnL(
        position,
        110,
      );

    expect(pnl).toBe(10_000);

    recordTraderPnL(
      vault,
      pnl,
    );

    expect(vault.traderPnL)
      .toBe(10_000);

    expect(getLpEquity(vault))
      .toBe(40_000);
  });


  it("settles LONG trader loss in favor of LP equity", () => {

    const vault =
      createLiquidityVault(50_000);

    const position = {
      id: "2",
      trader: "Alice",
      market: "BTC-PERP",
      side: "LONG" as const,
      size: 1000,
      entryPrice: 100,
      margin: 10_000,
    };

    const pnl =
      calculateUnrealizedPnL(
        position,
        90,
      );

    expect(pnl).toBe(-10_000);

    recordTraderPnL(
      vault,
      pnl,
    );

    expect(vault.traderPnL)
      .toBe(-10_000);

    expect(getLpEquity(vault))
      .toBe(60_000);
  });


  it("settles SHORT trader profit against LP equity", () => {

    const vault =
      createLiquidityVault(50_000);

    const position = {
      id: "3",
      trader: "Bob",
      market: "BTC-PERP",
      side: "SHORT" as const,
      size: 1000,
      entryPrice: 100,
      margin: 10_000,
    };

    const pnl =
      calculateUnrealizedPnL(
        position,
        90,
      );

    expect(pnl).toBe(10_000);

    recordTraderPnL(
      vault,
      pnl,
    );

    expect(getLpEquity(vault))
      .toBe(40_000);
  });


  it("settles SHORT trader loss in favor of LP equity", () => {

    const vault =
      createLiquidityVault(50_000);

    const position = {
      id: "4",
      trader: "Bob",
      market: "BTC-PERP",
      side: "SHORT" as const,
      size: 1000,
      entryPrice: 100,
      margin: 10_000,
    };

    const pnl =
      calculateUnrealizedPnL(
        position,
        110,
      );

    expect(pnl).toBe(-10_000);

    recordTraderPnL(
      vault,
      pnl,
    );

    expect(getLpEquity(vault))
      .toBe(60_000);
  });

});
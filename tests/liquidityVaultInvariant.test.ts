import { describe, expect, it } from "vitest";

import {
  addPremium,
  createLiquidityVault,
  depositLP,
  getLpEquity,
  recordTraderPnL,
} from "../src/liquidity/LiquidityVault.js";

describe("LiquidityVault accounting invariants", () => {
  it("keeps available capital equal to LP equity after an LP deposit", () => {
    const vault = createLiquidityVault(50_000);

    depositLP(vault, 10_000);

    expect(vault.availableCapital).toBe(60_000);
    expect(getLpEquity(vault)).toBe(60_000);
  });

  it("keeps available capital equal to LP equity after trader profit", () => {
    const vault = createLiquidityVault(50_000);

    recordTraderPnL(vault, 2_000);

    expect(vault.availableCapital).toBe(48_000);
    expect(getLpEquity(vault)).toBe(48_000);
  });

  it("keeps available capital equal to LP equity after trader loss", () => {
    const vault = createLiquidityVault(50_000);

    recordTraderPnL(vault, -2_000);

    expect(vault.availableCapital).toBe(52_000);
    expect(getLpEquity(vault)).toBe(52_000);
  });

  it("keeps available capital equal to LP equity after a premium", () => {
    const vault = createLiquidityVault(50_000);

    addPremium(vault, 1_000);

    expect(vault.availableCapital).toBe(51_000);
    expect(getLpEquity(vault)).toBe(51_000);
  });

  it("preserves the accounting identity across combined operations", () => {
    const vault = createLiquidityVault(50_000);

    depositLP(vault, 10_000);
    addPremium(vault, 2_000);
    recordTraderPnL(vault, 5_000);
    recordTraderPnL(vault, -1_500);

    expect(vault.totalDeposited).toBe(60_000);
    expect(vault.traderPnL).toBe(3_500);
    expect(vault.premiums).toBe(2_000);
    expect(vault.availableCapital).toBe(58_500);
    expect(getLpEquity(vault)).toBe(58_500);
  });
});
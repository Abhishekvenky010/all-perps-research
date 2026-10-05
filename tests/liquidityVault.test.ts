import { describe, expect, it } from "vitest";

import {
  createLiquidityVault,
  depositLP,
  recordTraderPnL,
  addPremium,
  getLpEquity,
} from "../src/liquidity/LiquidityVault.js";

describe("LiquidityVault", () => {
  it("creates an empty vault", () => {
    const vault = createLiquidityVault();

    expect(vault.totalDeposited).toBe(0);
    expect(vault.availableCapital).toBe(0);
    expect(vault.traderPnL).toBe(0);
    expect(vault.premiums).toBe(0);
  });

  it("accepts LP capital", () => {
    const vault = createLiquidityVault();

    depositLP(vault, 50_000);

    expect(vault.totalDeposited).toBe(50_000);
    expect(vault.availableCapital).toBe(50_000);
  });

  it("trader profit reduces LP equity", () => {
    const vault = createLiquidityVault(50_000);

    recordTraderPnL(vault, 2_000);

    expect(vault.traderPnL).toBe(2_000);
    expect(getLpEquity(vault)).toBe(48_000);
    expect(vault.availableCapital).toBe(48_000);
  });

  it("trader loss increases LP equity", () => {
    const vault = createLiquidityVault(50_000);

    recordTraderPnL(vault, -2_000);

    expect(vault.traderPnL).toBe(-2_000);
    expect(getLpEquity(vault)).toBe(52_000);
    expect(vault.availableCapital).toBe(52_000);
  });

  it("premiums increase LP equity", () => {
    const vault = createLiquidityVault(50_000);

    addPremium(vault, 1_000);

    expect(vault.premiums).toBe(1_000);
    expect(getLpEquity(vault)).toBe(51_000);
    expect(vault.availableCapital).toBe(51_000);
  });

  it("preserves the accounting invariant", () => {
    const vault = createLiquidityVault(50_000);

    recordTraderPnL(vault, 3_000);
    recordTraderPnL(vault, -1_000);
    addPremium(vault, 500);

    expect(vault.availableCapital).toBe(
      vault.totalDeposited -
        vault.traderPnL +
        vault.premiums,
    );

    expect(vault.availableCapital).toBe(
      getLpEquity(vault),
    );
  });

  it("rejects invalid deposits", () => {
    const vault = createLiquidityVault();

    expect(() => depositLP(vault, 0))
      .toThrow("INVALID_DEPOSIT");

    expect(() => depositLP(vault, -100))
      .toThrow("INVALID_DEPOSIT");
  });
});
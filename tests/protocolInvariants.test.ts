import { describe, expect, it } from "vitest";
import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";
import type { Position } from "../src/position/Position.js";
import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import { PositionManager } from "../src/position/PositionManager.js";
import { closePosition } from "../src/position/ClosePosition.js";
import { getAverageExecutionPrice } from "../src/amm/Pricing.js";
import { getRemainingCapacity } from "../src/amm/Capacity.js";
import { calculateUnrealizedPnL } from "../src/risk/PnL.js";
import { runLiquidationSweep } from "../src/risk/LiquidationSweep.js";
import { createLiquidityVault } from "../src/liquidity/LiquidityVault.js";
import { calculateTWAP, updateAmmTwap, type PriceObservation } from "../src/oracle/TWAPOracle.js";

const config: MarketConfig = {
  symbol: "BTC-PERP", maxCapacity: 100_000, skewCoefficient: 0.2,
  capacityCoefficient: 0.05, maxLeverage: 10, maintenanceMargin: 0.05,
};

function market(overrides: Partial<MarketState> = {}): MarketState {
  return { symbol: "BTC-PERP", indexPrice: 100, ammTwapPrice: 100,
    longOpenInterest: 0, shortOpenInterest: 0, ...overrides };
}

describe("Protocol-level invariants", () => {
  it("never permits total OI above market capacity", () => {
    const state = market(); const pm = new PositionManager();
    simulateTrade(state, "LONG", 100_000, 10, config, "max-long", 10_000, pm);
    expect(state.longOpenInterest + state.shortOpenInterest).toBe(100_000);
    expect(getRemainingCapacity(state, config)).toBe(0);
    expect(() => simulateTrade(state, "LONG", 1, 1, config, "overflow", 1, pm))
      .toThrow("MARKET_CAPACITY_EXCEEDED");
  });

  it("makes the crowded side progressively more expensive", () => {
    const prices = [0, 20_000, 40_000, 60_000].map(longOpenInterest =>
      getAverageExecutionPrice(market({ longOpenInterest }), config, "LONG"));
    for (let i = 1; i < prices.length; i++) expect(prices[i]).toBeGreaterThan(prices[i - 1]!);
  });

  it("keeps market OI consistent across open and close", () => {
    const state = market(); const pm = new PositionManager();
    const long = simulateTrade(state, "LONG", 20_000, 5, config, "alice", 2_000, pm);
    const short = simulateTrade(state, "SHORT", 10_000, 5, config, "bob", 1_000, pm);
    expect(state.longOpenInterest).toBe(20_000); expect(state.shortOpenInterest).toBe(10_000);
    expect(pm.getAllPositions().reduce((n, p) => n + p.size, 0)).toBe(30_000);
    closePosition(
      long.position.id,
      state,
      config,
      pm,
      createLiquidityVault(50_000),
    );
    expect(state.longOpenInterest).toBe(0); expect(state.shortOpenInterest).toBe(10_000);
    expect(pm.getPosition(long.position.id)).toBeUndefined();
    expect(pm.getPosition(short.position.id)).toBeDefined();
  });

  it("preserves LONG/SHORT PnL direction", () => {
    const long: Position = { id: "l", trader: "a", market: "BTC-PERP", side: "LONG", size: 10_000, entryPrice: 90, margin: 2_000 };
    const short: Position = { ...long, id: "s", side: "SHORT" };
    expect(calculateUnrealizedPnL(long, 100)).toBe(100_000);
    expect(calculateUnrealizedPnL(short, 100)).toBe(-100_000);
  });

  it("liquidation releases the exact position OI", () => {
    const state = market({ ammTwapPrice: 45 });
    const pm = new PositionManager();
    pm.openPosition({ id: "liq", trader: "alice", market: "BTC-PERP", side: "LONG", size: 10_000, entryPrice: 100, margin: 1_000 }, state);
    const result = runLiquidationSweep(
      state,
      config,
      pm,
      createLiquidityVault(50_000),
    );
    expect(result.liquidations).toHaveLength(1);
    expect(result.releasedOpenInterest).toBe(10_000);
    expect(state.longOpenInterest).toBe(0);
    expect(pm.getPosition("liq")).toBeUndefined();
  });

  it("connects observations to TWAP and TWAP to market state", () => {
    const observations: PriceObservation[] = [
      { timestamp: 0, price: 100 }, { timestamp: 450, price: 100 }, { timestamp: 900, price: 200 },
    ];
    expect(calculateTWAP(observations, 900)).toBeCloseTo(100, 10);
    expect(calculateTWAP(observations, 1350)).toBeCloseTo(150, 10);
    expect(updateAmmTwap(market(), observations, 1350).ammTwapPrice).toBeCloseTo(150, 10);
  });
});

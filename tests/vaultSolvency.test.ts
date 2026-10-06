import { describe, expect, it } from "vitest";
import type { MarketState } from "../src/market/MarketState.js";
import {
  createLiquidityVault,
  type LiquidityVault,
} from "../src/liquidity/LiquidityVault.js";
import { PositionManager } from "../src/position/PositionManager.js";
import type { Position } from "../src/position/Position.js";
import { settleAndClosePosition } from "../src/settlement/SettleAndClosePosition.js";
import { settleAndLiquidatePosition } from "../src/settlement/SettleAndLiquidatePosition.js";
import { calculatePositionSettlement } from "../src/settlement/PositionSettlement.js";
import { createMarketConfig } from "./helpers/marketConfig.js";

function openLong({
  deposit,
  size,
  entryPrice = 100,
  margin = 1_000,
  id = "solvency-position",
}: {
  deposit: number;
  size: number;
  entryPrice?: number;
  margin?: number;
  id?: string;
}) {
  const market: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: entryPrice,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };
  const config = createMarketConfig(market.symbol, {
    maxCapacity: Math.max(100_000, size * 2),
  });
  const positions = new PositionManager();
  const position: Position = {
    id,
    trader: "alice",
    market: market.symbol,
    side: "LONG",
    size,
    entryPrice,
    margin,
  };
  positions.openPosition(position, market, config.maxCapacity);

  return {
    market,
    config,
    positions,
    position,
    vault: createLiquidityVault(deposit),
  };
}

function snapshot(
  market: MarketState,
  positions: PositionManager,
  positionId: string,
  vault: LiquidityVault,
) {
  return {
    market: { ...market },
    position: positions.getPosition(positionId),
    lifecycle: positions.getPositionLifecycle(positionId),
    vault: { ...vault },
  };
}

describe("realized vault solvency", () => {
  it("settles a profit within LP backing and books it once", () => {
    const { market, config, positions, position, vault } = openLong({
      deposit: 100_000,
      size: 3_000,
    });
    market.ammTwapPrice = 110;

    const result = settleAndClosePosition(
      position.id,
      market,
      config,
      positions,
      vault,
    );

    expect(result.pnl).toBe(30_000);
    expect(vault.traderPnL).toBe(30_000);
    expect(vault.availableCapital).toBe(70_000);
    expect(positions.getPositionLifecycle(position.id)).toBe("SETTLED");
  });

  it("allows profit exactly equal to all available backing", () => {
    const { market, config, positions, position, vault } = openLong({
      deposit: 100_000,
      size: 10_000,
    });
    market.ammTwapPrice = 110;

    const result = settleAndClosePosition(
      position.id,
      market,
      config,
      positions,
      vault,
    );

    expect(result.pnl).toBe(100_000);
    expect(vault.traderPnL).toBe(100_000);
    expect(vault.availableCapital).toBe(0);
  });

  it("atomically rejects a profit one unit above available backing", () => {
    const { market, config, positions, position, vault } = openLong({
      deposit: 100_000,
      size: 100_001,
    });
    market.ammTwapPrice = 101;
    const before = snapshot(market, positions, position.id, vault);

    expect(() =>
      settleAndClosePosition(
        position.id,
        market,
        config,
        positions,
        vault,
      ),
    ).toThrow("INSUFFICIENT_LP_BACKING");

    expect(snapshot(market, positions, position.id, vault)).toEqual(before);
  });

  it("rejects the discovered 30,000-size recovery liability", () => {
    const { market, config, positions, position, vault } = openLong({
      deposit: 50_000,
      size: 30_000,
      entryPrice: 97.6422,
    });
    market.ammTwapPrice = 100;
    const expectedSettlement = calculatePositionSettlement(position, 100);
    const before = snapshot(market, positions, position.id, vault);

    expect(expectedSettlement.pnl).toBeGreaterThan(50_000);
    expect(() =>
      settleAndClosePosition(
        position.id,
        market,
        config,
        positions,
        vault,
      ),
    ).toThrow("INSUFFICIENT_LP_BACKING");

    expect(snapshot(market, positions, position.id, vault)).toEqual(before);
  });

  it("preserves signed loss accounting without treating it as collected cash", () => {
    const { market, config, positions, position, vault } = openLong({
      deposit: 100_000,
      size: 2_000,
    });
    market.ammTwapPrice = 90;

    const result = settleAndClosePosition(
      position.id,
      market,
      config,
      positions,
      vault,
    );

    expect(result.pnl).toBe(-20_000);
    expect(vault.traderPnL).toBe(-20_000);
    expect(vault.availableCapital).toBe(120_000);
  });

  it("does not change vault accounting for zero PnL", () => {
    const { market, config, positions, position, vault } = openLong({
      deposit: 100_000,
      size: 1_000,
    });
    const before = { ...vault };

    const result = settleAndClosePosition(
      position.id,
      market,
      config,
      positions,
      vault,
    );

    expect(result.pnl).toBe(0);
    expect(vault.traderPnL).toBe(before.traderPnL);
    expect(vault.availableCapital).toBe(before.availableCapital);
  });

  it("rejects an unfunded positive-PnL liquidation atomically", () => {
    const { market, config, positions, position, vault } = openLong({
      deposit: 0.5,
      size: 1_000,
      margin: 1,
      id: "unfunded-liquidation",
    });
    market.ammTwapPrice = 100.001;
    const before = snapshot(market, positions, position.id, vault);

    expect(() =>
      settleAndLiquidatePosition(
        position.id,
        market,
        config,
        positions,
        vault,
        0.05,
      ),
    ).toThrow("INSUFFICIENT_LP_BACKING");

    expect(snapshot(market, positions, position.id, vault)).toEqual(before);
  });
});

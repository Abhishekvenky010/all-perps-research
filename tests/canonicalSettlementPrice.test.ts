import { describe, expect, it } from "vitest";
import type { MarketState } from "../src/market/MarketState.js";
import {
  createLiquidityVault,
} from "../src/liquidity/LiquidityVault.js";
import { PositionManager } from "../src/position/PositionManager.js";
import type { Position } from "../src/position/Position.js";
import { getCurrentAmmPrice } from "../src/amm/Pricing.js";
import { settleAndClosePosition } from "../src/settlement/SettleAndClosePosition.js";
import { settleAndLiquidatePosition } from "../src/settlement/SettleAndLiquidatePosition.js";
import { getSettlementPrice } from "../src/settlement/SettlementPrice.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: 1_000,
  skewCoefficient: 0.5,
  capacityCoefficient: 0.05,
  maxLeverage: 20,
};

function setup(targetMargin = 1_000) {
  const market: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: 100,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };
  const positions = new PositionManager();
  positions.openPosition({
    id: "opposing-short",
    trader: "bob",
    market: market.symbol,
    side: "SHORT",
    size: 200,
    entryPrice: 100,
    margin: 1_000,
  }, market);
  const target: Position = {
    id: "target-long",
    trader: "alice",
    market: market.symbol,
    side: "LONG",
    size: 100,
    entryPrice: 100,
    margin: targetMargin,
  };
  positions.openPosition(target, market);

  return { market, positions, target };
}

describe("canonical settlement price", () => {
  it("uses the same internally derived mark for close and liquidation", () => {
    const closeState = setup();
    const closeResult = settleAndClosePosition(
      closeState.target.id,
      closeState.market,
      config,
      closeState.positions,
      createLiquidityVault(50_000),
    );

    const liquidationState = setup(1);
    const liquidationResult = settleAndLiquidatePosition(
      liquidationState.target.id,
      liquidationState.market,
      config,
      liquidationState.positions,
      createLiquidityVault(50_000),
      0.05,
    );

    expect(closeResult.settlementPrice).toBe(90);
    expect(liquidationResult.settlementPrice).toBe(90);
    expect(closeResult.pnl).toBe((90 - 100) * 100);
    expect(liquidationResult.pnl).toBe((90 - 100) * 100);
    expect(getCurrentAmmPrice(liquidationState.market, config)).toBe(90);
  });

  it("captures the canonical mark before releasing the position's OI", () => {
    const { market, positions, target } = setup();
    const beforeClose = { ...market };
    const priceBeforeClose = getSettlementPrice(market, config, target);
    expect(priceBeforeClose).toBe(90);
    expect(market).toEqual(beforeClose);

    const result = settleAndClosePosition(
      target.id,
      market,
      config,
      positions,
      createLiquidityVault(50_000),
    );

    expect(result.settlementPrice).toBe(priceBeforeClose);
    expect(market.longOpenInterest).toBe(0);
    expect(market.shortOpenInterest).toBe(200);
    expect(result.pnl).toBe((priceBeforeClose - target.entryPrice) * target.size);
  });

  it("excludes a LONG's own positive skew from its settlement mark", () => {
    const { market, target } = setup();
    const currentMark = getCurrentAmmPrice(market, config);
    const settlementMark = getSettlementPrice(market, config, target);

    expect(currentMark).toBe(95);
    expect(settlementMark).toBe(90);
  });

  it("excludes a SHORT's own negative skew from its settlement mark", () => {
    const market: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };
    const positions = new PositionManager();
    const target = positions.openPosition({
      id: "target-short",
      trader: "alice",
      market: market.symbol,
      side: "SHORT",
      size: 100,
      entryPrice: 100,
      margin: 1_000,
    }, market);

    expect(getCurrentAmmPrice(market, config)).toBe(95);
    expect(getSettlementPrice(market, config, target)).toBe(100);
  });

  it("retains other positions when excluding only the settling position", () => {
    const market: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };
    const positions = new PositionManager();
    const target = positions.openPosition({
      id: "long-a",
      trader: "alice",
      market: market.symbol,
      side: "LONG",
      size: 10,
      entryPrice: 100,
      margin: 100,
    }, market);
    positions.openPosition({
      id: "long-b",
      trader: "bob",
      market: market.symbol,
      side: "LONG",
      size: 20,
      entryPrice: 100,
      margin: 100,
    }, market);
    positions.openPosition({
      id: "short-c",
      trader: "carol",
      market: market.symbol,
      side: "SHORT",
      size: 15,
      entryPrice: 100,
      margin: 100,
    }, market);

    expect(getSettlementPrice(market, config, target)).toBe(100.25);
    expect(market.longOpenInterest).toBe(30);
    expect(market.shortOpenInterest).toBe(15);
  });

  it("uses the TWAP when the remaining positions have zero skew", () => {
    const market: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };
    const positions = new PositionManager();
    const target = positions.openPosition({
      id: "target-long",
      trader: "alice",
      market: market.symbol,
      side: "LONG",
      size: 10,
      entryPrice: 100,
      margin: 100,
    }, market);
    positions.openPosition({
      id: "remaining-long",
      trader: "bob",
      market: market.symbol,
      side: "LONG",
      size: 100,
      entryPrice: 100,
      margin: 100,
    }, market);
    positions.openPosition({
      id: "remaining-short",
      trader: "carol",
      market: market.symbol,
      side: "SHORT",
      size: 100,
      entryPrice: 100,
      margin: 100,
    }, market);

    expect(getSettlementPrice(market, config, target)).toBe(100);
  });

  it("allows exact OI-boundary exclusion and does not mutate the market or position", () => {
    const market: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };
    const positions = new PositionManager();
    const target = positions.openPosition({
      id: "only-long",
      trader: "alice",
      market: market.symbol,
      side: "LONG",
      size: 100,
      entryPrice: 100,
      margin: 1_000,
    }, market);
    const marketBefore = { ...market };
    const positionBefore = { ...target };

    expect(market.longOpenInterest).toBe(target.size);
    expect(getSettlementPrice(market, config, target)).toBe(100);
    expect(market).toEqual(marketBefore);
    expect(target).toEqual(positionBefore);

    const result = settleAndClosePosition(
      target.id,
      market,
      config,
      positions,
      createLiquidityVault(50_000),
    );
    expect(result.settlementPrice).toBe(100);
    expect(market.longOpenInterest).toBe(0);
  });

  it("fails safely if position size exceeds its side's open interest", () => {
    const market: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 99,
      shortOpenInterest: 0,
    };
    const position: Position = {
      id: "oversized-for-oi",
      trader: "alice",
      market: market.symbol,
      side: "LONG",
      size: 100,
      entryPrice: 100,
      margin: 1_000,
    };

    expect(() => getSettlementPrice(market, config, position)).toThrow(
      "POSITION_OPEN_INTEREST_MISMATCH",
    );
    expect(market.longOpenInterest).toBe(99);
  });
});

import { describe, expect, it } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { Position } from "../src/position/Position.js";

import {
  createLiquidityVault,
  getLpEquity,
} from "../src/liquidity/LiquidityVault.js";

import { PositionManager } from "../src/position/PositionManager.js";
import { settleAndClosePosition } from "../src/settlement/SettleAndClosePosition.js";
import { createMarketConfig } from "./helpers/marketConfig.js";

describe("End-to-end economic settlement", () => {
  it("rejects an unfunded profitable position without changing protocol state", () => {
    const market: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 110,
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };

    const vault = createLiquidityVault(50_000);

    const positionManager = new PositionManager();

    const position: Position = {
      id: "position-1",
      trader: "alice",
      market: "BTC-PERP",
      side: "LONG",
      size: 10_000,
      entryPrice: 100,
      margin: 2_000,
    };

    positionManager.openPosition(position, market);

    const before = {
      market: { ...market },
      position: positionManager.getPosition(position.id),
      lifecycle: positionManager.getPositionLifecycle(position.id),
      vault: { ...vault },
    };

    expect(() =>
      settleAndClosePosition(
        position.id,
        market,
        createMarketConfig(),
        positionManager,
        vault,
      ),
    ).toThrow("INSUFFICIENT_LP_BACKING");

    expect({
      market: { ...market },
      position: positionManager.getPosition(position.id),
      lifecycle: positionManager.getPositionLifecycle(position.id),
      vault: { ...vault },
    }).toEqual(before);
    expect(vault.availableCapital).toBe(50_000);
    expect(getLpEquity(vault)).toBe(50_000);
  });
});

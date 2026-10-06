import { describe, expect, it } from "vitest";
import type { MarketState } from "../src/market/MarketState.js";
import {
  createLiquidityVault,
  type LiquidityVault,
} from "../src/liquidity/LiquidityVault.js";
import {
  PositionManager,
  type PreparedPositionClose,
} from "../src/position/PositionManager.js";
import type { Position } from "../src/position/Position.js";
import type { PreparedTraderPnL } from "../src/liquidity/LiquidityVault.js";
import { settleAndClosePosition } from "../src/settlement/SettleAndClosePosition.js";
import { settleAndLiquidatePosition } from "../src/settlement/SettleAndLiquidatePosition.js";
import { createMarketConfig } from "./helpers/marketConfig.js";

function setup(margin = 1_000) {
  const market: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: 100,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };
  const vault = createLiquidityVault(50_000);
  const positions = new PositionManager();
  const position: Position = {
    id: "atomic-position",
    trader: "alice",
    market: market.symbol,
    side: "LONG",
    size: 100,
    entryPrice: 100,
    margin,
  };
  positions.openPosition(position, market);
  return { market, vault, positions, position };
}

function snapshot(
  market: MarketState,
  vault: LiquidityVault,
  positions: PositionManager,
  positionId: string,
) {
  return {
    market: { ...market },
    lifecycle: positions.getPositionLifecycle(positionId),
    position: positions.getPosition(positionId),
    vault: { ...vault },
    traderPnL: vault.traderPnL,
    availableCapital: vault.availableCapital,
  };
}

class RejectingCommitManager extends PositionManager {
  override commitClosePosition(
    _prepared: PreparedPositionClose,
    _vault: LiquidityVault,
    _preparedPnL: PreparedTraderPnL,
  ): Readonly<Position> {
    throw new Error("POSITION_LIFECYCLE_COMMIT_FAILED");
  }
}

describe("atomic position settlement", () => {
  it("leaves all state unchanged when settlement calculation fails", () => {
    const { market, vault, positions, position } = setup();
    market.ammTwapPrice = Number.NaN;
    const before = snapshot(market, vault, positions, position.id);

    expect(() =>
      settleAndClosePosition(
        position.id,
        market,
        createMarketConfig(),
        positions,
        vault,
      ),
    ).toThrow("INVALID_POSITION_SETTLEMENT");

    expect(snapshot(market, vault, positions, position.id)).toEqual(before);
  });

  it("leaves all state unchanged when the position lifecycle commit fails", () => {
    const market: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 90,
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };
    const vault = createLiquidityVault(50_000);
    const positions = new RejectingCommitManager();
    const position: Position = {
      id: "lifecycle-failure",
      trader: "alice",
      market: market.symbol,
      side: "LONG",
      size: 100,
      entryPrice: 100,
      margin: 1_000,
    };
    positions.openPosition(position, market);
    const before = snapshot(market, vault, positions, position.id);

    expect(() =>
      settleAndClosePosition(
        position.id,
        market,
        createMarketConfig(),
        positions,
        vault,
      ),
    ).toThrow("POSITION_LIFECYCLE_COMMIT_FAILED");

    expect(snapshot(market, vault, positions, position.id)).toEqual(before);
  });

  it("leaves vault and position unchanged when OI release validation fails", () => {
    const { market, vault, positions, position } = setup();
    market.longOpenInterest = 50;
    const before = snapshot(market, vault, positions, position.id);

    expect(() =>
      settleAndClosePosition(
        position.id,
        market,
        createMarketConfig(),
        positions,
        vault,
      ),
    ).toThrow("POSITION_OPEN_INTEREST_MISMATCH");

    expect(snapshot(market, vault, positions, position.id)).toEqual(before);
  });

  it("does not close a position when vault accounting cannot be committed", () => {
    const { market, vault, positions, position } = setup();
    Object.freeze(vault);
    const before = snapshot(market, vault, positions, position.id);

    expect(() =>
      settleAndClosePosition(
        position.id,
        market,
        createMarketConfig(),
        positions,
        vault,
      ),
    ).toThrow("VAULT_STATE_NOT_MUTABLE");

    expect(snapshot(market, vault, positions, position.id)).toEqual(before);
  });

  it("books a successful voluntary close exactly once", () => {
    const { market, vault, positions, position } = setup();
    market.ammTwapPrice = 110;
    const before = snapshot(market, vault, positions, position.id);

    const result = settleAndClosePosition(
      position.id,
      market,
      createMarketConfig(),
      positions,
      vault,
    );

    expect(result.lifecycle).toBe("SETTLED");
    expect(result.positionId).toBe(position.id);
    expect(market.longOpenInterest).toBe(
      before.market.longOpenInterest - position.size,
    );
    expect(positions.getPositionLifecycle(position.id)).toBe("SETTLED");
    expect(positions.getPosition(position.id)).toBeUndefined();
    expect(vault.traderPnL).toBe(before.traderPnL + result.pnl);
    expect(vault.availableCapital).toBe(
      before.availableCapital - result.pnl,
    );

    const settled = snapshot(market, vault, positions, position.id);
    expect(() =>
      settleAndClosePosition(
        position.id,
        market,
        createMarketConfig(),
        positions,
        vault,
      ),
    ).toThrow("POSITION_NOT_FOUND");
    expect(snapshot(market, vault, positions, position.id)).toEqual(settled);
  });

  it("does not mutate vault or OI when the close ID is missing", () => {
    const { market, vault, positions, position } = setup();
    const before = snapshot(market, vault, positions, position.id);

    expect(() =>
      settleAndClosePosition(
        "missing-position",
        market,
        createMarketConfig(),
        positions,
        vault,
      ),
    ).toThrow("POSITION_NOT_FOUND");

    expect(snapshot(market, vault, positions, position.id)).toEqual(before);
  });

  it("books a successful liquidation exactly once", () => {
    const { market, vault, positions, position } = setup(100);
    market.ammTwapPrice = 90;
    const before = snapshot(market, vault, positions, position.id);

    const result = settleAndLiquidatePosition(
      position.id,
      market,
      createMarketConfig(),
      positions,
      vault,
      0.05,
    );

    expect(result.lifecycle).toBe("LIQUIDATED");
    expect(result.positionId).toBe(position.id);
    expect(market.longOpenInterest).toBe(
      before.market.longOpenInterest - position.size,
    );
    expect(positions.getPositionLifecycle(position.id)).toBe("LIQUIDATED");
    expect(positions.getPosition(position.id)).toBeUndefined();
    expect(vault.traderPnL).toBe(before.traderPnL + result.pnl);
    expect(vault.availableCapital).toBe(
      before.availableCapital - result.pnl,
    );

    const liquidated = snapshot(market, vault, positions, position.id);
    expect(() =>
      settleAndLiquidatePosition(
        position.id,
        market,
        createMarketConfig(),
        positions,
        vault,
        0.05,
      ),
    ).toThrow("POSITION_NOT_FOUND");
    expect(snapshot(market, vault, positions, position.id)).toEqual(liquidated);
  });

  it("leaves every recorded value unchanged when liquidation fails", () => {
    const { market, vault, positions, position } = setup();
    const before = snapshot(market, vault, positions, position.id);

    expect(() =>
      settleAndLiquidatePosition(
        position.id,
        market,
        createMarketConfig(),
        positions,
        vault,
        0.05,
      ),
    ).toThrow("POSITION_HEALTHY");

    expect(snapshot(market, vault, positions, position.id)).toEqual(before);
  });

  it("does not change financial state if liquidation lifecycle commit fails", () => {
    const market: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 90,
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };
    const vault = createLiquidityVault(50_000);
    const positions = new RejectingCommitManager();
    const position: Position = {
      id: "liquidation-lifecycle-failure",
      trader: "alice",
      market: market.symbol,
      side: "LONG",
      size: 100,
      entryPrice: 100,
      margin: 100,
    };
    positions.openPosition(position, market);
    const before = snapshot(market, vault, positions, position.id);

    expect(() =>
      settleAndLiquidatePosition(
        position.id,
        market,
        createMarketConfig(),
        positions,
        vault,
        0.05,
      ),
    ).toThrow("POSITION_LIFECYCLE_COMMIT_FAILED");

    expect(snapshot(market, vault, positions, position.id)).toEqual(before);
  });

  it("leaves vault and position unchanged when liquidation OI release validation fails", () => {
    const { market, vault, positions, position } = setup(100);
    market.ammTwapPrice = 90;
    market.longOpenInterest = 50;
    const before = snapshot(market, vault, positions, position.id);

    expect(() =>
      settleAndLiquidatePosition(
        position.id,
        market,
        createMarketConfig(),
        positions,
        vault,
        0.05,
      ),
    ).toThrow("POSITION_OPEN_INTEREST_MISMATCH");

    expect(snapshot(market, vault, positions, position.id)).toEqual(before);
  });

  it("does not liquidate a position when vault accounting cannot be committed", () => {
    const { market, vault, positions, position } = setup(100);
    market.ammTwapPrice = 90;
    Object.freeze(vault);
    const before = snapshot(market, vault, positions, position.id);

    expect(() =>
      settleAndLiquidatePosition(
        position.id,
        market,
        createMarketConfig(),
        positions,
        vault,
        0.05,
      ),
    ).toThrow("VAULT_STATE_NOT_MUTABLE");

    expect(snapshot(market, vault, positions, position.id)).toEqual(before);
  });

  it("leaves all state unchanged when liquidation PnL calculation fails", () => {
    const { market, vault, positions, position } = setup(100);
    market.ammTwapPrice = Number.NaN;
    const before = snapshot(market, vault, positions, position.id);

    expect(() =>
      settleAndLiquidatePosition(
        position.id,
        market,
        createMarketConfig(),
        positions,
        vault,
        0.05,
      ),
    ).toThrow("INVALID_MARK_PRICE");

    expect(snapshot(market, vault, positions, position.id)).toEqual(before);
  });
});

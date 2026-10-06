import type { MarketState } from "../market/MarketState.js";
import type { MarketConfig } from "../config/MarketConfig.js";
import type { PositionManager } from "../position/PositionManager.js";
import type { LiquidityVault } from "../liquidity/LiquidityVault.js";

import { markPosition } from "../risk/PositionMark.js";
import {
  assertLpBackingCovers,
  prepareTraderPnL,
} from "../liquidity/LiquidityVault.js";
import { getSettlementPrice } from "./SettlementPrice.js";

export interface SettleAndLiquidateResult {
  positionId: string;
  trader: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  settlementPrice: number;
  markPrice: number;
  pnl: number;
  marginRatio: number;
  releasedOpenInterest: number;
  realizedPnL: number;
  remainingMargin: number;
  traderSettlement: number;
  closed: boolean;
  lifecycle: "LIQUIDATED";
}

export type LiquidationResult = SettleAndLiquidateResult;

export function settleAndLiquidatePosition(
  positionId: string,
  market: MarketState,
  config: MarketConfig,
  positionManager: PositionManager,
  vault: LiquidityVault,
  maintenanceMargin: number,
): SettleAndLiquidateResult {
  const position = positionManager.getPosition(positionId);
  if (!position) {
    throw new Error("POSITION_NOT_FOUND");
  }

  if (position.market !== market.symbol) {
    throw new Error("POSITION_MARKET_MISMATCH");
  }

  const settlementPrice = getSettlementPrice(
    market,
    config,
    position,
  );
  return settleAtPrice(
    positionId,
    settlementPrice,
    market,
    positionManager,
    vault,
    maintenanceMargin,
  );
}

function settleAtPrice(
  positionId: string,
  settlementPrice: number,
  market: MarketState,
  positionManager: PositionManager,
  vault: LiquidityVault,
  maintenanceMargin: number,
): SettleAndLiquidateResult {
  const position = positionManager.getPosition(positionId);

  if (!position) {
    throw new Error("POSITION_NOT_FOUND");
  }

  if (position.market !== market.symbol) {
    throw new Error("POSITION_MARKET_MISMATCH");
  }

  // Read-only risk calculation.
  const mark = markPosition(
    position,
    settlementPrice,
    maintenanceMargin,
  );

  if (!mark.liquidatable) {
    throw new Error("POSITION_HEALTHY");
  }

  const traderClaim = Math.max(mark.equity, 0);
  assertLpBackingCovers(vault, traderClaim);

  const preparedClose = positionManager.prepareClosePosition(
    positionId,
    market,
    "LIQUIDATED",
  );
  const preparedPnL = prepareTraderPnL(vault, mark.pnl);

  positionManager.commitClosePosition(preparedClose, vault, preparedPnL);

  return {
    positionId: position.id,
    trader: position.trader,
    side: position.side,
    size: position.size,
    entryPrice: position.entryPrice,
    settlementPrice,
    markPrice: mark.markPrice,
    pnl: mark.pnl,
    marginRatio: mark.marginRatio,
    releasedOpenInterest: position.size,
    realizedPnL: mark.pnl,
    remainingMargin: traderClaim,
    traderSettlement: traderClaim,
    closed: true,
    lifecycle: "LIQUIDATED",
  };
}

export function settleAndLiquidatePositionsAtCurrentMark(
  positionIds: readonly string[],
  market: MarketState,
  config: MarketConfig,
  positionManager: PositionManager,
  vault: LiquidityVault,
  maintenanceMargin: number,
): SettleAndLiquidateResult[] {
  const marketSnapshot = { ...market };
  const results: SettleAndLiquidateResult[] = [];

  for (const positionId of positionIds) {
    const position = positionManager.getPosition(positionId);
    if (!position) {
      continue;
    }

    const settlementPrice = getSettlementPrice(
      marketSnapshot,
      config,
      position,
    );
    const mark = markPosition(
      position,
      settlementPrice,
      maintenanceMargin,
    );
    if (!mark.liquidatable) {
      continue;
    }

    results.push(
      settleAtPrice(
        positionId,
        settlementPrice,
        market,
        positionManager,
        vault,
        maintenanceMargin,
      ),
    );
  }

  return results;
}
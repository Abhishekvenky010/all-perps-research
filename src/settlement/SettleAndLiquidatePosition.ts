import type { MarketState } from "../market/MarketState.js";
import type { PositionManager } from "../position/PositionManager.js";
import type { LiquidityVault } from "../liquidity/LiquidityVault.js";

import { closePosition } from "../position/ClosePosition.js";
import { markPosition } from "../risk/PositionMark.js";
import { recordTraderPnL } from "../liquidity/LiquidityVault.js";

export interface SettleAndLiquidateResult {
  positionId: string;
  trader: string;
  markPrice: number;
  pnl: number;
  marginRatio: number;
  releasedOpenInterest: number;
  realizedPnL: number;
  remainingMargin: number;
  traderSettlement: number;
  closed: boolean;
}

export function settleAndLiquidatePosition(
  positionId: string,
  currentPrice: number,
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
    currentPrice,
    maintenanceMargin,
  );

  if (!mark.liquidatable) {
    throw new Error("POSITION_HEALTHY");
  }

  /*
   * Everything that can fail has been validated.
   * From here we commit the state changes.
   */
  recordTraderPnL(vault, mark.pnl);

  closePosition(
    positionId,
    market,
    positionManager,
  );

  const remainingMargin = Math.max(
    mark.equity,
    0,
  );

  return {
    positionId: position.id,
    trader: position.trader,
    markPrice: mark.markPrice,
    pnl: mark.pnl,
    marginRatio: mark.marginRatio,
    releasedOpenInterest: position.size,
    realizedPnL: mark.pnl,
    remainingMargin,
    traderSettlement: remainingMargin,
    closed: true,
  };
}
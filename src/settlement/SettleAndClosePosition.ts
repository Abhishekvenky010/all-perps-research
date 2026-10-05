import type { MarketState } from "../market/MarketState.js";
import type { PositionManager } from "../position/PositionManager.js";
import type { LiquidityVault } from "../liquidity/LiquidityVault.js";

import { closePosition } from "../position/ClosePosition.js";
import {
  calculatePositionSettlement,
} from "./PositionSettlement.js";
import {
  recordTraderPnL,
} from "../liquidity/LiquidityVault.js";

export interface SettleAndCloseResult {
  positionId: string;
  trader: string;
  pnl: number;
  traderSettlement: number;
  releasedOpenInterest: number;
}

export function settleAndClosePosition(
  positionId: string,
  currentPrice: number,
  market: MarketState,
  positionManager: PositionManager,
  vault: LiquidityVault,
): SettleAndCloseResult {
  const position = positionManager.getPosition(positionId);

  if (!position) {
    throw new Error("POSITION_NOT_FOUND");
  }

  if (position.market !== market.symbol) {
    throw new Error("POSITION_MARKET_MISMATCH");
  }

  // Calculate everything before mutating state.
  const settlement = calculatePositionSettlement(
    position,
    currentPrice,
  );

  // Commit the financial settlement.
  recordTraderPnL(vault, settlement.pnl);

  // Release market exposure and remove the position.
  closePosition(
    positionId,
    market,
    positionManager,
  );

  return {
    positionId: position.id,
    trader: position.trader,
    pnl: settlement.pnl,
    traderSettlement: settlement.traderSettlement,
    releasedOpenInterest: position.size,
  };
}
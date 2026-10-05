import type { Position } from "../position/Position.js";
import {
  calculateUnrealizedPnL,
} from "../risk/PnL.js";
import {
  recordTraderPnL,
  type LiquidityVault,
} from "../liquidity/LiquidityVault.js";

export interface PositionSettlementResult {
  pnl: number;
  traderSettlement: number;
}

export function calculatePositionSettlement(
  position: Position,
  currentPrice: number,
): PositionSettlementResult {
  const pnl = calculateUnrealizedPnL(
    position,
    currentPrice,
  );

  return {
    pnl,
    traderSettlement: position.margin + pnl,
  };
}

export function settlePosition(
  position: Position,
  currentPrice: number,
  vault: LiquidityVault,
): PositionSettlementResult {
  const result = calculatePositionSettlement(
    position,
    currentPrice,
  );

  recordTraderPnL(vault, result.pnl);

  return result;
}
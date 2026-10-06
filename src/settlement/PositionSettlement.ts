import type { Position } from "../position/Position.js";
import { calculateUnrealizedPnL } from "../risk/PnL.js";

export interface PositionSettlementResult {
  positionId: string;
  side: Position["side"];
  size: number;
  entryPrice: number;
  settlementPrice: number;
  pnl: number;
  traderSettlement: number;
}

export function calculatePositionSettlement(
  position: Position,
  currentPrice: number,
): PositionSettlementResult {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error("INVALID_POSITION_SETTLEMENT");
  }

  const pnl = calculateUnrealizedPnL(
    position,
    currentPrice,
  );
  const traderSettlement = position.margin + pnl;

  if (!Number.isFinite(pnl) || !Number.isFinite(traderSettlement)) {
    throw new Error("INVALID_POSITION_SETTLEMENT");
  }

  return {
    positionId: position.id,
    side: position.side,
    size: position.size,
    entryPrice: position.entryPrice,
    settlementPrice: currentPrice,
    pnl,
    traderSettlement,
  };
}
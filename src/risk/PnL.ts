import type { Position } from "../position/Position.js";


export function calculateUnrealizedPnL(
  position: Position,
  currentPrice: number,
): number {
  if (!Number.isFinite(currentPrice) || currentPrice <= 0) {
    throw new Error("INVALID_MARK_PRICE");
  }

  if (
    !Number.isFinite(position.entryPrice) ||
    position.entryPrice <= 0 ||
    !Number.isFinite(position.size) ||
    position.size <= 0 ||
    (position.side !== "LONG" && position.side !== "SHORT")
  ) {
    throw new Error("INVALID_PNL_POSITION");
  }

  const pnl = position.side === "LONG"
    ? (
      currentPrice -
      position.entryPrice
    ) * position.size
    : (
      position.entryPrice -
      currentPrice
    ) * position.size;

  if (!Number.isFinite(pnl)) {
    throw new Error("INVALID_PNL");
  }

  return pnl;

}
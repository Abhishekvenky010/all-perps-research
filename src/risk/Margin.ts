import type { Position } from "../position/Position.js";


export function calculateEquity(
  position: Position,
  pnl: number,
): number {
  if (
    !Number.isFinite(position.margin) ||
    position.margin <= 0 ||
    !Number.isFinite(pnl)
  ) {
    throw new Error("INVALID_POSITION_EQUITY");
  }

  const equity = position.margin + pnl;
  if (!Number.isFinite(equity)) {
    throw new Error("INVALID_POSITION_EQUITY");
  }

  return equity;

}



export function calculateMarginRatio(
  position: Position,
  pnl: number,
): number {
  if (!Number.isFinite(position.size) || position.size <= 0) {
    throw new Error("INVALID_POSITION_SIZE");
  }

  const marginRatio = calculateEquity(position, pnl) / position.size;
  if (!Number.isFinite(marginRatio)) {
    throw new Error("INVALID_MARGIN_RATIO");
  }

  return marginRatio;

}
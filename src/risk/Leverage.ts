import type { Position } from "../position/Position.js";


export function calculateLeverage(
  position: Position,
): number {
  if (
    !Number.isFinite(position.size) ||
    position.size <= 0 ||
    !Number.isFinite(position.margin) ||
    position.margin <= 0
  ) {
    throw new Error("INVALID_POSITION_MARGIN");
  }

  const leverage = position.size / position.margin;
  if (!Number.isFinite(leverage)) {
    throw new Error("INVALID_POSITION_LEVERAGE");
  }

  return leverage;

}


export function isLeverageAllowed(
  position: Position,
  maxLeverage: number,
): boolean {
  if (!Number.isFinite(maxLeverage) || maxLeverage <= 0) {
    throw new Error("INVALID_MAX_LEVERAGE");
  }

  return calculateLeverage(position) <= maxLeverage;

}
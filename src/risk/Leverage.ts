import type { Position } from "../position/Position.js";


export function calculateLeverage(
  position: Position,
): number {

  return (
    position.size /
    position.margin
  );

}


export function isLeverageAllowed(
  position: Position,
  maxLeverage: number,
): boolean {

  return (
    calculateLeverage(position)
    <= maxLeverage
  );

}
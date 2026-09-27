import type { Position } from "../position/Position.js";


export function calculateUnrealizedPnL(
  position: Position,
  currentPrice: number,
): number {

  if (position.side === "LONG") {

    return (
      currentPrice -
      position.entryPrice
    ) * position.size;

  }


  return (
    position.entryPrice -
    currentPrice
  ) * position.size;

}
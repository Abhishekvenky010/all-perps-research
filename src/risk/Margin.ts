import type { Position } from "../position/Position.js";


export function calculateEquity(
  position: Position,
  pnl: number,
): number {

  return position.margin + pnl;

}



export function calculateMarginRatio(
  position: Position,
  pnl: number,
): number {

  const equity =
    calculateEquity(
      position,
      pnl,
    );


  return equity / position.size;

}
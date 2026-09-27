

import type { Position } from "../position/Position.js";

import {
  calculateMarginRatio,
} from "./Margin.js";


export function isLiquidatable(
  position: Position,
  pnl: number,
  maintenanceMargin: number,
): boolean {


  const marginRatio =
    calculateMarginRatio(
      position,
      pnl,
    );


  return marginRatio < maintenanceMargin;

}
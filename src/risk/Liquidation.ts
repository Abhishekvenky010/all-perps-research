

import type { Position } from "../position/Position.js";

import {
  calculateMarginRatio,
} from "./Margin.js";


export function isLiquidatable(
  position: Position,
  pnl: number,
  maintenanceMargin: number,
): boolean {
  return isMarginRatioLiquidatable(
    calculateMarginRatio(position, pnl),
    maintenanceMargin,
  );
}

export function isMarginRatioLiquidatable(
  marginRatio: number,
  maintenanceMargin: number,
): boolean {
  if (!Number.isFinite(marginRatio)) {
    throw new Error("INVALID_MARGIN_RATIO");
  }

  if (!Number.isFinite(maintenanceMargin) || maintenanceMargin < 0) {
    throw new Error("INVALID_MAINTENANCE_MARGIN");
  }

  return marginRatio < maintenanceMargin;

}
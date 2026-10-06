import type { Position } from "../position/Position.js";

import {
  calculateUnrealizedPnL,
} from "./PnL.js";

import {
  calculateEquity,
  calculateMarginRatio,
} from "./Margin.js";

import { isMarginRatioLiquidatable } from "./Liquidation.js";


/*
  Mark price -> PnL -> equity -> margin ratio -> liquidation eligibility.

  This is the read-only half of the risk loop. Nothing here
  mutates state, so it is safe to run on every price tick.
*/
export interface PositionMark {
  positionId: string;

  trader: string;

  side: Position["side"];

  size: number;

  markPrice: number;

  pnl: number;

  equity: number;

  marginRatio: number;

  liquidatable: boolean;
}


export function markPosition(
  position: Position,
  markPrice: number,
  maintenanceMargin: number,
): PositionMark {

  if (!Number.isFinite(markPrice) || markPrice <= 0) {
    throw new Error("INVALID_MARK_PRICE");
  }

  if (
    !Number.isFinite(maintenanceMargin) ||
    maintenanceMargin < 0
  ) {
    throw new Error("INVALID_MAINTENANCE_MARGIN");
  }


  const pnl =
    calculateUnrealizedPnL(
      position,
      markPrice,
    );


  const equity =
    calculateEquity(
      position,
      pnl,
    );


  const marginRatio =
    calculateMarginRatio(
      position,
      pnl,
    );


  return {
    positionId: position.id,
    trader: position.trader,
    side: position.side,
    size: position.size,
    markPrice,
    pnl,
    equity,
    marginRatio,
    liquidatable: isMarginRatioLiquidatable(
      marginRatio,
      maintenanceMargin,
    ),
  };
}


export function markPositions(
  positions: Position[],
  markPrice: number,
  maintenanceMargin: number,
): PositionMark[] {

  return positions.map(
    position =>
      markPosition(
        position,
        markPrice,
        maintenanceMargin,
      ),
  );
}

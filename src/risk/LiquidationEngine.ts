import type { Position } from "../position/Position.js";
import type { MarketState } from "../market/MarketState.js";

import {
  markPosition,
} from "./PositionMark.js";

import {
  closePosition,
} from "../position/ClosePosition.js";

import type { PositionManager } from "../position/PositionManager.js";


export interface LiquidationResult {

  positionId: string;

  trader: string;

  markPrice: number;

  pnl: number;

  marginRatio: number;

  releasedOpenInterest: number;

  realizedPnL: number;

  remainingMargin: number;

  closed: boolean;

}



export function liquidatePosition(

  position: Position,

  currentPrice: number,

  market: MarketState,

  positionManager: PositionManager,

  maintenanceMargin: number,

): LiquidationResult {


  const mark =
    markPosition(
      position,
      currentPrice,
      maintenanceMargin,
    );


  if (!mark.liquidatable) {

    throw new Error(
      "POSITION_HEALTHY",
    );

  }



  /*
    Release market exposure and remove the position.

    closePosition is the single place where open interest
    is decremented, so a liquidation recovers exactly the
    same capacity as a voluntary close.
  */

  closePosition(
    position.id,
    market,
    positionManager,
  );



  return {

    positionId: position.id,

    trader: position.trader,

    markPrice: mark.markPrice,

    pnl: mark.pnl,

    marginRatio: mark.marginRatio,

    releasedOpenInterest: position.size,

    realizedPnL: mark.pnl,

    remainingMargin:
      Math.max(
        mark.equity,
        0,
      ),

    closed: true,

  };

}

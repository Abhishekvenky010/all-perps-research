import type { Position } from "../position/Position.js";
import type { MarketState } from "../market/MarketState.js";

import {
  calculateUnrealizedPnL,
} from "./PnL.js";

import {
  isLiquidatable,
} from "./Liquidation.js";

import type { PositionManager } from "../position/PositionManager.js";


export interface LiquidationResult {

  positionId: string;

  trader: string;

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


  const pnl = calculateUnrealizedPnL(
    position,
    currentPrice,
  );


  const equity =
    position.margin + pnl;



  const liquidatable =
    isLiquidatable(
      position,
      pnl,
      maintenanceMargin,
    );


  if (!liquidatable) {

    throw new Error(
      "POSITION_HEALTHY",
    );

  }



  /*
    Remove market exposure
  */

  if (position.side === "LONG") {

    market.longOpenInterest -=
      position.size;

  } else {

    market.shortOpenInterest -=
      position.size;

  }



  /*
    Remove position
  */

  positionManager.closePosition(
    position.id,
  );



  return {

    positionId: position.id,

    trader: position.trader,

    realizedPnL: pnl,

    remainingMargin:
      Math.max(
        equity,
        0,
      ),

    closed: true,

  };

}
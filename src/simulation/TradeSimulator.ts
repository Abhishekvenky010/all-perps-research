import type { MarketState } from "../market/MarketState.js";
import type { Side } from "../amm/Pricing.js";

import { getExecutionPrice } from "../amm/Pricing.js";
import { canIncreaseExposure } from "../amm/Capacity.js";

import type { MarketConfig } from "../config/MarketConfig.js";
import type { Position } from "../position/Position.js";
import { generatePositionId } from "../position/PositionId.js";
import { PositionManager } from "../position/PositionManager.js";


export interface TradeSimulationResult {
  averagePrice: number;
  totalCost: number;
  finalState: MarketState;
  priceHistory: number[];
  position : Position;
}


function applyExposure(
  state: MarketState,
  side: Side,
  size: number,
): void {

  if (side === "LONG") {

    state.longOpenInterest += size;

  } else {

    state.shortOpenInterest += size;

  }
}


export function simulateTrade(
  state: MarketState,
  side: Side,
  size: number,
  steps: number,
  config: MarketConfig,
  trader: string,
  positionManager: PositionManager,
): TradeSimulationResult {


  const stepSize = size / steps;

  let totalCost = 0;
  let totalSize = 0;

  const prices: number[] = [];


  for (let i = 0; i < steps; i++) {


    // Check whether trade exceeds market capacity
    if (
      !canIncreaseExposure(
        state,
        config,
        stepSize,
      )
    ) {

      throw new Error(
        "MARKET_CAPACITY_EXCEEDED",
      );

    }


    // Calculate execution price
    const executionPrice =
      getExecutionPrice(
        state,
        config,
        side,
      );


    // Accumulate trade cost
    totalCost += executionPrice * stepSize;

    totalSize += stepSize;


    // Store price movement for analysis
    prices.push(executionPrice);


    // Update market exposure
    applyExposure(
      state,
      side,
      stepSize,
    );

  }
  
  const averagePrice = totalCost / totalSize;

  const position = {

  id: generatePositionId(),

  trader,

  market: state.symbol,

  side,

  size: totalSize,

  entryPrice: averagePrice,

  margin: totalCost * 0.1,

};

positionManager.openPosition(
  position,
);

  return {

    averagePrice:
      totalCost / totalSize,

    totalCost,

    finalState: state,

    priceHistory: prices,

    position,


  };
}
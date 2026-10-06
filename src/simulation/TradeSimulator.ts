import type { MarketState } from "../market/MarketState.js";
import type { Side } from "../amm/Pricing.js";
import { getAverageExecutionPrice } from "../amm/Pricing.js";
import { canIncreaseExposure } from "../amm/Capacity.js";
import type { MarketConfig } from "../config/MarketConfig.js";
import type { Position } from "../position/Position.js";
import { validatePosition } from "../position/Position.js";
import { generatePositionId } from "../position/PositionId.js";
import type { PositionManager } from "../position/PositionManager.js";
import { isLeverageAllowed } from "../risk/Leverage.js";

export interface TradeSimulationResult {
  averagePrice: number;
  totalCost: number;
  finalState: MarketState;
  priceHistory: number[];
  position: Position;
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
  margin: number,
  positionManager: PositionManager,
): TradeSimulationResult {
  if (config.symbol !== state.symbol) {
    throw new Error("MARKET_CONFIG_MISMATCH");
  }

  if (!Number.isFinite(size) || size <= 0) {
    throw new Error("INVALID_TRADE_SIZE");
  }

  if (!Number.isInteger(steps) || steps <= 0) {
    throw new Error("INVALID_TRADE_STEPS");
  }

  // Check leverage before execution.
  const tempPosition = {
    id: "temp",
    trader,
    market: state.symbol,
    side,
    size,
    entryPrice: state.indexPrice,
    margin,
  };

  validatePosition(tempPosition);
  positionManager.assertOpenInterestMatches(state);

  if (!canIncreaseExposure(state, config, size)) {
    throw new Error("MARKET_CAPACITY_EXCEEDED");
  }

  if (!isLeverageAllowed(tempPosition, config.maxLeverage)) {
    throw new Error("MAX_LEVERAGE_EXCEEDED");
  }

  // Work on a copy so failed trades do not partially modify the market.
  const workingState = { ...state };

  const stepSize = size / steps;

  let totalCost = 0;
  let totalSize = 0;

  const prices: number[] = [];

  for (let i = 0; i < steps; i++) {
    const currentStepSize =
      i === steps - 1 ? size - totalSize : stepSize;

    // Get AMM execution price.
    const executionPrice = getAverageExecutionPrice(
      workingState,
      config,
      side,
    );

    totalCost += executionPrice * currentStepSize;
    totalSize += currentStepSize;

    prices.push(executionPrice);

    // Update only the temporary market state.
    applyExposure(workingState, side, currentStepSize);
  }

  const averagePrice = totalCost / totalSize;
  if (!Number.isFinite(averagePrice) || !Number.isFinite(totalCost)) {
    throw new Error("INVALID_TRADE_EXECUTION");
  }

  const position: Position = {
    id: generatePositionId(),
    trader,
    market: state.symbol,
    side,
    size: totalSize,
    entryPrice: averagePrice,
    margin,
  };

  const storedPosition = positionManager.openPosition(
    position,
    state,
    config.maxCapacity,
  );

  return {
    averagePrice,
    totalCost,
    finalState: state,
    priceHistory: prices,
    position: storedPosition,
  };
}
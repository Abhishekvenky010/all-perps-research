import type { MarketState } from "../market/MarketState.js";
import type { MarketConfig } from "../config/MarketConfig.js";

import { getTotalOpenInterest } from "../market/MarketMath.js";


export function canIncreaseExposure(
  state: MarketState,
  config: MarketConfig,
  size: number,
): boolean {

  const newExposure =
    getTotalOpenInterest(state) + size;

  return newExposure <= config.maxCapacity;
}


export function getRemainingCapacity(
  state: MarketState,
  config: MarketConfig,
): number {

  return (
    config.maxCapacity -
    getTotalOpenInterest(state)
  );
}
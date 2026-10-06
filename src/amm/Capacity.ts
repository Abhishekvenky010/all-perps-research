import type { MarketState } from "../market/MarketState.js";
import type { MarketConfig } from "../config/MarketConfig.js";

import { getTotalOpenInterest } from "../market/MarketMath.js";

export function canIncreaseExposure(
  state: MarketState,
  config: MarketConfig,
  size: number,
): boolean {
  if (
    !Number.isFinite(size) ||
    size < 0 ||
    !Number.isFinite(config.maxCapacity) ||
    config.maxCapacity < 0
  ) {
    return false;
  }

  const totalOpenInterest = getTotalOpenInterest(state);
  return (
    Number.isFinite(totalOpenInterest) &&
    totalOpenInterest >= 0 &&
    totalOpenInterest + size <= config.maxCapacity
  );
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
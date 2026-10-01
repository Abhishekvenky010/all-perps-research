import type { MarketState } from "../market/MarketState.js";
import type { MarketConfig } from "../config/MarketConfig.js";

import { getTotalOpenInterest } from "../market/MarketMath.js";


/*
  Relative tolerance for the capacity boundary.

  Trade execution splits a fill into steps, so the step size
  is size / steps and open interest accumulates by repeated
  addition. When that division is not exact in binary floating
  point the final step can land microscopically past
  maxCapacity: filling 80_000 + 20_000 in 3 steps accumulates
  to 100_000.00000000001 and is rejected even though the trade
  fits exactly.

  Comparing against a tiny relative tolerance absorbs that
  rounding error. It is deliberately orders of magnitude
  smaller than any real trade, so a genuinely oversized trade
  is still rejected.
*/
const CAPACITY_TOLERANCE = 1e-9;


export function canIncreaseExposure(
  state: MarketState,
  config: MarketConfig,
  size: number,
): boolean {

  const newExposure =
    getTotalOpenInterest(state) + size;

  const tolerance =
    Math.abs(config.maxCapacity) *
    CAPACITY_TOLERANCE;

  return newExposure <=
    config.maxCapacity + tolerance;
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
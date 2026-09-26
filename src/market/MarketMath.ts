import type { MarketState } from "./MarketState.js";
import type { MarketConfig } from "../config/MarketConfig.js";

export function getSkew(state: MarketState): number {
  return state.longOpenInterest - state.shortOpenInterest;
}


export function getSkewRatio(state: MarketState, config: MarketConfig): number {
  return getSkew(state) / config.maxCapacity;
}


export function getTotalOpenInterest(state: MarketState): number {
  return (
    state.longOpenInterest +
    state.shortOpenInterest
  );
}


export function getCapacityUsage(state: MarketState, config: MarketConfig): number {
  return (
    getTotalOpenInterest(state) /
    config.maxCapacity
  );
}
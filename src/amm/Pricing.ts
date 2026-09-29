import type { MarketState } from "../market/MarketState.js";
import type { MarketConfig } from "../config/MarketConfig.js";
import { getSkewRatio, getCapacityUsage } from "../market/MarketMath.js";
import {
  getSkewImpact,
  getCapacityImpact,
} from "./ImpactModel.js";
import { getSkew } from "../market/MarketMath.js";


export type Side = "LONG" | "SHORT";


export function getExecutionPrice(
  state: MarketState,
  config: MarketConfig,
  side: Side,
): number {
  const skewRatio = getSkewRatio(state, config);
  const capacityUsage = getCapacityUsage(state, config);

  const skewImpact = getSkewImpact(
    skewRatio,
    config.skewCoefficient,
  );

  const capacityImpact = getCapacityImpact(
    capacityUsage,
    config.capacityCoefficient,
  );

  const totalImpact = skewImpact + capacityImpact;
  const basePrice = state.ammTwapPrice;

  const executionPrice =
    side === "LONG"
      ? basePrice * (1 + totalImpact)
      : basePrice * (1 - totalImpact);

  console.log("=== AMM Pricing Diagnostic ===");
  console.log({
    side,
    longOpenInterest: state.longOpenInterest,
    shortOpenInterest: state.shortOpenInterest,
    basePrice,
    skewRatio,
    capacityUsage,
    skewImpact,
    capacityImpact,
    totalImpact,
    executionPrice,
  });

  return executionPrice;
}


import { getBoundedCapacityImpact } from "./ImpactModel.js";

export function getBoundedExecutionPrice(
  state: MarketState,
  config: MarketConfig,
  side: Side,
): number {
  const skewRatio = getSkewRatio(state, config);
  const capacityUsage = getCapacityUsage(state, config);

  const skewImpact = getSkewImpact(
    skewRatio,
    config.skewCoefficient,
  );

  const capacityImpact = getBoundedCapacityImpact(
    capacityUsage,
    0.10,
  );

  const totalImpact = skewImpact + capacityImpact;
  const basePrice = state.ammTwapPrice;

  return side === "LONG"
    ? basePrice * (1 + totalImpact)
    : basePrice * (1 - totalImpact);
}

export function getConvexExecutionPrice(
  state: MarketState,
  config: MarketConfig,
  side: Side,
): number {

  const skewRatio =
    Math.abs(getSkewRatio(state,config));


  const impact =
    config.skewCoefficient *
    Math.pow(skewRatio, 2);


  if (side === "LONG") {
    return state.indexPrice * (1 + impact);
  }


  return state.indexPrice * (1 - impact);
}
export function getAverageExecutionPrice(
  state: MarketState,
  config: MarketConfig,
  side: "LONG" | "SHORT",
): number {
  const skew = getSkew(state);
  const skewRatio = skew / config.maxCapacity;

  const totalOI =
    state.longOpenInterest + state.shortOpenInterest;

  const capacityUsage = totalOI / config.maxCapacity;

  const skewImpact = getSkewImpact(
    skewRatio,
    config.skewCoefficient,
  );

  const capacityImpact = getCapacityImpact(
    capacityUsage,
    config.capacityCoefficient,
  );

  const totalImpact =
    (Math.abs(skewImpact) + capacityImpact) / 2;

  const basePrice = state.ammTwapPrice;

  return side === "LONG"
    ? basePrice * (1 + totalImpact)
    : basePrice * (1 - totalImpact);
}
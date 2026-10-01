import type { MarketState } from "../market/MarketState.js";
import type { MarketConfig } from "../config/MarketConfig.js";
import { getSkewRatio, getCapacityUsage } from "../market/MarketMath.js";
import {
  getSkewImpact,
  getFairValue,
  getExecutionPriceFromImpact,
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

  const executionPrice = getExecutionPriceFromImpact(
    state.ammTwapPrice,
    skewRatio,
    config.skewCoefficient,
    capacityUsage,
    config.capacityCoefficient,
    side,
  );

  const fairValue = getFairValue(
    state.ammTwapPrice,
    skewRatio,
    config.skewCoefficient,
  );

  console.log("=== AMM Pricing Diagnostic ===");
  console.log({
    side,
    longOpenInterest: state.longOpenInterest,
    shortOpenInterest: state.shortOpenInterest,
    basePrice: state.ammTwapPrice,
    skewRatio,
    capacityUsage,
    fairValue,
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

  const fairValue = getFairValue(
    state.ammTwapPrice,
    skewRatio,
    config.skewCoefficient,
  );

  const capacityImpact = getBoundedCapacityImpact(
    capacityUsage,
    0.10,
  );

  // Same shape as getExecutionPrice: skew sets the fair value,
  // capacity widens a symmetric spread around it.
  const basePrice = fairValue;

  return side === "LONG"
    ? basePrice * (1 + capacityImpact)
    : basePrice * (1 - capacityImpact);
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

export function getCurrentAmmPrice(
  state: MarketState,
  config: MarketConfig,
): number {
  const skewRatio = getSkewRatio(state, config);

  const skewImpact = getSkewImpact(
    skewRatio,
    config.skewCoefficient,
  );

  return state.ammTwapPrice * (1 + skewImpact);
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

  const fairValue = getFairValue(
    state.ammTwapPrice,
    skewRatio,
    config.skewCoefficient,
  );

  // Halved spread, matching the original averaging intent.
  const capacityImpact =
    getCapacityImpact(
      capacityUsage,
      config.capacityCoefficient,
    ) / 2;

  return side === "LONG"
    ? fairValue * (1 + capacityImpact)
    : fairValue * (1 - capacityImpact);
}
import type { MarketState } from "../market/MarketState.js";
import type { MarketConfig } from "../config/MarketConfig.js";
import { getSkewRatio, getCapacityUsage } from "../market/MarketMath.js";
import {
  getSkewImpact,
  getCapacityImpact,
} from "./ImpactModel.js";


export type Side = "LONG" | "SHORT";


export function getExecutionPrice(
  state: MarketState,
  config: MarketConfig,
  side: Side,
  
): number {

 const skewRatio =
  getSkewRatio(
    state,
    config,
  );


const capacityUsage =
  getCapacityUsage(
    state,
    config,
  );


const skewImpact =
  getSkewImpact(
    skewRatio,
    config.skewCoefficient,
  );


const capacityImpact =
  getCapacityImpact(
    capacityUsage,
    config.capacityCoefficient,
  );

  const totalImpact =
    skewImpact + capacityImpact;


  if (side === "LONG") {

    return (
      state.indexPrice *
      (1 + totalImpact)
    );

  }


  return (
    state.indexPrice *
    (1 - totalImpact)
  );
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
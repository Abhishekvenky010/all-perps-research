import type { MarketState } from "../market/MarketState.js";
import type { ReferencePriceSource } from "./ReferencePriceSource.js";
import {
  calculateTWAP,
  recordPriceObservation,
  type PriceObservation,
} from "./TWAPOracle.js";

export interface ReferencePriceUpdate {
  market: MarketState;
  observations: PriceObservation[];
}

export function updateMarketFromReferencePrice(
  market: MarketState,
  observations: PriceObservation[],
  source: ReferencePriceSource,
  now: number,
): ReferencePriceUpdate {
  const observation = source.getLatestObservation();
  if (!observation) {
    throw new Error("NO_REFERENCE_PRICE_OBSERVATION");
  }

  if (observation.timestamp > now) {
    throw new Error("FUTURE_PRICE_OBSERVATION");
  }

  const nextObservations = recordPriceObservation(
    observations,
    observation,
  );
  const twap = calculateTWAP(nextObservations, now);
  const nextMarket: MarketState = {
    ...market,
    indexPrice: observation.price,
    ...(twap === null ? {} : { ammTwapPrice: twap }),
  };

  return {
    market: nextMarket,
    observations: nextObservations,
  };
}

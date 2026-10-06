import type { MarketState } from "../market/MarketState.js";
import type { MarketConfig } from "../config/MarketConfig.js";
import { getCurrentAmmPrice } from "../amm/Pricing.js";
import {
  recordPriceObservation,
  type PriceObservation,
} from "./TWAPOracle.js";

// Research simulation only: deliberately feeds the protocol-derived mark
// back into observations to study a feedback-loop scenario.
export function recordSimulatedProtocolMarkObservation(
  observations: PriceObservation[],
  state: MarketState,
  config: MarketConfig,
  timestamp: number,
): PriceObservation[] {
  const ammPrice = getCurrentAmmPrice(state, config);

  return recordPriceObservation(observations, {
    timestamp,
    price: ammPrice,
  });
}
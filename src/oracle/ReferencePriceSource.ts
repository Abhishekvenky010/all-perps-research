import type { PriceObservation } from "./TWAPOracle.js";

export interface ReferencePriceSource {
  getLatestObservation(): PriceObservation | undefined;
}

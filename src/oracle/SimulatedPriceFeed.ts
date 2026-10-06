
import type { PriceObservation } from "./TWAPOracle.js";
import { recordPriceObservation } from "./TWAPOracle.js";
import type { ReferencePriceSource } from "./ReferencePriceSource.js";

// Test/research adapter only; it is not an authenticated external price source.
export class SimulatedPriceFeed implements ReferencePriceSource {
  private observations: PriceObservation[] = [];

  recordPrice(price: number, timestamp: number): void {
    this.observations = recordPriceObservation(this.observations, {
      price,
      timestamp,
    });
  }

  getObservations(): PriceObservation[] {
    return [...this.observations];
  }

  getLatestObservation(): PriceObservation | undefined {
    const latest = this.observations.at(-1);
    return latest ? { ...latest } : undefined;
  }
}
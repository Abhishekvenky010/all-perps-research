
import type { PriceObservation } from "./TWAPOracle.js";

export class SimulatedPriceFeed {
  private observations: PriceObservation[] = [];

  // Record a new underlying asset price.
  recordPrice(price: number, timestamp: number): void {
    if (
      !Number.isFinite(price) ||
      price <= 0 ||
      !Number.isFinite(timestamp)
    ) {
      throw new Error("INVALID_PRICE_OBSERVATION");
    }

    const last = this.observations.at(-1);

    if (last && timestamp < last.timestamp) {
      throw new Error("TIMESTAMP_CANNOT_GO_BACKWARD");
    }

    const observation = { price, timestamp };

    if (last && timestamp === last.timestamp) {
      this.observations[this.observations.length - 1] =
        observation;
    } else {
      this.observations.push(observation);
    }
  }

  // Return a copy of the recorded observations.
  getObservations(): PriceObservation[] {
    return [...this.observations];
  }
}
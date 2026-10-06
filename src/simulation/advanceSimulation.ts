import type { SimulationEnvironment } from "./SimulationEnvironment.js";
import { recordSimulatedProtocolMarkObservation } from "../oracle/SimulatedProtocolMarkObservation.js";
import { updateAmmTwap } from "../oracle/TWAPOracle.js";

// Research simulation: intentionally evolves observations from the
// protocol-derived mark; production reference ingestion uses another service.
export function advanceSimulation(
  environment: SimulationEnvironment,
  seconds: number,
): SimulationEnvironment {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("INVALID_TIME_STEP");
  }

  const timestamp = environment.timestamp + seconds;

  const observations = recordSimulatedProtocolMarkObservation(
    environment.priceFeed.getObservations(),
    environment.market,
    environment.config,
    timestamp,
  );

  const market = updateAmmTwap(
    environment.market,
    observations,
    timestamp,
  );

  const latestObservation = observations.at(-1);

  if (!latestObservation) {
    throw new Error("NO_AMM_PRICE_OBSERVATION");
  }

  environment.priceFeed.recordPrice(
    latestObservation.price,
    timestamp,
  );

  return {
    market,
    config: environment.config,
    priceFeed: environment.priceFeed,
    timestamp,
  };
}
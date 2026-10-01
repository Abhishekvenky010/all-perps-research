import type { SimulationEnvironment } from "./SimulationEnvironment.js";
import { recordAmmPriceObservation } from "../oracle/AmmPriceService.js";
import { updateAmmTwap } from "../oracle/TWAPOracle.js";

export function advanceSimulation(
  environment: SimulationEnvironment,
  seconds: number,
): SimulationEnvironment {
  if (!Number.isFinite(seconds) || seconds <= 0) {
    throw new Error("INVALID_TIME_STEP");
  }

  const timestamp = environment.timestamp + seconds;

  const observations = recordAmmPriceObservation(
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
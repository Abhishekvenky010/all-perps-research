
import type { MarketState } from "../market/MarketState.js";

export interface PriceObservation {
  timestamp: number; // Unix timestamp in seconds
  price: number;
}

const TWAP_WINDOW = 15 * 60;

export function recordPriceObservation(
  observations: PriceObservation[],
  observation: PriceObservation,
): PriceObservation[] {
  validatePriceObservation(observation);

  for (const existing of observations) {
    validatePriceObservation(existing);
  }

  const sorted = [...observations].sort(
    (a, b) => a.timestamp - b.timestamp,
  );

  const last = sorted[sorted.length - 1];

  if (last && observation.timestamp < last.timestamp) {
    throw new Error("Observation timestamp cannot go backward");
  }

  // Replace an observation at the same timestamp.
  if (last && observation.timestamp === last.timestamp) {
    sorted[sorted.length - 1] = observation;
  } else {
    sorted.push(observation);
  }

  const cutoff = observation.timestamp - TWAP_WINDOW;

  // Preserve the latest observation at or before the cutoff.
  let anchorIndex = -1;

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    if (item && item.timestamp <= cutoff) {
      anchorIndex = i;
    }
  }

  return sorted.slice(Math.max(0, anchorIndex));
}

export function validatePriceObservation(
  observation: PriceObservation,
): void {
  if (
    !Number.isFinite(observation.timestamp) ||
    observation.timestamp < 0 ||
    !Number.isFinite(observation.price) ||
    observation.price <= 0
  ) {
    throw new Error("INVALID_PRICE_OBSERVATION");
  }
}

export function calculateTWAP(
  observations: PriceObservation[],
  now: number,
): number | null {
  if (!Number.isFinite(now) || now < 0) {
    throw new Error("INVALID_TWAP_TIME");
  }

  if (observations.length === 0) {
    return null;
  }

  for (const observation of observations) {
    validatePriceObservation(observation);
  }

  const sorted = [...observations].sort(
    (a, b) => a.timestamp - b.timestamp,
  );

  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i]?.timestamp === sorted[i - 1]?.timestamp) {
      throw new Error("DUPLICATE_OBSERVATION_TIMESTAMP");
    }
  }

  const windowStart = now - TWAP_WINDOW;

  let startIndex = -1;

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    if (item && item.timestamp <= windowStart) {
      startIndex = i;
    }
  }

  // Require a complete 15-minute history.
  if (startIndex === -1) {
    return null;
  }

  let weightedPrice = 0;

  for (let i = startIndex; i < sorted.length; i++) {
    const current = sorted[i];
    if (!current || current.timestamp >= now) break;

    const next = sorted[i + 1];

    const intervalStart = Math.max(
      current.timestamp,
      windowStart,
    );

    const intervalEnd = Math.min(
      next?.timestamp ?? now,
      now,
    );

    const duration = Math.max(
      0,
      intervalEnd - intervalStart,
    );

    weightedPrice += current.price * duration;
    if (!Number.isFinite(weightedPrice)) {
      throw new Error("INVALID_TWAP");
    }
  }

  const twap = weightedPrice / TWAP_WINDOW;
  if (!Number.isFinite(twap) || twap <= 0) {
    throw new Error("INVALID_TWAP");
  }

  return twap;
}

export function updateAmmTwap(
  state: MarketState,
  observations: PriceObservation[],
  now: number,
): MarketState {
  const twap = calculateTWAP(observations, now);

  if (twap === null) {
    return state;
  }

  return {
    ...state,
    ammTwapPrice: twap,
  };
}
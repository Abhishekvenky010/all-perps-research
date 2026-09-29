
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
  if (
    !Number.isFinite(observation.timestamp) ||
    !Number.isFinite(observation.price) ||
    observation.price <= 0
  ) {
    throw new Error("Invalid price observation");
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

export function calculateTWAP(
  observations: PriceObservation[],
  now: number,
): number | null {
  if (!Number.isFinite(now) || observations.length === 0) {
    return null;
  }

  const sorted = [...observations].sort(
    (a, b) => a.timestamp - b.timestamp,
  );

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
  }

  return weightedPrice / TWAP_WINDOW;
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
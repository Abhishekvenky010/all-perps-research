import { describe, it, expect } from "vitest";
import {
  calculateTWAP,
  recordPriceObservation,
  type PriceObservation,
} from "../src/oracle/TWAPOracle.js";

describe("calculateTWAP", () => {
  it("calculates a time-weighted average", () => {
    const now = 900;

    const observations = [
      { timestamp: 0, price: 100 },
      { timestamp: 450, price: 110 },
    ];

    const result = calculateTWAP(observations, now);

    expect(result).toBe(105);
  });

  it("returns null when history is insufficient", () => {
    const result = calculateTWAP(
      [{ timestamp: 100, price: 100 }],
      900,
    );

    expect(result).toBeNull();
  });

  it("uses the latest price through the current time", () => {
    const now = 900;

    const observations = [
      { timestamp: 0, price: 100 },
      { timestamp: 600, price: 110 },
    ];

    const result = calculateTWAP(observations, now);

    expect(result).toBeCloseTo(103.3333, 3);
  });

  it("calculates a constant price across a complete window", () => {
    expect(calculateTWAP([
      { timestamp: 0, price: 100 },
      { timestamp: 300, price: 100 },
      { timestamp: 600, price: 100 },
      { timestamp: 900, price: 100 },
    ], 900)).toBe(100);
  });

  it("uses the exact 900-second window and excludes a zero-duration endpoint", () => {
    expect(calculateTWAP([
      { timestamp: 0, price: 100 },
      { timestamp: 450, price: 110 },
      { timestamp: 900, price: 1_000 },
    ], 900)).toBe(105);
  });

  it("weights multiple observation intervals by elapsed seconds", () => {
    expect(calculateTWAP([
      { timestamp: 0, price: 100 },
      { timestamp: 300, price: 110 },
      { timestamp: 600, price: 90 },
      { timestamp: 900, price: 200 },
    ], 900)).toBe(100);
  });

  it("prunes old history while retaining the observation that anchors the window", () => {
    let observations: PriceObservation[] = [];
    for (let timestamp = 0; timestamp <= 1_800; timestamp += 300) {
      observations = recordPriceObservation(observations, {
        timestamp,
        price: 100 + timestamp / 300,
      });
    }

    expect(observations.map(({ timestamp }) => timestamp)).toEqual([
      900, 1_200, 1_500, 1_800,
    ]);
  });

  it("rejects malformed direct TWAP history rather than calculating from it", () => {
    expect(() => calculateTWAP([
      { timestamp: 0, price: Number.NaN },
    ], 900)).toThrow("INVALID_PRICE_OBSERVATION");
  });
});
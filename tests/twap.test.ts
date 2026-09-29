import { describe, it, expect } from "vitest";
import { calculateTWAP } from "../src/oracle/TWAPOracle.js";

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
});
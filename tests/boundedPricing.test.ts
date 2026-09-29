
import { describe, it, expect } from "vitest";
import {
  getBoundedCapacityImpact,
} from "../src/amm/ImpactModel.js";
import {
  getBoundedExecutionPrice,
} from "../src/amm/Pricing.js";

const config = {
  symbol: "BTC-PERP",
  maxCapacity: 100_000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 20,
};

describe("Bounded Capacity Impact", () => {
  it("caps capacity impact at 10%", () => {
    expect(getBoundedCapacityImpact(0)).toBe(0);
    expect(getBoundedCapacityImpact(0.4)).toBeCloseTo(0.04);
    expect(getBoundedCapacityImpact(0.8)).toBeCloseTo(0.08);
    expect(getBoundedCapacityImpact(1)).toBeCloseTo(0.10);
  });

  it("rejects invalid capacity usage", () => {
    expect(() => getBoundedCapacityImpact(1.1)).toThrow();
    expect(() => getBoundedCapacityImpact(-0.1)).toThrow();
  });

  it("prices a balanced market using bounded capacity impact", () => {
    const state = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 101,
      longOpenInterest: 20_000,
      shortOpenInterest: 20_000,
    };

    expect(
      getBoundedExecutionPrice(state, config, "LONG"),
    ).toBeCloseTo(105.04);
  });

  it("prices a crowded long market using bounded capacity impact", () => {
    const state = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 101,
      longOpenInterest: 60_000,
      shortOpenInterest: 20_000,
    };

    expect(
      getBoundedExecutionPrice(state, config, "LONG"),
    ).toBeCloseTo(117.16);
  });
});
import { describe, it, expect } from "vitest";

import {
  getSkewImpact,
  getCapacityImpact,
} from "../src/amm/ImpactModel.js";


describe("Impact Model", () => {

  it("calculates skew impact", () => {

    const impact = getSkewImpact(
      0.5,
      0.2,
    );

    expect(impact)
      .toBeCloseTo(0.1);

  });


  it("increases capacity impact near limit", () => {

    const healthy =
      getCapacityImpact(
        0.5,
        0.2,
      );


    const dangerous =
      getCapacityImpact(
        0.9,
        0.2,
      );


    expect(dangerous)
      .toBeGreaterThan(healthy);

  });


});
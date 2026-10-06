import {
  describe,
  it,
  expect,
} from "vitest";

import {
  linearSkewImpact,
  quadraticSkewImpact,
  cubicSkewImpact,
} from "../src/amm/SkewCurves.js";

function marginalImpact(
  curve: (
    skewRatio: number,
    coefficient: number,
  ) => number,
  skewRatio: number,
  coefficient: number,
  delta = 0.01,
): number {
  return (
    curve(skewRatio + delta, coefficient) -
    curve(skewRatio, coefficient)
  ) / delta;
}

describe("Experimental skew curves", () => {
  const coefficient = 0.2;

  it("linear curve has constant marginal impact", () => {
    const low = marginalImpact(
      linearSkewImpact,
      0.1,
      coefficient,
    );

    const high = marginalImpact(
      linearSkewImpact,
      0.9,
      coefficient,
    );

    expect(low).toBeCloseTo(high, 10);
  });

  it("quadratic curve has increasing marginal impact", () => {
    const low = marginalImpact(
      quadraticSkewImpact,
      0.1,
      coefficient,
    );

    const medium = marginalImpact(
      quadraticSkewImpact,
      0.5,
      coefficient,
    );

    const high = marginalImpact(
      quadraticSkewImpact,
      0.9,
      coefficient,
    );

    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
  });

  it("cubic curve has increasing marginal impact", () => {
    const low = marginalImpact(
      cubicSkewImpact,
      0.1,
      coefficient,
    );

    const medium = marginalImpact(
      cubicSkewImpact,
      0.5,
      coefficient,
    );

    const high = marginalImpact(
      cubicSkewImpact,
      0.9,
      coefficient,
    );

    expect(low).toBeLessThan(medium);
    expect(medium).toBeLessThan(high);
  });

  it("all curves start at zero skew impact", () => {
    expect(
      linearSkewImpact(0, coefficient),
    ).toBe(0);

    expect(
      quadraticSkewImpact(0, coefficient),
    ).toBe(0);

    expect(
      cubicSkewImpact(0, coefficient),
    ).toBe(0);
  });
});
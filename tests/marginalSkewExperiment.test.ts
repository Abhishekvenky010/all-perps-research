import { describe, it } from "vitest";

import {
  linearSkewImpact,
  quadraticSkewImpact,
  cubicSkewImpact,
} from "../src/amm/SkewCurves.js";

describe("Marginal skew experiment", () => {
  it("compares marginal cost as skew increases", () => {
    const coefficient = 0.2;
    const delta = 0.01;

    const skews = [0.1, 0.5, 0.9];

    for (const skew of skews) {
      const linearMarginal =
        (linearSkewImpact(skew + delta, coefficient) -
          linearSkewImpact(skew, coefficient)) /
        delta;

      const quadraticMarginal =
        (quadraticSkewImpact(skew + delta, coefficient) -
          quadraticSkewImpact(skew, coefficient)) /
        delta;

      const cubicMarginal =
        (cubicSkewImpact(skew + delta, coefficient) -
          cubicSkewImpact(skew, coefficient)) /
        delta;

      console.log("\nSkew:", `${skew * 100}%`, {
        linearMarginal,
        quadraticMarginal,
        cubicMarginal,
      });
    }
  });
});
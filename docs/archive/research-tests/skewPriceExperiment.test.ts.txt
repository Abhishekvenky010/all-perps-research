import { describe, it } from "vitest";

import {
  linearSkewImpact,
  quadraticSkewImpact,
  cubicSkewImpact,
} from "../src/amm/SkewCurves.js";

describe("Skew price experiment", () => {
  it("compares AMM price behavior across candidate curves", () => {
    const coefficient = 0.2;
    const referencePrice = 100;

    const skews = [
      0.1,
      0.5,
      0.9,
      0.99,
    ];

    for (const skew of skews) {
      const linearPrice =
        referencePrice *
        (1 + linearSkewImpact(skew, coefficient));

      const quadraticPrice =
        referencePrice *
        (1 + quadraticSkewImpact(skew, coefficient));

      const cubicPrice =
        referencePrice *
        (1 + cubicSkewImpact(skew, coefficient));

      console.log(
        "\nSkew:",
        `${skew * 100}%`,
        {
          linear: linearPrice,
          quadratic: quadraticPrice,
          cubic: cubicPrice,
        },
      );
    }
  });
});
import { describe, it } from "vitest";

function linear(
  s: number,
  k: number,
): number {
  return k * s;
}

function quadratic(
  s: number,
  k: number,
): number {
  return k * s * s;
}

function cubic(
  s: number,
  k: number,
): number {
  return k * s * s * s;
}

function capacityBarrier(
  s: number,
  k: number,
): number {
  return k * (s / (1 - s));
}

function marginalImpact(
  curve: (s: number, k: number) => number,
  s: number,
  k: number,
  delta = 0.01,
): number {
  return (
    curve(s + delta, k) -
    curve(s, k)
  ) / delta;
}

describe("Curve comparison", () => {
  it("compares impact and marginal impact", () => {
    const skews = [
      0.1,
      0.5,
      0.9,
    ];

    const k = 0.2;

    for (const s of skews) {
      console.log(
        "\nSkew:",
        s,
        {
          linear: {
            impact: linear(s, k),
            marginal: marginalImpact(
              linear,
              s,
              k,
            ),
          },

          quadratic: {
            impact: quadratic(s, k),
            marginal: marginalImpact(
              quadratic,
              s,
              k,
            ),
          },

          cubic: {
            impact: cubic(s, k),
            marginal: marginalImpact(
              cubic,
              s,
              k,
            ),
          },

          capacity: {
            impact: capacityBarrier(s, k),
            marginal: marginalImpact(
              capacityBarrier,
              s,
              k,
            ),
          },
        },
      );
    }
  });
});
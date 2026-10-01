import { describe, it, expect } from "vitest";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

import {
  getExecutionPrice,
  getCurrentAmmPrice,
} from "../src/amm/Pricing.js";

import {
  getCapacityImpact,
} from "../src/amm/ImpactModel.js";


const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: 100_000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 20,
};


function makeState(
  longOpenInterest: number,
  shortOpenInterest: number,
  twap = 100,
): MarketState {
  return {
    symbol: "BTC-PERP",
    indexPrice: twap,
    ammTwapPrice: twap,
    longOpenInterest,
    shortOpenInterest,
  };
}


/*
  getExecutionPrice writes a diagnostic to stdout on every
  call. Silence it so the test output stays readable; the
  assertions are unaffected.
*/
function price(
  state: MarketState,
  side: "LONG" | "SHORT",
): number {

  const original = console.log;

  console.log = () => {};

  try {
    return getExecutionPrice(state, config, side);
  } finally {
    console.log = original;
  }
}


describe("AMM pricing invariants", () => {

  /*
    1. Balanced market -> execution price is around TWAP.

    Skew sets the fair value and capacity sets a symmetric
    spread around it. A balanced market has no skew, so the
    fair value is the TWAP and the two quotes straddle it.
  */
  it("prices a balanced market around the TWAP", () => {
    const state = makeState(40_000, 40_000);

    // No skew, so the fair value is exactly the TWAP.
    expect(getCurrentAmmPrice(state, config))
      .toBeCloseTo(100, 10);

    // The spread brackets the TWAP symmetrically.
    const long = price(state, "LONG");
    const short = price(state, "SHORT");

    expect(long).toBeCloseTo(120, 6);
    expect(short).toBeCloseTo(80, 6);
    expect((long + short) / 2).toBeCloseTo(100, 6);
  });

  it("widens the spread symmetrically as a balanced market fills", () => {
    for (const usage of [0.2, 0.4, 0.6, 0.8]) {
      const oi = usage * config.maxCapacity;

      const state = makeState(oi / 2, oi / 2);

      const long = price(state, "LONG");
      const short = price(state, "SHORT");

      // Midpoint stays on the TWAP: capacity only widens.
      expect((long + short) / 2).toBeCloseTo(100, 6);
      expect(long).toBeGreaterThan(100);
      expect(short).toBeLessThan(100);
    }
  });

  it("prices an empty market exactly at the TWAP", () => {
    const state = makeState(0, 0);

    expect(price(state, "LONG")).toBeCloseTo(100, 10);
    expect(price(state, "SHORT")).toBeCloseTo(100, 10);
  });


  /*
    2. Increasing LONG skew -> LONG price increases.

    Utilization is held at 80% so capacity impact is constant
    and only the skew term varies.
  */
  it("raises the LONG price as LONG skew increases", () => {
    const skews = [0, 0.2, 0.4, 0.6, 0.8];

    const prices = skews.map((skew) => {
      // Total OI fixed at 80_000, skew = long - short.
      const long = 40_000 + (skew * 80_000) / 2;
      const short = 80_000 - long;

      return price(
        makeState(long, short),
        "LONG",
      );
    });

    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]!).toBeGreaterThan(
        prices[i - 1]!,
      );
    }

    // Monotonic: 120 at zero skew up to 135.36.
    expect(prices[0]).toBeCloseTo(120, 6);
    expect(prices.at(-1)).toBeCloseTo(135.36, 6);
  });


  /*
    3. Increasing SHORT skew -> SHORT price decreases.

    Skew moves the fair value itself, so a short-crowded book
    has a lower fair value and SHORT entry is quoted below the
    TWAP. Capacity then widens the spread symmetrically around
    that fair value, so the LONG and SHORT quotes bracket it
    rather than skewing it.
  */
  it("lowers the SHORT price as SHORT skew increases", () => {
    const skews = [0, 0.2, 0.4, 0.6, 0.8];

    const prices = skews.map((skew) => {
      // Utilization held at 80%, mirrored from the LONG case.
      const short = 40_000 + (skew * 80_000) / 2;
      const long = 80_000 - short;

      return price(
        makeState(long, short),
        "SHORT",
      );
    });

    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]!).toBeLessThan(prices[i - 1]!);
    }

    expect(prices[0]).toBeCloseTo(80, 6);
    expect(prices.at(-1)).toBeCloseTo(69.76, 6);
  });

  it("keeps SHORT price monotonic across the full short range", () => {
    const prices = [0, 10_000, 20_000, 50_000, 80_000, 90_000]
      .map((shortOI) =>
        price(
          makeState(0, shortOI),
          "SHORT",
        ),
      );

    for (let i = 1; i < prices.length; i++) {
      expect(prices[i]!).toBeLessThan(prices[i - 1]!);
    }

    expect(prices.at(-1)).toBeCloseTo(45.1, 6);
  });

  it("brackets the fair value symmetrically in a short-crowded book", () => {
    /*
      Capacity impact is unsigned, so it must not be added to
      skew impact: that would push LONG up and SHORT down as a
      permanent directional tax, which is not what a full
      market should mean. It widens the spread around the fair
      value instead.
    */
    for (const shortOI of [10_000, 30_000, 50_000, 80_000, 90_000]) {
      const state = makeState(0, shortOI);

      // Fair value implied by skew alone, no capacity spread.
      const fair = 100 * (1 - 0.2 * (shortOI / 100_000));

      expect(price(state, "SHORT")).toBeLessThan(fair);
      expect(price(state, "LONG")).toBeGreaterThan(fair);

      // Midpoint is exactly the fair value.
      expect(
        (price(state, "LONG") + price(state, "SHORT")) / 2,
      ).toBeCloseTo(fair, 6);
    }
  });

  /*
    4. Reducing skew -> impact decreases.

    Measured from the TWAP, so a positive gap means LONG is
    priced above it.
  */
  it("reduces impact as skew unwinds toward zero", () => {
    const twap = 100;

    const skewed = price(
      makeState(80_000, 0),
      "LONG",
    );

    const unwinding = price(
      makeState(60_000, 0),
      "LONG",
    );

    const closer = price(
      makeState(40_000, 0),
      "LONG",
    );

    const balanced = price(
      makeState(20_000, 20_000),
      "LONG",
    );

    // Utilization is falling here too, so the gap shrinks on
    // both counts.
    expect(Math.abs(skewed - twap))
      .toBeGreaterThan(Math.abs(unwinding - twap));
    expect(Math.abs(unwinding - twap))
      .toBeGreaterThan(Math.abs(closer - twap));
    expect(Math.abs(closer - twap))
      .toBeGreaterThan(Math.abs(balanced - twap));
  });

  it("returns impact to zero when skew is removed entirely", () => {
    const state = makeState(0, 0);

    expect(
      Math.abs(
        getCurrentAmmPrice(state, config) - 100,
      ),
    ).toBeCloseTo(0, 10);
  });


  /*
    5. Capacity impact increases with utilization.
  */
  it("increases capacity impact as utilization rises", () => {
    const utilizations = [
      0.1, 0.3, 0.5, 0.7, 0.8, 0.9, 0.95,
    ];

    const impacts = utilizations.map(
      (usage) =>
        getCapacityImpact(
          usage,
          config.capacityCoefficient,
        ),
    );

    for (let i = 1; i < impacts.length; i++) {
      expect(impacts[i]!).toBeGreaterThan(
        impacts[i - 1]!,
      );
    }

    // Zero impact on an empty market.
    expect(
      getCapacityImpact(0, config.capacityCoefficient),
    ).toBe(0);

    // Diverges as the market fills.
    expect(impacts.at(-1)).toBeCloseTo(0.95, 10);

    expect(() =>
      getCapacityImpact(1, config.capacityCoefficient),
    ).toThrow("CAPACITY_REACHED");
  });

  it("widens the execution spread as skew grows", () => {
    // Utilization held at 80%, so the spread is driven purely
    // by skew.
    const spreads = [0, 0.2, 0.4, 0.6, 0.8].map((skew) => {
      const long = 40_000 + (skew * 80_000) / 2;
      const short = 80_000 - long;

      return price(makeState(long, short), "LONG") -
        price(makeState(long, short), "SHORT");
    });

    for (let i = 1; i < spreads.length; i++) {
      expect(spreads[i]!).toBeGreaterThan(
        spreads[i - 1]!,
      );
    }
  });

  it("widens the spread faster as the market fills", () => {
    // Same skew, rising utilization: capacity impact
    // amplifies the skew, so the spread grows faster.
    const skewRatio = 0.4;

    const spreads = [0.2, 0.4, 0.6, 0.8].map(
      (usage) => {
        const total = usage * config.maxCapacity;

        const long =
          (total / 2) * (1 + skewRatio);
        const short = total - long;

        return price(makeState(long, short), "LONG") -
          price(makeState(long, short), "SHORT");
      },
    );

    for (let i = 1; i < spreads.length; i++) {
      expect(spreads[i]!).toBeGreaterThan(
        spreads[i - 1]!,
      );
    }
  });


  /*
    6. Prices stay finite and sensible across valid states.

    "Sensible" needs a caveat. getCapacityImpact is
    unbounded, so it eventually inverts the short price. This
    test documents the current behaviour and pins the boundary
    rather than asserting positivity, which the model does not
    currently guarantee.
  */
  it("keeps prices finite and positive for normal utilization", () => {
    const states = [
      makeState(0, 0),
      makeState(20_000, 0),
      makeState(0, 20_000),
      makeState(40_000, 0),
      makeState(0, 40_000),
      makeState(40_000, 40_000),
      makeState(80_000, 0),
      makeState(0, 80_000),
      makeState(90_000, 0),
      makeState(0, 90_000),
    ];

    for (const state of states) {
      for (const side of ["LONG", "SHORT"] as const) {
        const p = price(state, side);

        expect(Number.isFinite(p)).toBe(true);
        expect(p).toBeGreaterThan(0);
        expect(p).toBeLessThan(10 * 100);

        // The reference price stays finite too.
        expect(
          Number.isFinite(
            getCurrentAmmPrice(state, config),
          ),
        ).toBe(true);
      }
    }
  });

  it("inverts the losing-side price past ~99% utilization", () => {
    /*
      Documented limitation, not a passing invariant.

      The capacity spread is unbounded, so an extremely full
      book can still push the cheaper side negative. Use
      getBoundedCapacityImpact if this needs to be prevented.
    */
    const state = makeState(99_000, 0);

    expect(price(state, "SHORT")).toBeLessThan(0);
    expect(price(state, "LONG")).toBeCloseTo(712.81, 2);
  });

  it("rejects states at or beyond full capacity", () => {
    expect(() =>
      price(makeState(100_000, 0), "LONG"),
    ).toThrow("CAPACITY_REACHED");

    // Exactly at capacity is already rejected.
    expect(() =>
      price(makeState(50_000, 50_000), "LONG"),
    ).toThrow("CAPACITY_REACHED");
  });

  it("keeps the quote midpoint on the skew-adjusted fair value", () => {
    /*
      The spread is symmetric, so the midpoint of the two
      quotes is the fair value regardless of skew or
      utilization. This is the structural property that
      replaces the old "quotes sum to 2 x TWAP" invariant,
      which no longer holds once skew moves the centre.
    */
    const states = [
      makeState(0, 0, 100),
      makeState(40_000, 40_000, 100),
      makeState(80_000, 0, 100),
      makeState(0, 80_000, 100),
      makeState(50_000, 0, 250),
      makeState(0, 50_000, 250),
    ];

    for (const state of states) {
      const midpoint =
        (price(state, "LONG") + price(state, "SHORT")) / 2;

      expect(midpoint).toBeCloseTo(
        getCurrentAmmPrice(state, config),
        6,
      );
    }
  });

  it("keeps LONG above SHORT in any occupied market", () => {
    const states = [
      makeState(40_000, 0),
      makeState(0, 40_000),
      makeState(80_000, 0),
      makeState(0, 80_000),
      makeState(40_000, 40_000),
    ];

    for (const state of states) {
      expect(price(state, "LONG")).toBeGreaterThan(
        price(state, "SHORT"),
      );
    }

    // An empty market has no capacity spread, so both sides
    // quote the fair value.
    expect(price(makeState(0, 0), "LONG")).toBeCloseTo(100, 6);
    expect(price(makeState(0, 0), "SHORT")).toBeCloseTo(100, 6);
  });
});

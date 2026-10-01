
import { describe, expect, it } from "vitest";

import {
  calculateTWAP,
  recordPriceObservation,
  updateAmmTwap,
} from "../src/oracle/TWAPOracle.js";

import type {
  PriceObservation,
} from "../src/oracle/TWAPOracle.js";

import {
  getCurrentAmmPrice,
  getAverageExecutionPrice,
} from "../src/amm/Pricing.js";

import type {
  MarketState,
} from "../src/market/MarketState.js";

import type {
  MarketConfig,
} from "../src/config/MarketConfig.js";

describe("TWAP -> AMM -> execution integration", () => {
  const config: MarketConfig = {
    symbol: "BTC-PERP",
    maxCapacity: 100_000,
    skewCoefficient: 0.2,
    capacityCoefficient: 0.05,
    maxLeverage: 10,
  };

  it("propagates a sustained manipulated price through the real protocol pricing path", () => {
    const initialState: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };

    let observations: PriceObservation[] = [];

    // Establish baseline price inside the
    // complete 15-minute TWAP history.
    observations = recordPriceObservation(
      observations,
      {
        timestamp: 120,
        price: 100,
      },
    );

    observations = recordPriceObservation(
      observations,
      {
        timestamp: 900,
        price: 100,
      },
    );

    // Manipulation begins at t = 960.
    observations = recordPriceObservation(
      observations,
      {
        timestamp: 960,
        price: 1000,
      },
    );

    // Manipulation is maintained for 60 seconds.
    const now = 1020;

    observations = recordPriceObservation(
      observations,
      {
        timestamp: now,
        price: 1000,
      },
    );

    const twap = calculateTWAP(
      observations,
      now,
    );

    expect(twap).not.toBeNull();

    // 840 seconds at 100
    // 60 seconds at 1000
    // --------------------------------
    // TWAP = (840 * 100 + 60 * 1000) / 900
    //      = 160
    expect(twap).toBeCloseTo(
      160,
      6,
    );

    // Feed the calculated TWAP into the
    // actual MarketState.
    const manipulatedState =
      updateAmmTwap(
        initialState,
        observations,
        now,
      );

    expect(
      manipulatedState.ammTwapPrice,
    ).toBeCloseTo(
      160,
      6,
    );

    // With zero skew, the current AMM price
    // equals the TWAP reference.
    const currentAmmPrice =
      getCurrentAmmPrice(
        manipulatedState,
        config,
      );

    expect(currentAmmPrice).toBeCloseTo(
      160,
      6,
    );

    // The real execution pricing function
    // consumes the manipulated TWAP.
    const executionPrice =
      getAverageExecutionPrice(
        manipulatedState,
        config,
        "LONG",
      );

    expect(executionPrice).toBeCloseTo(
      160,
      6,
    );

    console.log({
      baselinePrice: 100,
      manipulatedSpotPrice: 1000,
      manipulationDuration: 60,
      twap,
      currentAmmPrice,
      executionPrice,
    });
  });

  it("shows that a shorter manipulation produces less TWAP displacement", () => {
    const initialState: MarketState = {
      symbol: "BTC-PERP",
      indexPrice: 100,
      ammTwapPrice: 100,
      longOpenInterest: 0,
      shortOpenInterest: 0,
    };

    const durations = [
      0.4,
      10,
      60,
    ];

    const results = durations.map(
      (duration) => {
        const manipulationStart = 900;

        const now =
          manipulationStart +
          duration;

        let observations: PriceObservation[] = [];

        // Complete baseline history.
        observations =
          recordPriceObservation(
            observations,
            {
              timestamp: 0,
              price: 100,
            },
          );

        observations =
          recordPriceObservation(
            observations,
            {
              timestamp:
                manipulationStart,
              price: 100,
            },
          );

        // Manipulation begins.
        //
        // Same timestamp as the previous
        // observation intentionally replaces
        // the price at t = 900.
        observations =
          recordPriceObservation(
            observations,
            {
              timestamp:
                manipulationStart,
              price: 1000,
            },
          );

        // Hold manipulated price until `now`.
        observations =
          recordPriceObservation(
            observations,
            {
              timestamp: now,
              price: 1000,
            },
          );

        const twap =
          calculateTWAP(
            observations,
            now,
          );

        if (twap === null) {
          throw new Error(
            "Expected complete TWAP",
          );
        }

        // Use the actual production
        // TWAP update function.
        const manipulatedState =
          updateAmmTwap(
            initialState,
            observations,
            now,
          );

        // Use the actual AMM price function.
        const currentAmmPrice =
          getCurrentAmmPrice(
            manipulatedState,
            config,
          );

        // Use the actual execution
        // pricing function.
        const executionPrice =
          getAverageExecutionPrice(
            manipulatedState,
            config,
            "LONG",
          );

        return {
          duration,
          twap,
          currentAmmPrice,
          executionPrice,
          displacementPercent:
            ((twap - 100) / 100) *
            100,
        };
      },
    );

    console.table(results);

    // 0.4 seconds of a 10x spot manipulation
    // moves the 900-second TWAP by 0.4%.
    expect(
      results[0]!.twap,
    ).toBeCloseTo(
      100.4,
      6,
    );

    // 10 seconds of manipulation
    // moves TWAP from 100 to 110.
    expect(
      results[1]!.twap,
    ).toBeCloseTo(
      110,
      6,
    );

    // 60 seconds of manipulation
    // moves TWAP from 100 to 160.
    expect(
      results[2]!.twap,
    ).toBeCloseTo(
      160,
      6,
    );

    // With zero skew and zero OI,
    // all pricing layers should use
    // the same TWAP value.
    for (const result of results) {
      expect(
        result.currentAmmPrice,
      ).toBeCloseTo(
        result.twap,
        6,
      );

      expect(
        result.executionPrice,
      ).toBeCloseTo(
        result.twap,
        6,
      );
    }

    // Longer manipulation produces
    // greater TWAP displacement.
    expect(
      results[0]!.twap,
    ).toBeLessThan(
      results[1]!.twap,
    );

    expect(
      results[1]!.twap,
    ).toBeLessThan(
      results[2]!.twap,
    );
  });
});


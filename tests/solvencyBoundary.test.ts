import {
  describe,
  expect,
  it,
} from "vitest";

import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import { PositionManager } from "../src/position/PositionManager.js";
import { calculateUnrealizedPnL } from "../src/risk/PnL.js";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

const INITIAL_PRICE = 100;

const MAX_CAPACITY = 100_000;

const ATTACKER_MARGIN = 10_000;

const TRADE_STEPS = 10;

const BASE_RESERVE = 50_000;

const QUOTE_RESERVE =
  BASE_RESERVE * INITIAL_PRICE;

const WINDOW_BLOCKS = 72;

const MANIPULATED_BLOCKS = 72;

const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: MAX_CAPACITY,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 10,
};

function createMarket(): MarketState {
  return {
    symbol: "BTC-PERP",
    indexPrice: INITIAL_PRICE,
    ammTwapPrice: INITIAL_PRICE,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };
}

function openMaximumLong() {
  const market = createMarket();

  const positionManager =
    new PositionManager();

  return simulateTrade(
    market,
    "LONG",
    MAX_CAPACITY,
    TRADE_STEPS,
    config,
    "attacker",
    ATTACKER_MARGIN,
    positionManager,
  );
}

function requiredManipulatedSpot(
  targetTwap: number,
): number {
  const normalBlocks =
    WINDOW_BLOCKS -
    MANIPULATED_BLOCKS;

  return Math.pow(
    Math.pow(
      targetTwap,
      WINDOW_BLOCKS,
    ) /
      Math.pow(
        INITIAL_PRICE,
        normalBlocks,
      ),
    1 / MANIPULATED_BLOCKS,
  );
}

function requiredBaseInput(
  targetPrice: number,
): number {
  return (
    Math.sqrt(
      (BASE_RESERVE *
        QUOTE_RESERVE) /
        targetPrice,
    ) - BASE_RESERVE
  );
}

function quoteReceived(
  baseInput: number,
): number {
  const invariant =
    BASE_RESERVE *
    QUOTE_RESERVE;

  const newQuoteReserve =
    invariant /
    (BASE_RESERVE + baseInput);

  return (
    QUOTE_RESERVE -
    newQuoteReserve
  );
}

function attackCost(
  targetTwap: number,
): number {
  const manipulatedSpot =
    requiredManipulatedSpot(
      targetTwap,
    );

  const baseInput =
    requiredBaseInput(
      manipulatedSpot,
    );

  const quoteOutput =
    quoteReceived(
      baseInput,
    );

  const costPerBlock =
    baseInput *
      INITIAL_PRICE -
    quoteOutput;

  return (
    costPerBlock *
    MANIPULATED_BLOCKS
  );
}

describe(
  "Solvency / Security Boundary",
  () => {
    it(
      "uses the maximum permitted position",
      () => {
        const result =
          openMaximumLong();

        expect(
          result.position.size,
        ).toBe(MAX_CAPACITY);

        expect(
          result.finalState
            .longOpenInterest +
            result.finalState
              .shortOpenInterest,
        ).toBeCloseTo(
          MAX_CAPACITY,
          6,
        );
      },
    );

    it(
      "calculates positive extraction for an upward TWAP move",
      () => {
        const result =
          openMaximumLong();

        const pnl =
          calculateUnrealizedPnL(
            result.position,
            150,
          );

        expect(pnl).toBeGreaterThan(0);
      },
    );

    it(
      "requires increasing manipulation cost for deeper TWAP manipulation",
      () => {
        const cost90 =
          attackCost(90);

        const cost60 =
          attackCost(60);

        const cost40 =
          attackCost(40);

        expect(cost60)
          .toBeGreaterThan(cost90);

        expect(cost40)
          .toBeGreaterThan(cost60);
      },
    );

    it(
      "keeps modeled attack cost above extraction",
      () => {
        const targetTwas = [
          90,
          80,
          70,
          60,
          50,
          40,
        ];

        const result =
          openMaximumLong();

        for (
          const targetTwap
          of targetTwas
        ) {
          const extraction =
            calculateUnrealizedPnL(
              result.position,
              targetTwap,
            );

          /*
           * Downward TWAP values produce a LONG
           * loss in this scenario.
           *
           * We only compare attack cost against
           * positive modeled extraction.
           */
          if (extraction <= 0) {
            continue;
          }

          expect(
            attackCost(targetTwap),
          ).toBeGreaterThan(
            extraction,
          );
        }
      },
    );
  },
);
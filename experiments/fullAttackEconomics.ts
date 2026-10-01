
import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import { PositionManager } from "../src/position/PositionManager.js";
import { calculateUnrealizedPnL } from "../src/risk/PnL.js";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

/*
 * ============================================================
 * PROTOTYPE ATTACK ECONOMICS
 * ============================================================
 *
 * This experiment connects:
 *
 *   TWAP manipulation
 *        ↓
 *   real perp execution
 *        ↓
 *   actual attacker PnL
 *
 * against:
 *
 *   Euler-inspired AMM manipulation cost
 *
 * IMPORTANT:
 *
 * The All Perps source gives the security requirement:
 *
 *     attack cost > attacker profit
 *
 * It does NOT specify this constant-product liquidity model.
 *
 * The AMM manipulation-cost model is therefore an explicit
 * prototype assumption derived from the supplied Euler research.
 */

/* ============================================================
 * CONFIGURATION
 * ========================================================== */

const INITIAL_SPOT_PRICE = 100;

const TWAP_WINDOW_BLOCKS = 72;
const MANIPULATED_BLOCKS = 72;

const ATTACKER_SIZE = 50_000;
const ATTACKER_MARGIN = 10_000;
const TRADE_STEPS = 5;

const BASE_LIQUIDITY = 50_000;

const TARGET_TWAPS = [
  90,
  80,
  70,
  60,
  50,
  40,
];

const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: 100_000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 10,
};

/* ============================================================
 * EULER-INSPIRED TWAP MODEL
 * ========================================================== */

/**
 * Geometric TWAP:
 *
 * TWAP =
 *
 *   (p^(n-m) * q^m)^(1/n)
 *
 * Rearranged:
 *
 *   q =
 *   (TWAP^n / p^(n-m))^(1/m)
 */
function requiredManipulatedSpot(
  normalPrice: number,
  targetTwap: number,
  windowBlocks: number,
  manipulatedBlocks: number,
): number {
  if (
    normalPrice <= 0 ||
    targetTwap <= 0 ||
    windowBlocks <= 0 ||
    manipulatedBlocks <= 0 ||
    manipulatedBlocks > windowBlocks
  ) {
    throw new Error(
      "Invalid TWAP parameters",
    );
  }

  const unmanipulatedBlocks =
    windowBlocks -
    manipulatedBlocks;

  return Math.pow(
    Math.pow(
      targetTwap,
      windowBlocks,
    ) /
      Math.pow(
        normalPrice,
        unmanipulatedBlocks,
      ),
    1 / manipulatedBlocks,
  );
}

/**
 * Downward manipulation.
 *
 * Initial price:
 *
 *   p = quoteReserve / baseReserve
 *
 * For q < p:
 *
 *   Δbase =
 *   sqrt(baseReserve * quoteReserve / q)
 *   - baseReserve
 */
function requiredBaseInput(
  baseReserve: number,
  quoteReserve: number,
  targetPrice: number,
): number {
  if (
    baseReserve <= 0 ||
    quoteReserve <= 0 ||
    targetPrice <= 0
  ) {
    throw new Error(
      "Invalid AMM parameters",
    );
  }

  const currentPrice =
    quoteReserve /
    baseReserve;

  if (targetPrice >= currentPrice) {
    throw new Error(
      "This experiment only models downward manipulation",
    );
  }

  return (
    Math.sqrt(
      (baseReserve *
        quoteReserve) /
        targetPrice,
    ) -
    baseReserve
  );
}

/**
 * Quote asset received when the attacker
 * deposits base asset.
 */
function quoteReceived(
  baseReserve: number,
  quoteReserve: number,
  baseInput: number,
): number {
  const invariant =
    baseReserve *
    quoteReserve;

  const newQuoteReserve =
    invariant /
    (baseReserve + baseInput);

  return (
    quoteReserve -
    newQuoteReserve
  );
}

/**
 * Euler-inspired upper-limit slippage cost.
 *
 *   cost =
 *   Δbase * normalPrice
 *   - Δquote
 */
function manipulationCostPerBlock(
  baseInput: number,
  quoteOutput: number,
  normalPrice: number,
): number {
  const cost =
    baseInput *
      normalPrice -
    quoteOutput;

  if (cost < 0) {
    throw new Error(
      "Manipulation cost cannot be negative",
    );
  }

  return cost;
}

function calculateAttackCost(
  targetTwap: number,
): {
  manipulatedSpot: number;
  costPerBlock: number;
  totalAttackCost: number;
} {
  const manipulatedSpot =
    requiredManipulatedSpot(
      INITIAL_SPOT_PRICE,
      targetTwap,
      TWAP_WINDOW_BLOCKS,
      MANIPULATED_BLOCKS,
    );

  const quoteReserve =
    BASE_LIQUIDITY *
    INITIAL_SPOT_PRICE;

  const baseInput =
    requiredBaseInput(
      BASE_LIQUIDITY,
      quoteReserve,
      manipulatedSpot,
    );

  const quoteOutput =
    quoteReceived(
      BASE_LIQUIDITY,
      quoteReserve,
      baseInput,
    );

  const costPerBlock =
    manipulationCostPerBlock(
      baseInput,
      quoteOutput,
      INITIAL_SPOT_PRICE,
    );

  return {
    manipulatedSpot,
    costPerBlock,
    totalAttackCost:
      costPerBlock *
      MANIPULATED_BLOCKS,
  };
}

/* ============================================================
 * REAL PERP EXTRACTION
 * ========================================================== */

function calculateActualExtraction(
  manipulatedTwap: number,
): {
  averageEntryPrice: number;
  totalCost: number;
  pnlAtHonestPrice: number;
  positionSize: number;
  priceHistory: number[];
} {
  const market: MarketState = {
    symbol: "BTC-PERP",
    indexPrice:
      INITIAL_SPOT_PRICE,

    ammTwapPrice:
      manipulatedTwap,

    longOpenInterest: 0,
    shortOpenInterest: 0,
  };

  const positionManager =
    new PositionManager();

  const trade =
    simulateTrade(
      market,
      "LONG",
      ATTACKER_SIZE,
      TRADE_STEPS,
      config,
      "attacker",
      ATTACKER_MARGIN,
      positionManager,
    );

  /*
   * The attacker eventually exits at the honest
   * reference price of 100.
   *
   * closePosition() currently releases OI but
   * does not settle PnL, so we explicitly measure
   * PnL at the exit price here.
   */
  const pnl =
    calculateUnrealizedPnL(
      trade.position,
      INITIAL_SPOT_PRICE,
    );

  return {
    averageEntryPrice:
      trade.averagePrice,

    totalCost:
      trade.totalCost,

    pnlAtHonestPrice:
      pnl,

    positionSize:
      trade.position.size,

    priceHistory:
      trade.priceHistory,
  };
}

/* ============================================================
 * FULL ATTACK ECONOMICS SWEEP
 * ========================================================== */

console.log(
  "\n=== FULL ATTACK ECONOMICS SWEEP ===",
);

const results =
  TARGET_TWAPS.map(
    (targetTwap) => {
      const attack =
        calculateAttackCost(
          targetTwap,
        );

      const extraction =
        calculateActualExtraction(
          targetTwap,
        );

      const ratio =
        attack.totalAttackCost /
        extraction.pnlAtHonestPrice;

      return {
        targetTwap,

        manipulatedSpot:
          attack.manipulatedSpot,

        averageEntryPrice:
          extraction.averageEntryPrice,

        positionSize:
          extraction.positionSize,

        perpExtraction:
          extraction.pnlAtHonestPrice,

        attackCost:
          attack.totalAttackCost,

        costToExtractionRatio:
          ratio,

        attackCostGreaterThanExtraction:
          attack.totalAttackCost >
          extraction.pnlAtHonestPrice,
      };
    },
  );

console.table(results);

/* ============================================================
 * DETAILED RESULTS
 * ========================================================== */

for (const result of results) {
  console.log(
    `\n=== TARGET TWAP ${result.targetTwap} ===`,
  );

  console.log({
    manipulatedSpot:
      result.manipulatedSpot,

    averageEntryPrice:
      result.averageEntryPrice,

    positionSize:
      result.positionSize,

    perpExtraction:
      result.perpExtraction,

    attackCost:
      result.attackCost,

    costToExtractionRatio:
      result.costToExtractionRatio,

    attackCostGreaterThanExtraction:
      result.attackCostGreaterThanExtraction,
  });
}

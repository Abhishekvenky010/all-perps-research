import { simulateTrade } from "../../src/simulation/TradeSimulator.js";
import { PositionManager } from "../../src/position/PositionManager.js";
import { calculateUnrealizedPnL } from "../../src/risk/PnL.js";

import type { MarketState } from "../../src/market/MarketState.js";
import type { MarketConfig } from "../../src/config/MarketConfig.js";

/*
 * ============================================================
 * SOLVENCY / SECURITY BOUNDARY EXPERIMENT
 * ============================================================
 *
 * This experiment connects the two already-tested pieces:
 *
 *   1. Maximum extraction from the perp market
 *   2. Cost of manipulating the external AMM TWAP
 *
 * Security condition:
 *
 *     attack cost > attacker profit
 *
 * IMPORTANT:
 *
 * The All Perps source gives the security requirement above.
 *
 * The constant-product AMM model below comes from the supplied
 * Euler research and is a prototype assumption.
 *
 * The All Perps source does NOT define:
 *
 *   LP token accounting
 *   LP vault accounting
 *   LP capital / capacity formula
 *
 * Therefore this experiment does NOT claim to prove general
 * protocol solvency.
 */

/* ============================================================
 * CONFIGURATION
 * ========================================================== */

const INITIAL_PRICE = 100;

const MAX_CAPACITY = 100_000;

const ATTACKER_MARGIN = 10_000;
const TRADE_STEPS = 10;

/*
 * This is the external AMM liquidity assumption used by our
 * Euler-inspired attack-cost model.
 */
const BASE_RESERVE = 50_000;
const QUOTE_RESERVE = BASE_RESERVE * INITIAL_PRICE;

const TWAP_WINDOW_BLOCKS = 72;
const MANIPULATED_BLOCKS = 72;

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
  maxCapacity: MAX_CAPACITY,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 10,
};

/* ============================================================
 * MARKET
 * ========================================================== */

function createMarket(): MarketState {
  return {
    symbol: "BTC-PERP",
    indexPrice: INITIAL_PRICE,
    ammTwapPrice: INITIAL_PRICE,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };
}

/* ============================================================
 * PERP EXTRACTION
 * ========================================================== */

function calculateExtraction(
  targetTwap: number,
) {
  const market = createMarket();

  const positionManager = new PositionManager();

  /*
   * Open the maximum permitted LONG position.
   *
   * This is deliberately the capacity boundary.
   */
  const trade = simulateTrade(
    market,
    "LONG",
    MAX_CAPACITY,
    TRADE_STEPS,
    config,
    "attacker",
    ATTACKER_MARGIN,
    positionManager,
  );

  /*
   * Mark the position at the manipulated TWAP.
   *
   * Positive PnL is the attacker's modeled extraction.
   */
  const pnl = calculateUnrealizedPnL(
    trade.position,
    targetTwap,
  );

  return {
    positionSize: trade.position.size,
    averageEntryPrice: trade.position.entryPrice,
    totalCost: trade.totalCost,
    pnl,
    profitable: pnl > 0,
  };
}

/* ============================================================
 * TWAP MANIPULATION MODEL
 * ========================================================== */

/*
 * Euler-style geometric TWAP:
 *
 *     TWAP = (p^(n-m) * q^m)^(1/n)
 *
 * Rearranged:
 *
 *     q = (TWAP^n / p^(n-m))^(1/m)
 *
 * Here:
 *
 *     p = normal price
 *     q = manipulated spot price
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
    throw new Error("Invalid TWAP parameters");
  }

  const normalBlocks =
    windowBlocks - manipulatedBlocks;

  return Math.pow(
    Math.pow(targetTwap, windowBlocks) /
      Math.pow(normalPrice, normalBlocks),
    1 / manipulatedBlocks,
  );
}

/*
 * Constant-product AMM:
 *
 *     x * y = k
 *
 * Initial price:
 *
 *     price = quoteReserve / baseReserve
 *
 * For downward manipulation:
 *
 *     Δbase =
 *       sqrt(x * y / targetPrice) - x
 */
function requiredBaseInput(
  baseReserve: number,
  quoteReserve: number,
  targetPrice: number,
): number {
  const currentPrice =
    quoteReserve / baseReserve;

  if (targetPrice >= currentPrice) {
    throw new Error(
      "This experiment models downward manipulation only",
    );
  }

  return (
    Math.sqrt(
      (baseReserve * quoteReserve) /
        targetPrice,
    ) - baseReserve
  );
}

/*
 * Amount of quote asset received when depositing base.
 */
function quoteReceived(
  baseReserve: number,
  quoteReserve: number,
  baseInput: number,
): number {
  const invariant =
    baseReserve * quoteReserve;

  const newQuoteReserve =
    invariant /
    (baseReserve + baseInput);

  return (
    quoteReserve -
    newQuoteReserve
  );
}

/*
 * Euler-inspired slippage cost:
 *
 *     cost =
 *       Δbase * normalPrice
 *       - Δquote
 *
 * This is the cost per manipulated block.
 */
function manipulationCostPerBlock(
  baseInput: number,
  quoteOutput: number,
  normalPrice: number,
): number {
  const cost =
    baseInput * normalPrice -
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
) {
  const manipulatedSpot =
    requiredManipulatedSpot(
      INITIAL_PRICE,
      targetTwap,
      TWAP_WINDOW_BLOCKS,
      MANIPULATED_BLOCKS,
    );

  const baseInput =
    requiredBaseInput(
      BASE_RESERVE,
      QUOTE_RESERVE,
      manipulatedSpot,
    );

  const quoteOutput =
    quoteReceived(
      BASE_RESERVE,
      QUOTE_RESERVE,
      baseInput,
    );

  const costPerBlock =
    manipulationCostPerBlock(
      baseInput,
      quoteOutput,
      INITIAL_PRICE,
    );

  const totalAttackCost =
    costPerBlock *
    MANIPULATED_BLOCKS;

  return {
    manipulatedSpot,
    baseInput,
    quoteOutput,
    costPerBlock,
    totalAttackCost,
  };
}

/* ============================================================
 * COMBINED SECURITY ANALYSIS
 * ========================================================== */

console.log(
  "\n========================================",
);

console.log(
  "SOLVENCY / SECURITY BOUNDARY",
);

console.log(
  "========================================",
);

console.log(`
Security condition:

    attack cost > attacker profit

The attacker profit is measured using the
actual perp implementation.

The manipulation cost uses the Euler-inspired
constant-product prototype.
`);

const results = TARGET_TWAPS.map(
  (targetTwap) => {
    const extraction =
      calculateExtraction(
        targetTwap,
      );

    const attack =
      calculateAttackCost(
        targetTwap,
      );

    const ratio =
      extraction.pnl > 0
        ? attack.totalAttackCost /
          extraction.pnl
        : Infinity;

    return {
      targetTwap,

      entryPrice:
        extraction.averageEntryPrice,

      extraction:
        extraction.pnl,

      manipulatedSpot:
        attack.manipulatedSpot,

      attackCost:
        attack.totalAttackCost,

      costToExtractionRatio:
        ratio,

      attackCostGreaterThanExtraction:
        attack.totalAttackCost >
        extraction.pnl,
    };
  },
);

/* ============================================================
 * OUTPUT
 * ========================================================== */

console.log(
  "\nTarget TWAP | Entry | Extraction | Attack Cost | Cost / Extraction | Secure",
);

console.log(
  "------------|-------|------------|-------------|-------------------|-------",
);

for (const result of results) {
  console.log(
    `${String(result.targetTwap).padEnd(12)}` +
      `${result.entryPrice
        .toFixed(2)
        .padEnd(8)}` +
      `${result.extraction
        .toFixed(2)
        .padEnd(13)}` +
      `${result.attackCost
        .toFixed(2)
        .padEnd(14)}` +
      `${result.costToExtractionRatio
        .toFixed(2)
        .padEnd(20)}` +
      `${result.attackCostGreaterThanExtraction}`,
  );
}

/* ============================================================
 * FINAL CHECK
 * ========================================================== */

const allScenariosPass =
  results.every(
    (result) =>
      result.attackCostGreaterThanExtraction,
  );

console.log(
  "\n========================================",
);

console.log(
  "SECURITY CONDITION:",
  allScenariosPass
    ? "PASSED"
    : "FAILED",
);

console.log(
  "========================================",
);

console.log(`
IMPORTANT:

A PASSED result means:

Under these explicit prototype assumptions,
the modeled cost of TWAP manipulation exceeds
the modeled trader extraction.

It does NOT prove:

- arbitrary LP capital is sufficient
- complete protocol solvency
- real-world attack profitability
- real blockchain security
`);
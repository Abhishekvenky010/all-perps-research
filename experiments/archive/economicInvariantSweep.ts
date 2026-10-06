import {
  createLiquidityVault,
} from "../../src/liquidity/LiquidityVault.js";

import {
  PositionManager,
} from "../../src/position/PositionManager.js";

import {
  settleAndClosePositionAtPriceForSimulation as settleAtExperimentalPrice,
} from "./ExperimentalSettlement.js";

import {
  calculateUnrealizedPnL,
} from "../../src/risk/PnL.js";

import {calculateMarginRatio,
  } from "../../src/risk/Margin.js";
import { isLiquidatable } from "../../src/risk/Liquidation.js";

import type { MarketState } from "../../src/market/MarketState.js";
import type { MarketConfig } from "../../src/config/MarketConfig.js";

import { simulateTrade } from "../../src/simulation/TradeSimulator.js";

/*
 * ============================================================
 * MARKET / ATTACK PARAMETERS
 * ============================================================
 */

const INITIAL_SPOT_PRICE = 100;
const RECOVERY_PRICE = 100;

const TWAP_WINDOW = 900;
const BLOCK_SECONDS = 15;

const TWAP_TARGETS = [
  95,
  90,
  85,
  80,
];

const UTILIZATIONS = [
  0.10,
  0.20,
  0.30,
  0.40,
  0.50,
];

const MAX_CAPACITY = 100_000;

const MAINTENANCE_MARGIN = 0.05;
const SURVIVAL_BUFFER = 1.01;

/*
 * External AMM used ONLY for the attack-cost model.
 *
 * This is NOT the All Perps AMM.
 */
const BASE_RESERVE = 50_000;
const QUOTE_RESERVE = 5_000_000;


/*
 * ============================================================
 * ALL PERPS CONFIG
 * ============================================================
 */

const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: MAX_CAPACITY,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 10,
  maintenanceMargin: MAINTENANCE_MARGIN,
};


/*
 * ============================================================
 * EXTERNAL TWAP MANIPULATION MODEL
 * ============================================================
 */

/*
 * Arithmetic TWAP:
 *
 * target =
 *
 * (normalPrice * normalDuration
 *  + manipulatedPrice * duration)
 * / window
 *
 * Therefore:
 *
 * manipulatedPrice =
 *
 * (target * window
 *  - normalPrice * normalDuration)
 * / duration
 */
function requiredSpotForTwap(
  targetTwap: number,
  duration: number,
): number {
  return (
    targetTwap * TWAP_WINDOW -
    INITIAL_SPOT_PRICE *
      (TWAP_WINDOW - duration)
  ) / duration;
}


/*
 * Constant-product AMM:
 *
 * x * y = k
 *
 * We model an attacker depressing price
 * from $100 to requiredSpot.
 */
function attackCostForSpot(
  requiredSpot: number,
): number {
  if (requiredSpot >= INITIAL_SPOT_PRICE) {
    return 0;
  }

  const k =
    BASE_RESERVE *
    QUOTE_RESERVE;

  const newBaseReserve =
    Math.sqrt(k / requiredSpot);

  const newQuoteReserve =
    Math.sqrt(k * requiredSpot);

  const deltaBase =
    newBaseReserve -
    BASE_RESERVE;

  const quoteReceived =
    QUOTE_RESERVE -
    newQuoteReserve;

  /*
   * Economic loss for moving the external AMM:
   *
   * base acquired at normal price
   * minus quote received.
   */
  const cost =
    deltaBase * INITIAL_SPOT_PRICE -
    quoteReceived;

  return Math.max(cost, 0);
}


/*
 * Multi-block attack cost.
 *
 * Euler-style simplified model:
 *
 * total cost = per-block manipulation cost ×
 *              number of manipulated blocks
 *
 * This is an external attack-cost assumption,
 * not an All Perps mechanism.
 */
function attackCostForTwap(
  targetTwap: number,
  duration: number,
): {
  requiredSpot: number;
  manipulatedBlocks: number;
  cost: number;
} {
  const requiredSpot =
    requiredSpotForTwap(
      targetTwap,
      duration,
    );

  const manipulatedBlocks =
    duration / BLOCK_SECONDS;

  const singleBlockCost =
    attackCostForSpot(
      requiredSpot,
    );

  return {
    requiredSpot,
    manipulatedBlocks,
    cost:
      singleBlockCost *
      manipulatedBlocks,
  };
}


/*
 * ============================================================
 * ATTACKER MARGIN
 * ============================================================
 */

function calculateRequiredMargin(
  entryPrice: number,
  attackerSize: number,
  targetTwap: number,
): number {
  const pnl =
    (targetTwap - entryPrice) *
    attackerSize;

  const minimumMargin =
    MAINTENANCE_MARGIN *
      attackerSize -
    pnl;

  return Math.max(
    0,
    minimumMargin *
      SURVIVAL_BUFFER,
  );
}


/*
 * ============================================================
 * REAL ALL PERPS ATTACK
 * ============================================================
 */

function runPerpsAttack(
  targetTwap: number,
  attackerSize: number,
) {
  /*
   * First discover entry price.
   */
  const discoveryState: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: INITIAL_SPOT_PRICE,
    ammTwapPrice: targetTwap,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };

  const discoveryManager =
    new PositionManager();

  const discoveryMargin =
    attackerSize /
    config.maxLeverage;

  const discovery =
    simulateTrade(
      discoveryState,
      "LONG",
      attackerSize,
      5,
      config,
      "attacker",
      discoveryMargin,
      discoveryManager,
    );

  const entryPrice =
    discovery.averagePrice;

  /*
   * Give the attacker enough margin to survive
   * the manipulated mark.
   */
  const attackerMargin =
    calculateRequiredMargin(
      entryPrice,
      attackerSize,
      targetTwap,
    );

  /*
   * Actual attack state.
   */
  const state: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: INITIAL_SPOT_PRICE,
    ammTwapPrice: targetTwap,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };

  const positionManager =
    new PositionManager();

  /*
   * Large vault so vault solvency doesn't
   * artificially truncate extraction.
   */
  const vault =
    createLiquidityVault(
      1_000_000_000,
    );

  const result =
    simulateTrade(
      state,
      "LONG",
      attackerSize,
      5,
      config,
      "attacker",
      attackerMargin,
      positionManager,
    );

  const position =
    result.position;

  const pnlAtManipulatedTwap =
    calculateUnrealizedPnL(
      position,
      targetTwap,
    );

  const marginRatio =
    calculateMarginRatio(
      position,
      pnlAtManipulatedTwap,
    );

  const liquidated =
    isLiquidatable(
      position,
      pnlAtManipulatedTwap,
      MAINTENANCE_MARGIN,
    );

  if (liquidated) {
    return {
      entryPrice,
      attackerMargin,
      marginRatio,
      liquidated: true,
      realizedPnl: 0,
    };
  }

  /*
   * Recover to $100 and settle through
   * the actual protocol settlement path.
   */
  const settlement =
    settleAtExperimentalPrice(
      position.id,
      RECOVERY_PRICE,
      state,
      positionManager,
      vault,
    );

  return {
    entryPrice,
    attackerMargin,
    marginRatio,
    liquidated: false,
    realizedPnl:
      Math.max(
        settlement.pnl,
        0,
      ),
  };
}


/*
 * ============================================================
 * FULL ECONOMIC SWEEP
 * ============================================================
 */

const DURATION = 900;

const results: any[] = [];

for (const targetTwap of TWAP_TARGETS) {
  for (const utilization of UTILIZATIONS) {

    const attackerSize =
      MAX_CAPACITY *
      utilization;

    const attack =
      attackCostForTwap(
        targetTwap,
        DURATION,
      );

    const perps =
      runPerpsAttack(
        targetTwap,
        attackerSize,
      );

    const ratio =
      perps.realizedPnl > 0
        ? attack.cost /
          perps.realizedPnl
        : Infinity;

    results.push({
      targetTwap,
      utilization,
      attackerSize,

      requiredSpot:
        attack.requiredSpot,

      attackCost:
        attack.cost,

      entryPrice:
        perps.entryPrice,

      attackerMargin:
        perps.attackerMargin,

      marginRatio:
        perps.marginRatio,

      liquidated:
        perps.liquidated,

      realizedPnl:
        perps.realizedPnl,

      costToExtraction:
        ratio,

      invariantHolds:
        ratio > 1,
    });
  }
}


/*
 * ============================================================
 * OUTPUT
 * ============================================================
 */

console.log(
  "\nECONOMIC INVARIANT SWEEP",
);

console.log(
  "=========================",
);

console.table(results);


console.log(
  "\nWORST ECONOMIC CASES",
);

const executable =
  results.filter(
    r =>
      r.realizedPnl > 0,
  );

if (executable.length === 0) {
  console.log(
    "No executable profitable scenarios.",
  );
} else {

  const worst =
    executable.reduce(
      (best, current) =>
        current.costToExtraction <
        best.costToExtraction
          ? current
          : best,
    );

  console.log({
    targetTwap:
      worst.targetTwap,

    utilization:
      `${worst.utilization * 100}%`,

    attackerSize:
      worst.attackerSize,

    attackCost:
      worst.attackCost,

    realizedPnl:
      worst.realizedPnl,

    costToExtraction:
      worst.costToExtraction,

    invariantHolds:
      worst.invariantHolds,
  });
}


console.log(
  "\nINVARIANT CHECK",
);

const violations =
  executable.filter(
    r =>
      r.costToExtraction <= 1,
  );

console.log({
  executableScenarios:
    executable.length,

  invariantViolations:
    violations.length,

  violations:
    violations.map(
      r => ({
        targetTwap:
          r.targetTwap,

        utilization:
          r.utilization,

        attackCost:
          r.attackCost,

        realizedPnl:
          r.realizedPnl,

        ratio:
          r.costToExtraction,
      }),
    ),
});


console.log(
  "\nMAX EXTRACTION BY TWAP",
);

for (const targetTwap of TWAP_TARGETS) {

  const scenarios =
    executable.filter(
      r =>
        r.targetTwap ===
        targetTwap,
    );

  if (scenarios.length === 0) {
    continue;
  }

  const maximum =
    scenarios.reduce(
      (best, current) =>
        current.realizedPnl >
        best.realizedPnl
          ? current
          : best,
    );

  console.log({
    targetTwap,

    bestUtilization:
      `${maximum.utilization * 100}%`,

    attackerSize:
      maximum.attackerSize,

    realizedPnl:
      maximum.realizedPnl,

    attackCost:
      maximum.attackCost,

    costToExtraction:
      maximum.costToExtraction,
  });
}
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
 * GLOBAL PARAMETERS
 * ============================================================
 */

const INITIAL_PRICE = 100;
const RECOVERY_PRICE = 100;

const TWAP_WINDOW = 900;
const BLOCK_SECONDS = 15;

const TWAP_TARGETS = [
  95,
  90,
  85,
  80,
];

const DURATIONS = [
  15,
  30,
  60,
  120,
  300,
  600,
  900,
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
 * EXTERNAL AMM MODEL
 * ============================================================
 *
 * This is ONLY the external oracle manipulation
 * cost model.
 *
 * It is NOT the All Perps AMM.
 */

const BASE_RESERVE = 50_000;
const QUOTE_RESERVE = 5_000_000;


/*
 * Calculate the spot price that must persist
 * for `duration` seconds to produce the target
 * arithmetic TWAP.
 */
function requiredSpotForTwap(
  targetTwap: number,
  duration: number,
): number {
  return (
    targetTwap * TWAP_WINDOW -
    INITIAL_PRICE *
      (TWAP_WINDOW - duration)
  ) / duration;
}


/*
 * Constant-product manipulation cost:
 *
 * x * y = k
 */
function attackCostForSpot(
  requiredSpot: number,
): number {

  if (requiredSpot >= INITIAL_PRICE) {
    return 0;
  }

  const k =
    BASE_RESERVE *
    QUOTE_RESERVE;

  const newBaseReserve =
    Math.sqrt(
      k / requiredSpot,
    );

  const newQuoteReserve =
    Math.sqrt(
      k * requiredSpot,
    );

  const deltaBase =
    newBaseReserve -
    BASE_RESERVE;

  const quoteReceived =
    QUOTE_RESERVE -
    newQuoteReserve;

  const cost =
    deltaBase * INITIAL_PRICE -
    quoteReceived;

  return Math.max(
    cost,
    0,
  );
}


/*
 * Simplified multi-block model:
 *
 * total cost =
 * single-block manipulation cost
 * × manipulated blocks
 */
function calculateAttackCost(
  targetTwap: number,
  duration: number,
) {
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
    attackCost:
      singleBlockCost *
      manipulatedBlocks,
  };
}


/*
 * ============================================================
 * ATTACKER COLLATERAL
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
 * ACTUAL ALL PERPS EXECUTION
 * ============================================================
 */

function runPerpsAttack(
  targetTwap: number,
  attackerSize: number,
) {

  /*
   * Discover actual entry price using
   * the production pricing path.
   */
  const discoveryState: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: INITIAL_PRICE,
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
   * Give attacker enough collateral to survive
   * the manipulated TWAP.
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
    indexPrice: INITIAL_PRICE,
    ammTwapPrice: targetTwap,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };

  const positionManager =
    new PositionManager();

  /*
   * Large vault prevents vault size from
   * limiting the experiment.
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
   * Recover the oracle to the original price
   * and settle through the real protocol path.
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
 * FULL 140-SCENARIO MATRIX
 * ============================================================
 */

const results: any[] = [];

for (const targetTwap of TWAP_TARGETS) {

  for (const duration of DURATIONS) {

    /*
     * A TWAP target cannot necessarily be reached
     * within every duration.
     *
     * requiredSpot >= 0 means our simple external
     * model can represent the manipulation.
     */
    const attack =
      calculateAttackCost(
        targetTwap,
        duration,
      );

    if (
      attack.requiredSpot <= 0
    ) {
      for (
        const utilization
        of UTILIZATIONS
      ) {
        results.push({
          targetTwap,
          duration,
          utilization,
          attackerSize:
            MAX_CAPACITY *
            utilization,
          requiredSpot:
            attack.requiredSpot,
          attackCost:
            attack.attackCost,
          entryPrice: null,
          attackerMargin: null,
          marginRatio: null,
          liquidated: false,
          realizedPnl: 0,
          costToExtraction: Infinity,
          invariantHolds: true,
          status: "UNREACHABLE",
        });
      }

      continue;
    }

    for (
      const utilization
      of UTILIZATIONS
    ) {

      const attackerSize =
        MAX_CAPACITY *
        utilization;

      const perps =
        runPerpsAttack(
          targetTwap,
          attackerSize,
        );

      const ratio =
        perps.realizedPnl > 0
          ? attack.attackCost /
            perps.realizedPnl
          : Infinity;

      results.push({
        targetTwap,
        duration,
        utilization,
        attackerSize,

        requiredSpot:
          attack.requiredSpot,

        attackCost:
          attack.attackCost,

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

        status:
          perps.realizedPnl > 0
            ? "EXECUTABLE"
            : "NO_EXTRACTION",
      });
    }
  }
}


/*
 * ============================================================
 * SUMMARY
 * ============================================================
 */

console.log(
  "\nECONOMIC DURATION SWEEP",
);

console.log(
  "=======================",
);

console.log({
  scenarios:
    results.length,

  expected:
    TWAP_TARGETS.length *
    DURATIONS.length *
    UTILIZATIONS.length,
});


/*
 * ============================================================
 * GLOBAL WORST CASE
 * ============================================================
 */

const executable =
  results.filter(
    r =>
      r.status ===
      "EXECUTABLE",
  );

console.log(
  "\nGLOBAL WORST ECONOMIC CASE",
);

if (executable.length === 0) {

  console.log(
    "No executable extraction scenarios.",
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

    duration:
      worst.duration,

    utilization:
      `${worst.utilization * 100}%`,

    attackerSize:
      worst.attackerSize,

    requiredSpot:
      worst.requiredSpot,

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


/*
 * ============================================================
 * INVARIANT VIOLATIONS
 * ============================================================
 */

const violations =
  executable.filter(
    r =>
      r.costToExtraction <= 1,
  );

console.log(
  "\nINVARIANT CHECK",
);

console.log({
  totalScenarios:
    results.length,

  executableScenarios:
    executable.length,

  invariantViolations:
    violations.length,

  violations:
    violations.map(
      r => ({
        targetTwap:
          r.targetTwap,

        duration:
          r.duration,

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


/*
 * ============================================================
 * WORST CASE BY TWAP
 * ============================================================
 */

console.log(
  "\nWORST CASE BY TWAP",
);

for (
  const targetTwap
  of TWAP_TARGETS
) {

  const scenarios =
    executable.filter(
      r =>
        r.targetTwap ===
        targetTwap,
    );

  if (
    scenarios.length === 0
  ) {
    continue;
  }

  const worst =
    scenarios.reduce(
      (best, current) =>
        current.costToExtraction <
        best.costToExtraction
          ? current
          : best,
    );

  console.log({
    targetTwap,

    duration:
      worst.duration,

    utilization:
      `${worst.utilization * 100}%`,

    attackCost:
      worst.attackCost,

    realizedPnl:
      worst.realizedPnl,

    costToExtraction:
      worst.costToExtraction,
  });
}


/*
 * ============================================================
 * WORST CASE BY DURATION
 * ============================================================
 */

console.log(
  "\nWORST CASE BY DURATION",
);

for (
  const duration
  of DURATIONS
) {

  const scenarios =
    executable.filter(
      r =>
        r.duration ===
        duration,
    );

  if (
    scenarios.length === 0
  ) {
    continue;
  }

  const worst =
    scenarios.reduce(
      (best, current) =>
        current.costToExtraction <
        best.costToExtraction
          ? current
          : best,
    );

  console.log({
    duration,

    targetTwap:
      worst.targetTwap,

    utilization:
      `${worst.utilization * 100}%`,

    attackCost:
      worst.attackCost,

    realizedPnl:
      worst.realizedPnl,

    costToExtraction:
      worst.costToExtraction,
  });
}


/*
 * ============================================================
 * EXTRACTION SUMMARY
 * ============================================================
 */

console.log(
  "\nMAX EXTRACTION BY TWAP",
);

for (
  const targetTwap
  of TWAP_TARGETS
) {

  const scenarios =
    executable.filter(
      r =>
        r.targetTwap ===
        targetTwap,
    );

  if (
    scenarios.length === 0
  ) {
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

    duration:
      maximum.duration,

    utilization:
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
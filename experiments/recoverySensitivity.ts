import {
  createLiquidityVault,
} from "../src/liquidity/LiquidityVault.js";

import {
  PositionManager,
} from "../src/position/PositionManager.js";

import {
  settleAndClosePosition,
} from "../src/settlement/SettleAndClosePosition.js";

import {
  calculateUnrealizedPnL,
} from "../src/risk/PnL.js";

import {calculateMarginRatio,
  } from "../src/risk/Margin.js";
import { isLiquidatable } from "../src/risk/Liquidation.js";

import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

import { simulateTrade } from "../src/simulation/TradeSimulator.js";


/*
 * ============================================================
 * PARAMETERS
 * ============================================================
 */

const INITIAL_PRICE = 100;

const TWAP_TARGETS = [
  80,
  85,
  90,
  95,
];

const UTILIZATIONS = [
  0.10,
  0.20,
  0.30,
  0.40,
  0.50,
];

const RECOVERY_PRICES = [
  80,
  85,
  90,
  95,
  100,
  105,
  110,
  120,
];

const MAX_CAPACITY = 100_000;

const MAINTENANCE_MARGIN = 0.05;

// Small buffer above liquidation boundary.
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
 * MARGIN CALCULATION
 * ============================================================
 *
 * We deliberately give the attacker enough margin to survive
 * the manipulated TWAP.
 *
 * This prevents liquidation from hiding the underlying
 * settlement liability.
 */

function calculateRequiredMargin(
  entryPrice: number,
  positionSize: number,
  manipulatedTwap: number,
): number {

  const pnl =
    (manipulatedTwap - entryPrice) *
    positionSize;

  const minimumMargin =
    MAINTENANCE_MARGIN *
      positionSize -
    pnl;

  return Math.max(
    0,
    minimumMargin *
      SURVIVAL_BUFFER,
  );
}


/*
 * ============================================================
 * SINGLE SCENARIO
 * ============================================================
 */

function runScenario(
  targetTwap: number,
  utilization: number,
  recoveryPrice: number,
) {

  const positionSize =
    MAX_CAPACITY *
    utilization;


  /*
   * ----------------------------------------------------------
   * Discover actual entry price using the real AMM.
   * ----------------------------------------------------------
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
    positionSize /
    config.maxLeverage;

  const discovery =
    simulateTrade(
      discoveryState,
      "LONG",
      positionSize,
      5,
      config,
      "attacker",
      discoveryMargin,
      discoveryManager,
    );

  const entryPrice =
    discovery.averagePrice;


  /*
   * ----------------------------------------------------------
   * Give attacker enough margin to survive manipulation.
   * ----------------------------------------------------------
   */

  const attackerMargin =
    calculateRequiredMargin(
      entryPrice,
      positionSize,
      targetTwap,
    );


  /*
   * ----------------------------------------------------------
   * Execute actual attack.
   * ----------------------------------------------------------
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
   * Large vault deliberately removes LP capital
   * as a limiting variable.
   *
   * We are measuring protocol liability here.
   */
  const vault =
    createLiquidityVault(
      1_000_000_000,
    );

  const result =
    simulateTrade(
      state,
      "LONG",
      positionSize,
      5,
      config,
      "attacker",
      attackerMargin,
      positionManager,
    );

  const position =
    result.position;


  /*
   * ----------------------------------------------------------
   * Check survival at manipulated TWAP.
   * ----------------------------------------------------------
   */

  const manipulatedPnl =
    calculateUnrealizedPnL(
      position,
      targetTwap,
    );

  const marginRatio =
    calculateMarginRatio(
      position,
      manipulatedPnl,
    );

  const liquidated =
    isLiquidatable(
      position,
      manipulatedPnl,
      MAINTENANCE_MARGIN,
    );

  if (liquidated) {
    return {
      targetTwap,
      utilization,
      positionSize,
      recoveryPrice,

      entryPrice,
      attackerMargin,
      marginRatio,

      liquidated: true,

      realizedPnl: 0,
      traderSettlement: 0,
      lpLoss: 0,

      status: "LIQUIDATED",
    };
  }


  /*
   * ----------------------------------------------------------
   * Recover and settle through the actual protocol.
   * ----------------------------------------------------------
   */

  const settlement =
    settleAndClosePosition(
      position.id,
      recoveryPrice,
      state,
      positionManager,
      vault,
    );


  /*
   * Positive trader PnL corresponds to LP loss
   * in the current vault accounting.
   */
  const realizedPnl =
    settlement.pnl;

  const lpLoss =
    Math.max(
      realizedPnl,
      0,
    );

  return {
    targetTwap,
    utilization,
    positionSize,
    recoveryPrice,

    entryPrice,
    attackerMargin,
    marginRatio,

    liquidated: false,

    realizedPnl,
    traderSettlement:
      settlement.traderSettlement,

    lpLoss,

    status:
      realizedPnl > 0
        ? "PROFITABLE"
        : "LOSS",
  };
}


/*
 * ============================================================
 * 160-SCENARIO SWEEP
 * ============================================================
 */

const results: ReturnType<
  typeof runScenario
>[] = [];

for (
  const targetTwap
  of TWAP_TARGETS
) {

  for (
    const utilization
    of UTILIZATIONS
  ) {

    for (
      const recoveryPrice
      of RECOVERY_PRICES
    ) {

      results.push(
        runScenario(
          targetTwap,
          utilization,
          recoveryPrice,
        ),
      );
    }
  }
}


/*
 * ============================================================
 * OUTPUT
 * ============================================================
 */

console.log(
  "\nALL PERPS RECOVERY SENSITIVITY",
);

console.log(
  "==============================",
);

console.log({
  scenarios:
    results.length,

  expected:
    TWAP_TARGETS.length *
    UTILIZATIONS.length *
    RECOVERY_PRICES.length,
});


/*
 * ------------------------------------------------------------
 * Maximum liability
 * ------------------------------------------------------------
 */

const profitable =
  results.filter(
    r =>
      r.status ===
      "PROFITABLE",
  );

/*
 * If no scenario is profitable, that is an experimental
 * result rather than a reason to assert non-null, so the
 * empty case is handled explicitly instead of hidden behind
 * a non-null assertion.
 */
const maximum =
  profitable.reduce<
    (typeof profitable)[number] | undefined
  >(
    (best, current) => {
      if (!best) return current;

      return current.lpLoss >
        best.lpLoss
        ? current
        : best;
    },
    undefined,
  );

console.log(
  "\nMAXIMUM LP LIABILITY",
);

if (!maximum) {
  console.log(
    "No profitable scenarios found.",
  );
} else {
  console.log(maximum);
}


/*
 * ------------------------------------------------------------
 * Maximum payout by manipulated TWAP
 * ------------------------------------------------------------
 */

console.log(
  "\nMAXIMUM LIABILITY BY TWAP",
);

for (
  const targetTwap
  of TWAP_TARGETS
) {

  const scenarios =
    profitable.filter(
      r =>
        r.targetTwap ===
        targetTwap,
    );

  if (
    scenarios.length === 0
  ) {
    continue;
  }

  const maximumForTwap =
    scenarios.reduce(
      (best, current) =>
        current.lpLoss >
        best.lpLoss
          ? current
          : best,
    );

  console.log({
    targetTwap,

    utilization:
      `${maximumForTwap.utilization * 100}%`,

    positionSize:
      maximumForTwap.positionSize,

    recoveryPrice:
      maximumForTwap.recoveryPrice,

    entryPrice:
      maximumForTwap.entryPrice,

    lpLoss:
      maximumForTwap.lpLoss,
  });
}


/*
 * ------------------------------------------------------------
 * Maximum payout by position utilization
 * ------------------------------------------------------------
 */

console.log(
  "\nMAXIMUM LIABILITY BY UTILIZATION",
);

for (
  const utilization
  of UTILIZATIONS
) {

  const scenarios =
    profitable.filter(
      r =>
        r.utilization ===
        utilization,
    );

  if (
    scenarios.length === 0
  ) {
    continue;
  }

  const maximumForUtilization =
    scenarios.reduce(
      (best, current) =>
        current.lpLoss >
        best.lpLoss
          ? current
          : best,
    );

  console.log({
    utilization:
      `${utilization * 100}%`,

    positionSize:
      maximumForUtilization.positionSize,

    targetTwap:
      maximumForUtilization.targetTwap,

    recoveryPrice:
      maximumForUtilization.recoveryPrice,

    entryPrice:
      maximumForUtilization.entryPrice,

    lpLoss:
      maximumForUtilization.lpLoss,
  });
}


/*
 * ------------------------------------------------------------
 * Recovery sensitivity for TWAP = 80
 * ------------------------------------------------------------
 */

console.log(
  "\nTWAP 80 RECOVERY MATRIX",
);

const twap80 =
  profitable.filter(
    r =>
      r.targetTwap === 80,
  );

for (
  const utilization
  of UTILIZATIONS
) {

  const row =
    twap80
      .filter(
        r =>
          r.utilization ===
          utilization,
      )
      .map(
        r => ({
          recovery:
            r.recoveryPrice,

          pnl:
            Math.round(
              r.realizedPnl,
            ),
        }),
      );

  console.log({
    utilization:
      `${utilization * 100}%`,

    row,
  });
}


/*
 * ------------------------------------------------------------
 * Capacity comparison
 * ------------------------------------------------------------
 */

console.log(
  "\nLIABILITY / MAX CAPACITY",
);

if (!maximum) {
  console.log(
    "No profitable scenarios found.",
  );
} else {
  console.log({
    maximumLpLoss:
      maximum.lpLoss,

    maxCapacity:
      MAX_CAPACITY,

    ratio:
      maximum.lpLoss /
      MAX_CAPACITY,
  });
}
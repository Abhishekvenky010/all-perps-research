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

const INITIAL_TWAP = 100;
const RECOVERY_TWAP = 100;

const MAX_CAPACITY = 100_000;
const MAINTENANCE_MARGIN = 0.05;

// Test different depths of TWAP manipulation.
const TWAP_TARGETS = [
  95,
  90,
  85,
  80,
];

// Test different fractions of market capacity.
const UTILIZATIONS = [
  0.10,
  0.20,
  0.30,
  0.40,
  0.50,
];

const SURVIVAL_BUFFER = 1.01;

const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: MAX_CAPACITY,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 10,
  maintenanceMargin: MAINTENANCE_MARGIN,
};

function calculateRequiredMargin(
  entryPrice: number,
  attackerSize: number,
  manipulatedTwap: number,
): number {
  const pnl =
    (manipulatedTwap - entryPrice) *
    attackerSize;

  const minimumMargin =
    MAINTENANCE_MARGIN * attackerSize - pnl;

  return Math.max(
    0,
    minimumMargin * SURVIVAL_BUFFER,
  );
}

function runScenario(
  targetTwap: number,
  utilization: number,
) {
  const attackerSize =
    MAX_CAPACITY * utilization;

  /*
   * First discover the actual AMM entry price.
   * Margin does not affect the pricing calculation.
   */
  const discoveryState: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: INITIAL_TWAP,
    ammTwapPrice: targetTwap,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };

  const discoveryManager =
    new PositionManager();

  const discoveryMargin =
    attackerSize / config.maxLeverage;

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
   * Calculate enough collateral to survive
   * the manipulated mark.
   */
  const requiredMargin =
    calculateRequiredMargin(
      entryPrice,
      attackerSize,
      targetTwap,
    );

  /*
   * Run the actual attack.
   */
  const state: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: INITIAL_TWAP,
    ammTwapPrice: targetTwap,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };

  const positionManager =
    new PositionManager();

  // Large vault so LP solvency doesn't interfere
  // with the measurement of attacker extraction.
  const vault =
    createLiquidityVault(1_000_000);

  const result =
    simulateTrade(
      state,
      "LONG",
      attackerSize,
      5,
      config,
      "attacker",
      requiredMargin,
      positionManager,
    );

  const position = result.position;

  const pnlAtManipulatedPrice =
    calculateUnrealizedPnL(
      position,
      targetTwap,
    );

  const marginRatio =
    calculateMarginRatio(
      position,
      pnlAtManipulatedPrice,
    );

  const liquidated =
    isLiquidatable(
      position,
      pnlAtManipulatedPrice,
      MAINTENANCE_MARGIN,
    );

  if (liquidated) {
    return {
      targetTwap,
      utilization,
      attackerSize,
      entryPrice,
      requiredMargin,
      marginRatio,
      liquidated: true,
      realizedPnl: 0,
      requiredLpCapital: 0,
    };
  }

  /*
   * Recover the TWAP to the original price and
   * settle through the real protocol path.
   */
  const settlement =
    settleAtExperimentalPrice(
      position.id,
      RECOVERY_TWAP,
      state,
      positionManager,
      vault,
    );

  const realizedPnl =
    Math.max(settlement.pnl, 0);

  return {
    targetTwap,
    utilization,
    attackerSize,
    entryPrice,
    requiredMargin,
    marginRatio,
    liquidated: false,
    realizedPnl,
    requiredLpCapital: realizedPnl,
  };
}

console.log(
  "\nTWAP SEVERITY × CAPACITY SWEEP",
);

console.log(
  "===============================",
);

const results = [];

for (const targetTwap of TWAP_TARGETS) {
  for (const utilization of UTILIZATIONS) {
    results.push(
      runScenario(
        targetTwap,
        utilization,
      ),
    );
  }
}

console.table(results);

console.log(
  "\nMAX EXTRACTION BY TWAP TARGET",
);

for (const targetTwap of TWAP_TARGETS) {
  const scenarios =
    results.filter(
      r => r.targetTwap === targetTwap,
    );

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
    entryPrice:
      maximum.entryPrice,
    requiredMargin:
      maximum.requiredMargin,
    realizedPnl:
      maximum.realizedPnl,
  });
}

console.log(
  "\nMATRIX: REALIZED PNL",
);

for (const targetTwap of TWAP_TARGETS) {
  const row = results
    .filter(
      r => r.targetTwap === targetTwap,
    )
    .map(r => ({
      utilization:
        `${r.utilization * 100}%`,
      realizedPnl:
        Math.round(r.realizedPnl),
    }));

  console.log(
    `TWAP ${targetTwap}:`,
    row,
  );
}
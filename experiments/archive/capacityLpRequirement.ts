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
const MANIPULATED_TWAP = 95;
const RECOVERY_TWAP = 100;

const MAX_CAPACITY = 100_000;

// Use the same margin ratio that allowed the previous
// 30k attack to survive the manipulated mark.
const MARGIN_RATIO = 80_800 / 30_000;

const UTILIZATIONS = [
  0.10,
  0.20,
  0.30,
  0.40,
  0.50,
];

const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: MAX_CAPACITY,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 10,
  maintenanceMargin: 0.05,
};

function runScenario(utilization: number) {
  const attackerSize =
    MAX_CAPACITY * utilization;

  const attackerMargin =
    attackerSize * MARGIN_RATIO;

  const state: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: INITIAL_TWAP,
    ammTwapPrice: MANIPULATED_TWAP,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };

  const positionManager =
    new PositionManager();

  // Large enough that vault size itself does not
  // constrain the settlement experiment.
  const vault =
    createLiquidityVault(1_000_000);

  const result = simulateTrade(
    state,
    "LONG",
    attackerSize,
    5,
    config,
    "attacker",
    attackerMargin,
    positionManager,
  );

  const position = result.position;

  const pnlAtManipulatedPrice =
    calculateUnrealizedPnL(
      position,
      MANIPULATED_TWAP,
    );

  const marginRatio =
    calculateMarginRatio(
      position,
      pnlAtManipulatedPrice,
    );

  const liquidatable =
    isLiquidatable(
      position,
      pnlAtManipulatedPrice,
      config.maintenanceMargin!,
    );

  if (liquidatable) {
    return {
      utilization,
      attackerSize,
      attackerMargin,
      entryPrice: result.averagePrice,
      pnlAtManipulatedPrice,
      marginRatio,
      liquidated: true,
      realizedPnl: 0,
      requiredLpCapital: 0,
      lpToCapacityRatio: 0,
    };
  }

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
    utilization,
    attackerSize,
    attackerMargin,
    entryPrice: result.averagePrice,
    pnlAtManipulatedPrice,
    marginRatio,
    liquidated: false,
    realizedPnl,
    requiredLpCapital: realizedPnl,
    lpToCapacityRatio:
      realizedPnl / MAX_CAPACITY,
  };
}

console.log(
  "\nCAPACITY → LP CAPITAL REQUIREMENT",
);

console.log(
  "==================================",
);

const results =
  UTILIZATIONS.map(runScenario);

console.table(results);

console.log("\nECONOMIC SUMMARY");

for (const r of results) {
  console.log({
    attackerSize: r.attackerSize,
    utilization: `${r.utilization * 100}%`,
    realizedPnl: r.realizedPnl,
    requiredLpCapital: r.requiredLpCapital,
    lpToCapacityRatio:
      `${(r.lpToCapacityRatio * 100).toFixed(2)}%`,
  });
}
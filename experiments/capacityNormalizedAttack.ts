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

const INITIAL_TWAP = 100;
const MANIPULATED_TWAP = 95;
const RECOVERY_TWAP = 100;

const MAX_CAPACITY = 100_000;
const MAINTENANCE_MARGIN = 0.05;

// Small buffer so the position is safely above,
// rather than exactly on, the liquidation boundary.
const SURVIVAL_BUFFER = 1.01;

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
  maintenanceMargin: MAINTENANCE_MARGIN,
};

function calculateRequiredMargin(
  entryPrice: number,
  attackerSize: number,
): number {
  const pnlAtManipulatedPrice =
    (MANIPULATED_TWAP - entryPrice) *
    attackerSize;

  /*
   * Need:
   *
   * (margin + pnl) / size >= maintenanceMargin
   *
   * Therefore:
   *
   * margin >= maintenanceMargin * size - pnl
   */
  const minimumMargin =
    MAINTENANCE_MARGIN * attackerSize -
    pnlAtManipulatedPrice;

  return minimumMargin * SURVIVAL_BUFFER;
}

function runScenario(utilization: number) {
  const attackerSize =
    MAX_CAPACITY * utilization;

  /*
   * First run with zero margin only to discover
   * the actual AMM entry price.
   *
   * The entry price does not depend on margin.
   */
  const discoveryState: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: INITIAL_TWAP,
    ammTwapPrice: MANIPULATED_TWAP,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };

  const discoveryManager =
    new PositionManager();

  /*
   * We need a valid margin for simulateTrade's
   * leverage check, so use a temporary amount.
   */
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

  const requiredMargin =
    calculateRequiredMargin(
      entryPrice,
      attackerSize,
    );

  /*
   * Now run the actual normalized attack.
   */
  const state: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: INITIAL_TWAP,
    ammTwapPrice: MANIPULATED_TWAP,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };

  const positionManager =
    new PositionManager();

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
      MANIPULATED_TWAP,
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
      utilization,
      attackerSize,
      entryPrice,
      requiredMargin,
      marginRatio,
      liquidated: true,
      realizedPnl: 0,
      requiredLpCapital: 0,
      lpToCapacityRatio: 0,
    };
  }

  const settlement =
    settleAndClosePosition(
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
    entryPrice,
    requiredMargin,
    marginRatio,
    liquidated: false,
    realizedPnl,
    requiredLpCapital: realizedPnl,
    lpToCapacityRatio:
      realizedPnl / MAX_CAPACITY,
  };
}

console.log(
  "\nNORMALIZED CAPACITY ATTACK",
);

console.log(
  "===========================",
);

const results =
  UTILIZATIONS.map(runScenario);

console.table(results);

console.log(
  "\nECONOMIC SUMMARY",
);

for (const r of results) {
  console.log({
    utilization: `${r.utilization * 100}%`,
    attackerSize: r.attackerSize,
    entryPrice: r.entryPrice,
    requiredMargin: r.requiredMargin,
    marginRatio: r.marginRatio,
    realizedPnl: r.realizedPnl,
    requiredLpCapital: r.requiredLpCapital,
    lpToCapacity:
      `${(r.lpToCapacityRatio * 100).toFixed(2)}%`,
  });
}
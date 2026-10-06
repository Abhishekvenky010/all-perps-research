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

import {
   calculateMarginRatio
} from "../../src/risk/Margin.js";

import { isLiquidatable } from "../../src/risk/Liquidation.js";

import type { MarketState } from "../../src/market/MarketState.js";
import type { MarketConfig } from "../../src/config/MarketConfig.js";
import { simulateTrade } from "../../src/simulation/TradeSimulator.js";

const INITIAL_TWAP = 100;
const MANIPULATED_TWAP = 95;
const RECOVERY_TWAP = 100;
// SCENARIO ASSUMPTION: this legacy experiment supplies the recovery price
// directly and does not replay production reference observations or TWAP.

const ATTACKER_SIZE = 30_000;
const ATTACKER_MARGIN = 80_800;

const LP_CAPITALS = [
  50_000,
  60_000,
  70_000,
  70_733,
  75_000,
  80_000,
  100_000,
  120_000,
];

const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: 100_000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 10,
  maintenanceMargin: 0.05,
};

function runScenario(lpCapital: number) {
  const state: MarketState = {
    symbol: "BTC-PERP",
    indexPrice: INITIAL_TWAP,
    ammTwapPrice: MANIPULATED_TWAP,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };

  const positionManager = new PositionManager();
  const vault = createLiquidityVault(lpCapital);

  const result = simulateTrade(
    state,
    "LONG",
    ATTACKER_SIZE,
    5,
    config,
    "attacker",
    ATTACKER_MARGIN,
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
      lpCapital,
      entryPrice: result.averagePrice,
      pnl: pnlAtManipulatedPrice,
      liquidated: true,
      realizedPnl: null,
      finalVaultCapital: vault.availableCapital,
      lpEquity: null,
      solvent: vault.availableCapital >= 0,
    };
  }

  let settlement: ReturnType<typeof settleAtExperimentalPrice>;
  try {
    settlement = settleAtExperimentalPrice(
      position.id,
      RECOVERY_TWAP,
      state,
      positionManager,
      vault,
    );
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "INSUFFICIENT_LP_BACKING"
    ) {
      throw error;
    }

    return {
      lpCapital,
      entryPrice: result.averagePrice,
      pnlAtManipulatedPrice,
      marginRatio,
      liquidated: false,
      realizedPnl: null,
      settlementRejected: true,
      finalVaultCapital: vault.availableCapital,
      lpEquity: vault.totalDeposited -
        vault.traderPnL +
        vault.premiums,
      solvent: vault.availableCapital >= 0,
    };
  }

  return {
    lpCapital,
    entryPrice: result.averagePrice,
    pnlAtManipulatedPrice,
    marginRatio,
    liquidated: false,
    realizedPnl: settlement.pnl,
    settlementRejected: false,
    finalVaultCapital: vault.availableCapital,
    lpEquity: vault.totalDeposited -
      vault.traderPnL +
      vault.premiums,
    solvent: vault.availableCapital >= 0,
  };
}

console.log("\nLP CAPITAL SENSITIVITY");
console.log("======================");

const results = LP_CAPITALS.map(runScenario);

for (const result of results) {
  console.log({
    lpCapital: result.lpCapital,
    entryPrice: result.entryPrice,
    pnlAtManipulatedPrice:
      result.pnlAtManipulatedPrice,
    realizedPnl: result.realizedPnl,
    finalVaultCapital:
      result.finalVaultCapital,
    lpEquity: result.lpEquity,
    solvent: result.solvent,
  });
}

console.log("\nSUMMARY");
console.table(results);
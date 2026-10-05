import type { MarketState } from "../src/market/MarketState.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";

import { PositionManager } from "../src/position/PositionManager.js";

import { simulateTrade } from "../src/simulation/TradeSimulator.js";

import {
  calculateUnrealizedPnL,
} from "../src/risk/PnL.js";

import {
  calculateMarginRatio,
} from "../src/risk/Margin.js";

import {
  isLiquidatable,
} from "../src/risk/Liquidation.js";

import {
  settleAndClosePosition,
} from "../src/settlement/SettleAndClosePosition.js";

import {
  createLiquidityVault,
} from "../src/liquidity/LiquidityVault.js";


const INITIAL_TWAP = 100;
const MANIPULATED_TWAP = 95;
const RECOVERY_TWAP = 100;

const ATTACKER_SIZE = 30_000;
const ATTACKER_MARGIN = 80_800;

const MAINTENANCE_MARGIN = 0.05;

const TRADE_STEPS = 5;


const config: MarketConfig = {
  symbol: "BTC-PERP",

  maxCapacity: 100_000,

  skewCoefficient: 0.2,

  capacityCoefficient: 0.05,

  maxLeverage: 10,

  maintenanceMargin: MAINTENANCE_MARGIN,
};


console.log("\n================================================");
console.log("ALL PERPS ATTACK SIMULATION");
console.log("================================================");

console.log({
  initialTwap: INITIAL_TWAP,
  manipulatedTwap: MANIPULATED_TWAP,
  recoveryTwap: RECOVERY_TWAP,

  attackerSize: ATTACKER_SIZE,
  attackerMargin: ATTACKER_MARGIN,

  maintenanceMargin: MAINTENANCE_MARGIN,

  maxCapacity: config.maxCapacity,
  skewCoefficient: config.skewCoefficient,
  capacityCoefficient: config.capacityCoefficient,
});


/*
 * ------------------------------------------------
 * 1. NORMAL MARKET
 * ------------------------------------------------
 */

const market: MarketState = {
  symbol: config.symbol,

  indexPrice: 100,

  ammTwapPrice: INITIAL_TWAP,

  longOpenInterest: 0,

  shortOpenInterest: 0,
};

const positionManager =
  new PositionManager();

const vault =
  createLiquidityVault(50_000);


console.log("\n=== INITIAL MARKET ===");

console.log({
  ammTwapPrice: market.ammTwapPrice,
  longOpenInterest: market.longOpenInterest,
  shortOpenInterest: market.shortOpenInterest,
});


/*
 * ------------------------------------------------
 * 2. MANIPULATE TWAP
 * ------------------------------------------------
 *
 * In this experiment we treat the external oracle
 * manipulation as already achieved.
 *
 * We are NOT using constant-product pricing here.
 *
 * We are testing what happens INSIDE All Perps
 * once the TWAP reaches 95.
 * ------------------------------------------------
 */

market.ammTwapPrice = MANIPULATED_TWAP;

console.log("\n=== TWAP MANIPULATED ===");

console.log({
  ammTwapPrice: market.ammTwapPrice,
});


/*
 * ------------------------------------------------
 * 3. ATTACKER OPENS LONG
 * ------------------------------------------------
 *
 * This uses the REAL All Perps pricing path:
 *
 * simulateTrade()
 *     ↓
 * getAverageExecutionPrice()
 *     ↓
 * skew impact
 *     +
 * capacity impact
 * ------------------------------------------------
 */

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


const position =
  trade.position;


console.log("\n=== ATTACKER ENTRY ===");

console.log({
  positionId: position.id,

  side: position.side,

  size: position.size,

  margin: position.margin,

  averageEntryPrice: trade.averagePrice,

  totalCost: trade.totalCost,

  priceHistory: trade.priceHistory,

  longOpenInterest:
    market.longOpenInterest,

  shortOpenInterest:
    market.shortOpenInterest,
});


/*
 * ------------------------------------------------
 * 4. MARK POSITION AT MANIPULATED TWAP
 * ------------------------------------------------
 */

const manipulatedPnl =
  calculateUnrealizedPnL(
    position,
    MANIPULATED_TWAP,
  );

const manipulatedEquity =
  position.margin +
  manipulatedPnl;

const manipulatedMarginRatio =
  calculateMarginRatio(
    position,
    manipulatedPnl,
  );

const manipulatedLiquidatable =
  isLiquidatable(
    position,
    manipulatedPnl,
    MAINTENANCE_MARGIN,
  );


console.log("\n=== MANIPULATED MARK ===");

console.log({
  markPrice: MANIPULATED_TWAP,

  entryPrice: position.entryPrice,

  pnl: manipulatedPnl,

  equity: manipulatedEquity,

  marginRatio:
    manipulatedMarginRatio,

  maintenanceMargin:
    MAINTENANCE_MARGIN,

  liquidatable:
    manipulatedLiquidatable,
});


/*
 * ------------------------------------------------
 * 5. RECOVER TWAP
 * ------------------------------------------------
 *
 * The oracle recovers from 95 → 100.
 *
 * We check the actual position against every
 * recovery mark.
 * ------------------------------------------------
 */

console.log("\n=== TWAP RECOVERY ===");

const RECOVERY_STEPS = 20;

let survivedRecovery = true;

let worstMarginRatio = Infinity;

let firstLiquidationPrice:
  number | null = null;


for (
  let i = 0;
  i <= RECOVERY_STEPS;
  i++
) {

  const markPrice =
    MANIPULATED_TWAP +
    (
      (RECOVERY_TWAP - MANIPULATED_TWAP)
      / RECOVERY_STEPS
    ) * i;


  const pnl =
    calculateUnrealizedPnL(
      position,
      markPrice,
    );


  const equity =
    position.margin +
    pnl;


  const marginRatio =
    calculateMarginRatio(
      position,
      pnl,
    );


  const liquidatable =
    isLiquidatable(
      position,
      pnl,
      MAINTENANCE_MARGIN,
    );


  worstMarginRatio =
    Math.min(
      worstMarginRatio,
      marginRatio,
    );


  console.log({
    step: i,

    markPrice:
      Number(markPrice.toFixed(4)),

    pnl:
      Number(pnl.toFixed(2)),

    equity:
      Number(equity.toFixed(2)),

    marginRatio:
      Number(
        marginRatio.toPrecision(10),
      ),

    liquidatable,
  });


  if (liquidatable) {

    survivedRecovery = false;

    firstLiquidationPrice =
      markPrice;

    break;
  }
}


/*
 * ------------------------------------------------
 * 6. REAL SETTLEMENT + CLOSE
 * ------------------------------------------------
 *
 * IMPORTANT:
 *
 * We use the actual settlement path.
 *
 * No manual PnL settlement.
 * ------------------------------------------------
 */

console.log("\n=== CLOSE ===");


let realizedPnl:
  number | null = null;

let traderSettlement:
  number | null = null;

let closeExecuted = false;


if (!survivedRecovery) {

  console.log({
    closeExecuted: false,

    reason:
      "LIQUIDATED_DURING_RECOVERY",

    firstLiquidationPrice,
  });

} else {

  const settlement =
    settleAndClosePosition(
      position.id,

      RECOVERY_TWAP,

      market,

      positionManager,

      vault,
    );


  realizedPnl =
    settlement.pnl;

  traderSettlement =
    settlement.traderSettlement;

  closeExecuted = true;


  console.log({
    closeExecuted,

    closePrice:
      RECOVERY_TWAP,

    realizedPnl,

    traderSettlement,

    releasedOpenInterest:
      settlement.releasedOpenInterest,
  });
}


/*
 * ------------------------------------------------
 * 7. FINAL STATE
 * ------------------------------------------------
 */

console.log("\n=== FINAL MARKET ===");

console.log({
  longOpenInterest:
    market.longOpenInterest,

  shortOpenInterest:
    market.shortOpenInterest,

  vault,
});


/*
 * ------------------------------------------------
 * 8. SUMMARY
 * ------------------------------------------------
 */

console.log("\n=== ATTACK SUMMARY ===");

console.log({
  twapManipulated:
    `${INITIAL_TWAP} → ${MANIPULATED_TWAP}`,

  twapRecovered:
    `${MANIPULATED_TWAP} → ${RECOVERY_TWAP}`,

  attackerSize:
    ATTACKER_SIZE,

  attackerMargin:
    ATTACKER_MARGIN,

  entryPrice:
    position.entryPrice,

  survivedManipulation:
    !manipulatedLiquidatable,

  survivedRecovery,

  worstMarginRatio,

  closeExecuted,

  realizedPnl,

  traderSettlement,

  finalVaultCapital:
    vault.availableCapital,
});


console.log("================================================\n");
import type { MarketState } from "../src/market/MarketState.js";

import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import { PositionManager } from "../src/position/PositionManager.js";

import { calculateUnrealizedPnL } from "../src/risk/PnL.js";
import { calculateMarginRatio } from "../src/risk/Margin.js";
import { isLiquidatable } from "../src/risk/Liquidation.js";

import { createLiquidityVault } from "../src/liquidity/LiquidityVault.js";
import { settleAndClosePosition } from "../src/settlement/SettleAndClosePosition.js";

import type { MarketConfig } from "../src/config/MarketConfig.js";


const TARGET_TWAP = 95;
const RECOVERY_PRICE = 100;

const ATTACKER_SIZE = 30_000;
const ATTACKER_MARGIN = 80_800;

const MAINTENANCE_MARGIN = 0.05;

const TRADE_STEPS = 5;
const RECOVERY_STEPS = 20;


const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: 100_000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 10,
  maintenanceMargin: MAINTENANCE_MARGIN,
};


console.log("\n================================================");
console.log("SURVIVAL / RECOVERY EXPERIMENT");
console.log("================================================");

console.log({
  targetTwap: TARGET_TWAP,
  recoveryPrice: RECOVERY_PRICE,
  attackerSize: ATTACKER_SIZE,
  attackerMargin: ATTACKER_MARGIN,
  leverage: ATTACKER_SIZE / ATTACKER_MARGIN,
  maintenanceMargin: MAINTENANCE_MARGIN,
});


/*
 * ------------------------------------------------
 * 1. Create manipulated market
 * ------------------------------------------------
 *
 * indexPrice remains 100.
 * AMM TWAP is manipulated to 95.
 */

const market: MarketState = {
  symbol: "BTC-PERP",
  indexPrice: 100,
  ammTwapPrice: TARGET_TWAP,
  longOpenInterest: 0,
  shortOpenInterest: 0,
};

const positionManager = new PositionManager();

const vault = createLiquidityVault(50_000);


/*
 * ------------------------------------------------
 * 2. Open attacker position
 * ------------------------------------------------
 */

const trade = simulateTrade(
  market,
  "LONG",
  ATTACKER_SIZE,
  TRADE_STEPS,
  config,
  "attacker",
  ATTACKER_MARGIN,
  positionManager,
);

const position = trade.position;

console.log("\n=== POSITION OPENED ===");

console.log({
  positionId: position.id,
  side: position.side,
  size: position.size,
  margin: position.margin,
  entryPrice: position.entryPrice,
  averageExecutionPrice: trade.averagePrice,
  priceHistory: trade.priceHistory,
  longOpenInterest: market.longOpenInterest,
});


/*
 * ------------------------------------------------
 * 3. Check position at manipulated TWAP = 95
 * ------------------------------------------------
 */

const manipulatedPnl = calculateUnrealizedPnL(
  position,
  TARGET_TWAP,
);

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
  markPrice: TARGET_TWAP,
  pnl: manipulatedPnl,
  equity: position.margin + manipulatedPnl,
  marginRatio: manipulatedMarginRatio,
  maintenanceMargin: MAINTENANCE_MARGIN,
  liquidatable: manipulatedLiquidatable,
});


/*
 * ------------------------------------------------
 * 4. Recovery: 95 -> 100
 * ------------------------------------------------
 */

console.log("\n=== RECOVERY ===");

let worstMarginRatio = Infinity;
let firstLiquidationPrice: number | null = null;
let survivedRecovery = true;

for (let i = 0; i <= RECOVERY_STEPS; i++) {
  const markPrice =
    TARGET_TWAP +
    ((RECOVERY_PRICE - TARGET_TWAP) / RECOVERY_STEPS) * i;

  const pnl = calculateUnrealizedPnL(
    position,
    markPrice,
  );

  const equity =
    position.margin + pnl;

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
    markPrice: Number(markPrice.toFixed(4)),
    pnl: Number(pnl.toFixed(2)),
    equity: Number(equity.toFixed(2)),
    marginRatio: Number(marginRatio.toPrecision(10)),
    liquidatable,
  });

  if (liquidatable) {
    survivedRecovery = false;

    if (firstLiquidationPrice === null) {
      firstLiquidationPrice = markPrice;
    }

    break;
  }
}


/*
 * ------------------------------------------------
 * 5. Attempt REAL settlement + close
 * ------------------------------------------------
 */

console.log("\n=== SETTLEMENT / CLOSE ===");

if (!survivedRecovery) {
  console.log({
    closeExecuted: false,
    reason: "POSITION_LIQUIDATED_DURING_RECOVERY",
    firstLiquidationPrice,
  });
} else {
  try {
    const settlement =
      settleAndClosePosition(
        position.id,
        RECOVERY_PRICE,
        market,
        positionManager,
        vault,
      );

    console.log({
      closeExecuted: true,

      closePrice: RECOVERY_PRICE,

      pnl: settlement.pnl,

      traderSettlement:
        settlement.traderSettlement,

      releasedOpenInterest:
        settlement.releasedOpenInterest,

      vaultAfterSettlement: vault,

      finalLongOpenInterest:
        market.longOpenInterest,

      finalShortOpenInterest:
        market.shortOpenInterest,
    });

  } catch (error) {
    console.log({
      closeExecuted: false,
      error:
        error instanceof Error
          ? error.message
          : String(error),
    });
  }
}


/*
 * ------------------------------------------------
 * 6. Final economic summary
 * ------------------------------------------------
 */

const headlinePnl =
  calculateUnrealizedPnL(
    position,
    RECOVERY_PRICE,
  );

console.log("\n=== SUMMARY ===");

console.log({
  entryPrice: position.entryPrice,

  manipulatedPrice: TARGET_TWAP,

  recoveryPrice: RECOVERY_PRICE,

  attackerSize: ATTACKER_SIZE,

  attackerMargin: ATTACKER_MARGIN,

  leverage:
    ATTACKER_SIZE / ATTACKER_MARGIN,

  headlinePnl,

  worstMarginRatio,

  survivedRecovery,

  firstLiquidationPrice,
});

console.log("================================================\n");
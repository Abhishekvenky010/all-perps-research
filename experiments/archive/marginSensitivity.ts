/**
 * ============================================================
 * MARGIN SENSITIVITY EXPERIMENT
 * ============================================================
 *
 * Question:
 *
 *   How much collateral does an attacker need to survive
 *   a manipulated TWAP long position?
 *
 * Fixed scenario:
 *   TWAP target      = 95
 *   manipulation     = 900s
 *   attacker size    = $30,000
 *   max capacity     = $100,000
 *
 * Only attacker margin changes.
 *
 * We do NOT change:
 *   - pricing
 *   - capacity
 *   - leverage configuration
 *   - liquidation threshold
 *   - attack cost model
 *
 * This experiment isolates the role of margin/liquidation.
 * ============================================================
 */

import {
  INITIAL_SPOT_PRICE,
  requiredSpotForTwap,
  config,
  survivesRecovery,
} from "./attackEconomicsModel.js";

import { PositionManager } from "../../src/position/PositionManager.js";
import { simulateTrade } from "../../src/simulation/TradeSimulator.js";

const TARGET_TWAP = 95;
const DURATION = 900;
const ATTACKER_SIZE = 30_000;

const MARGINS = [
  60000,
  70000,
  75000,
  80000,
  80500,
  80700,
  80750,
  80766,
  80800,
  81000,
  85000,
  90000,
  100000,
];
const MAINTENANCE_MARGIN =
  config.maintenanceMargin ?? 0.05;

/**
 * Open the attacker position using the same production
 * simulation path as the main attack experiment.
 */
function openAttackerPosition(margin: number) {
  const positionManager = new PositionManager();

  const state = {
    symbol: config.symbol,
    indexPrice: INITIAL_SPOT_PRICE,
    ammTwapPrice: TARGET_TWAP,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };

  return simulateTrade(
    state,
    "LONG",
    ATTACKER_SIZE,
    5,
    config,
    "attacker",
    margin,
    positionManager,
  );
}

console.log("\n================================================");
console.log("MARGIN SENSITIVITY");
console.log("================================================");

console.log({
  targetTwap: TARGET_TWAP,
  duration: DURATION,
  attackerSize: ATTACKER_SIZE,
  maxCapacity: config.maxCapacity,
  maintenanceMargin: MAINTENANCE_MARGIN,
});

console.log("\nRequired manipulated spot:");

const requiredSpot = requiredSpotForTwap(
  TARGET_TWAP,
  DURATION,
);

console.log(
  requiredSpot,
);

console.log("\n=== RESULTS ===");

const rows = [];

for (const margin of MARGINS) {
  const leverage = ATTACKER_SIZE / margin;

  try {
    /*
     * Open the position.
     */
    const entry = openAttackerPosition(margin);

    /*
     * Check whether the position survives recovery.
     */
    const recovery = survivesRecovery(
      entry.position,
      TARGET_TWAP,
    );

    /*
     * Print at full precision. The interesting behaviour here
     * lives in the last bits of the margin ratio: positions
     * sitting near the maintenance margin are separated from
     * it by less than toFixed(4) can show, so a rounded
     * display makes distinct margins look identical and hides
     * which side of the strict comparison they fall on.
     */
    rows.push({
      margin,
      leverage: Number(leverage.toFixed(2)),

      entryPrice: Number(
        entry.averagePrice.toFixed(4),
      ),

      marginRatioAtManipulatedMark:
        recovery.marginRatioAtManipulatedMark.toPrecision(
          12,
        ),

      /*
       * Signed distance from the maintenance margin. Negative
       * means the position is already below the threshold at
       * the manipulated mark, i.e. liquidatable on entry.
       */
      distanceToLiquidation: (
        recovery.marginRatioAtManipulatedMark -
        MAINTENANCE_MARGIN
      ).toPrecision(12),

      liquidatedOnEntry:
        recovery.liquidatedOnEntry,

      liquidated:
        recovery.liquidated,
    });
  } catch (error) {
    rows.push({
      margin,
      leverage: Number(leverage.toFixed(2)),
      entryPrice: NaN,
      marginRatioAtManipulatedMark: "NaN",
      distanceToLiquidation: "NaN",
      liquidatedOnEntry: false,
      liquidated: false,
      error: (error as Error).message,
    });
  }
}

console.table(rows);

console.log("\n=== SURVIVAL TRANSITION ===");

const firstSurvivor = rows.find(
  (row) =>
    row.liquidatedOnEntry === false &&
    row.liquidated === false,
);

if (firstSurvivor) {
  console.log({
    firstSurvivingMargin: firstSurvivor.margin,
    leverage: firstSurvivor.leverage,
    marginRatio:
      firstSurvivor.marginRatioAtManipulatedMark,
  });
} else {
  console.log(
    "No tested margin survived recovery.",
  );
}

console.log("\n=== ATTACK ECONOMICS ===");

console.log(
  "The manipulation cost is independent of attacker margin.",
);

console.log(
  "Margin changes whether the attacker survives long enough",
  "to realize the headline extraction.",
);

console.log(
  "================================================\n",
);
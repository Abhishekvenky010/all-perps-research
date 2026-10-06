import type { MarketState } from "../market/MarketState.js";
import type { MarketConfig } from "../config/MarketConfig.js";
import type { PositionManager } from "../position/PositionManager.js";
import type { LiquidityVault } from "../liquidity/LiquidityVault.js";

import {
  getRemainingCapacity,
} from "../amm/Capacity.js";

import {
  getCapacityUsage,
} from "../market/MarketMath.js";

import {
  markPosition,
  type PositionMark,
} from "./PositionMark.js";
import { getCurrentAmmPrice } from "../amm/Pricing.js";

import {
  settleAndLiquidatePositionsAtCurrentMark,
  type LiquidationResult,
} from "../settlement/SettleAndLiquidatePosition.js";
import { getSettlementPrice } from "../settlement/SettlementPrice.js";


export interface CapacitySnapshot {
  totalOpenInterest: number;
  remainingCapacity: number;
  capacityUsage: number;
  markPrice: number;
}


export interface LiquidationSweepResult {
  markPrice: number;

  marks: PositionMark[];

  liquidations: LiquidationResult[];

  releasedOpenInterest: number;

  capacityBefore: CapacitySnapshot;

  capacityAfter: CapacitySnapshot;

  recoveredCapacity: number;

  healthBefore: number;

  healthAfter: number;
}


const DEFAULT_MAINTENANCE_MARGIN = 0.05;

function snapshot(
  state: MarketState,
  config: MarketConfig,
): CapacitySnapshot {

  const totalOpenInterest =
    state.longOpenInterest +
    state.shortOpenInterest;

  return {
    totalOpenInterest,
    remainingCapacity: getRemainingCapacity(
      state,
      config,
    ),
    capacityUsage: getCapacityUsage(
      state,
      config,
    ),
    markPrice: getCurrentAmmPrice(state, config),
  };
}


function healthRatio(
  marks: PositionMark[],
): number {

  if (marks.length === 0) {
    return 1;
  }

  const healthy = marks.filter(
    mark => !mark.liquidatable,
  ).length;

  return healthy / marks.length;

}


/**
 * Runs the full feedback loop for a market:
 *
 *   AMM price -> position PnL -> margin ratio
 *             -> liquidation -> OI released -> capacity recovered
 *
 * The AMM mark price is derived from market skew, so liquidating
 * a skewed book moves the price back toward the TWAP. Releasing
 * the open interest of those positions then lowers capacity usage,
 * which is what reopens room for new exposure.
 */
export function runLiquidationSweep(
  state: MarketState,
  config: MarketConfig,
  positionManager: PositionManager,
  vault: LiquidityVault,
  maintenanceMargin: number =
    config.maintenanceMargin ??
    DEFAULT_MAINTENANCE_MARGIN,
): LiquidationSweepResult {


  const capacityBefore = snapshot(
    state,
    config,
  );


  const openPositions = positionManager
    .getAllPositions()
    .filter(
      position =>
        position.market === state.symbol,
    );


  const marks = openPositions.map(
    position => {
      const markPrice = getSettlementPrice(
        state,
        config,
        position,
      );
      return markPosition(
        position,
        markPrice,
        maintenanceMargin,
      );
    },
  );


  const healthBefore = healthRatio(marks);


  const liquidatableIds = marks
    .filter(mark => mark.liquidatable)
    .map(mark => mark.positionId);
  const liquidations: LiquidationResult[] =
    settleAndLiquidatePositionsAtCurrentMark(
      liquidatableIds,
      state,
      config,
      positionManager,
      vault,
      maintenanceMargin,
    );


  const releasedOpenInterest =
    liquidations.reduce(
      (total, liquidation) =>
        total +
        liquidation.releasedOpenInterest,
      0,
    );


  const capacityAfter = snapshot(
    state,
    config,
  );


  const survivingMarks = positionManager
    .getAllPositions()
    .filter(
      position =>
        position.market === state.symbol,
    )
    .map(
      position => {
        const markPrice = getSettlementPrice(
          state,
          config,
          position,
        );
        return markPosition(
          position,
          markPrice,
          maintenanceMargin,
        );
      },
    );


  return {
    markPrice: capacityBefore.markPrice,
    marks: survivingMarks,
    liquidations,
    releasedOpenInterest,
    capacityBefore,
    capacityAfter,
    recoveredCapacity:
      capacityAfter.remainingCapacity -
      capacityBefore.remainingCapacity,
    healthBefore,
    healthAfter: healthRatio(survivingMarks),
  };

}


/**
 * Convenience wrapper: after a sweep, how much new exposure
 * the market will accept right now.
 */
export function getRecoverableCapacity(
  state: MarketState,
  config: MarketConfig,
): number {

  return getRemainingCapacity(
    state,
    config,
  );
}

import type { MarketState } from "../market/MarketState.js";
import type { MarketConfig } from "../config/MarketConfig.js";
import type { Position } from "../position/Position.js";
import type { PositionManager } from "../position/PositionManager.js";
import type { LiquidityVault } from "../liquidity/LiquidityVault.js";
import {
  settleAndLiquidatePosition,
  type SettleAndLiquidateResult,
} from "../settlement/SettleAndLiquidatePosition.js";

export type LiquidationResult = SettleAndLiquidateResult;

export function liquidatePosition(
  position: Pick<Position, "id">,
  market: MarketState,
  config: MarketConfig,
  positionManager: PositionManager,
  vault: LiquidityVault,
  maintenanceMargin: number,
): LiquidationResult {
  const canonicalPosition = positionManager.getPosition(position.id);
  if (!canonicalPosition) {
    throw new Error("POSITION_NOT_FOUND");
  }

  return settleAndLiquidatePosition(
    canonicalPosition.id,
    market,
    config,
    positionManager,
    vault,
    maintenanceMargin,
  );
}

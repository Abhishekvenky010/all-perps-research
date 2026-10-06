import type { MarketState } from "../market/MarketState.js";
import type { MarketConfig } from "../config/MarketConfig.js";
import type {
  PositionManager,
} from "./PositionManager.js";
import type { LiquidityVault } from "../liquidity/LiquidityVault.js";
import {
  settleAndClosePosition,
  type SettleAndCloseResult,
} from "../settlement/SettleAndClosePosition.js";

export function closePosition(
  positionId: string,
  market: MarketState,
  config: MarketConfig,
  positionManager: PositionManager,
  vault: LiquidityVault,
): SettleAndCloseResult {
  return settleAndClosePosition(
    positionId,
    market,
    config,
    positionManager,
    vault,
  );
}
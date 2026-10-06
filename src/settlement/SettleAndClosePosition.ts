import type { MarketState } from "../market/MarketState.js";
import type { MarketConfig } from "../config/MarketConfig.js";
import type { PositionManager } from "../position/PositionManager.js";
import type { LiquidityVault } from "../liquidity/LiquidityVault.js";

import { calculatePositionSettlement } from "./PositionSettlement.js";
import { getSettlementPrice } from "./SettlementPrice.js";
import {
  prepareTraderPnL,
} from "../liquidity/LiquidityVault.js";

export interface SettleAndCloseResult {
  positionId: string;
  trader: string;
  side: "LONG" | "SHORT";
  size: number;
  entryPrice: number;
  settlementPrice: number;
  pnl: number;
  traderSettlement: number;
  releasedOpenInterest: number;
  lifecycle: "SETTLED";
}

export function settleAndClosePosition(
  positionId: string,
  market: MarketState,
  config: MarketConfig,
  positionManager: PositionManager,
  vault: LiquidityVault,
): SettleAndCloseResult {
  const position = positionManager.getPosition(positionId);

  if (!position) {
    throw new Error("POSITION_NOT_FOUND");
  }

  if (position.market !== market.symbol) {
    throw new Error("POSITION_MARKET_MISMATCH");
  }

  const settlementPrice = getSettlementPrice(
    market,
    config,
    position,
  );
  const settlement = calculatePositionSettlement(
    position,
    settlementPrice,
  );

  const preparedClose = positionManager.prepareClosePosition(
    positionId,
    market,
    "SETTLED",
  );
  const preparedPnL = prepareTraderPnL(vault, settlement.pnl);

  positionManager.commitClosePosition(preparedClose, vault, preparedPnL);

  return {
    positionId: position.id,
    trader: position.trader,
    side: position.side,
    size: position.size,
    entryPrice: position.entryPrice,
    settlementPrice,
    pnl: settlement.pnl,
    traderSettlement: settlement.traderSettlement,
    releasedOpenInterest: position.size,
    lifecycle: "SETTLED",
  };
}
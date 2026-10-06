// EXPERIMENTAL / SIMULATION ONLY. Production close and liquidation must use
// their canonical entry points, which derive settlement prices internally.
import type { MarketState } from "../../src/market/MarketState.js";
import type { PositionManager } from "../../src/position/PositionManager.js";
import type { LiquidityVault } from "../../src/liquidity/LiquidityVault.js";
import { prepareTraderPnL } from "../../src/liquidity/LiquidityVault.js";
import { calculatePositionSettlement } from "../../src/settlement/PositionSettlement.js";
import type { SettleAndCloseResult } from "../../src/settlement/SettleAndClosePosition.js";

export function settleAndClosePositionAtPriceForSimulation(
  positionId: string,
  settlementPrice: number,
  market: MarketState,
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

  const settlement = calculatePositionSettlement(position, settlementPrice);
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

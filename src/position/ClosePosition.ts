import type { MarketState } from "../market/MarketState.js";
import type { PositionManager } from "./PositionManager.js";

export function closePosition(
  positionId: string,
  market: MarketState,
  positionManager: PositionManager,
) {
  const position = positionManager.getPosition(positionId);

  if (!position) {
    throw new Error("POSITION_NOT_FOUND");
  }

  if (position.market !== market.symbol) {
    throw new Error("POSITION_MARKET_MISMATCH");
  }

  if (position.side === "LONG") {
    market.longOpenInterest -= position.size;

    if (market.longOpenInterest < 0) {
      throw new Error("INVALID_LONG_OPEN_INTEREST");
    }
  } else {
    market.shortOpenInterest -= position.size;

    if (market.shortOpenInterest < 0) {
      throw new Error("INVALID_SHORT_OPEN_INTEREST");
    }
  }

  positionManager.closePosition(positionId);

  return position;
}
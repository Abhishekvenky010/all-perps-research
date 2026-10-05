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

  // Validate first. Mutate only after all checks pass.
  if (position.side === "LONG") {
    if (market.longOpenInterest < position.size) {
      throw new Error("INVALID_LONG_OPEN_INTEREST");
    }

    market.longOpenInterest -= position.size;
  } else {
    if (market.shortOpenInterest < position.size) {
      throw new Error("INVALID_SHORT_OPEN_INTEREST");
    }

    market.shortOpenInterest -= position.size;
  }

  positionManager.closePosition(positionId);

  return position;
}
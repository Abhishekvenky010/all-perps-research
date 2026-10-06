import type { MarketConfig } from "../config/MarketConfig.js";
import type { MarketState } from "../market/MarketState.js";
import type { Position } from "../position/Position.js";
import { validatePosition } from "../position/Position.js";
import { getCurrentAmmPrice } from "../amm/Pricing.js";

export function getSettlementPrice(
  market: MarketState,
  config: MarketConfig,
  position: Readonly<Position>,
): number {
  validatePosition(position);

  if (config.symbol !== market.symbol) {
    throw new Error("MARKET_CONFIG_MISMATCH");
  }

  if (position.market !== market.symbol) {
    throw new Error("POSITION_MARKET_MISMATCH");
  }

  const longOpenInterest =
    position.side === "LONG"
      ? market.longOpenInterest - position.size
      : market.longOpenInterest;
  const shortOpenInterest =
    position.side === "SHORT"
      ? market.shortOpenInterest - position.size
      : market.shortOpenInterest;

  if (
    !Number.isFinite(longOpenInterest) ||
    longOpenInterest < 0 ||
    !Number.isFinite(shortOpenInterest) ||
    shortOpenInterest < 0
  ) {
    throw new Error("POSITION_OPEN_INTEREST_MISMATCH");
  }

  return getCurrentAmmPrice(
    {
      ...market,
      longOpenInterest,
      shortOpenInterest,
    },
    config,
  );
}

import type { MarketState } from "../market/MarketState.js";
import type { Position } from "./Position.js";
import {
  assertSolventPreparedPnL,
  commitTraderPnL,
  type LiquidityVault,
  type PreparedTraderPnL,
} from "../liquidity/LiquidityVault.js";
import { validatePosition } from "./Position.js";

export type PositionLifecycle = "OPEN" | "SETTLED" | "LIQUIDATED";

interface TerminalPosition {
  position: Readonly<Position>;
  lifecycle: Exclude<PositionLifecycle, "OPEN">;
}

export interface PreparedPositionClose {
  readonly id: string;
  readonly position: Readonly<Position>;
  readonly market: MarketState;
  readonly lifecycle: Exclude<PositionLifecycle, "OPEN">;
  readonly previousOpenInterest: number;
  readonly nextOpenInterest: number;
}

export class PositionManager {
  private readonly openPositions = new Map<string, Readonly<Position>>();
  private readonly terminalPositions = new Map<string, TerminalPosition>();

  openPosition(
    position: Position,
    market: MarketState,
    maxCapacity?: number,
  ): Readonly<Position> {
    const candidate = Object.freeze({ ...position });
    validatePosition(candidate);

    if (candidate.market !== market.symbol) {
      throw new Error("POSITION_MARKET_MISMATCH");
    }

    if (
      this.openPositions.has(candidate.id) ||
      this.terminalPositions.has(candidate.id)
    ) {
      throw new Error("POSITION_ID_ALREADY_EXISTS");
    }

    if (
      !Number.isFinite(market.longOpenInterest) ||
      market.longOpenInterest < 0 ||
      !Number.isFinite(market.shortOpenInterest) ||
      market.shortOpenInterest < 0
    ) {
      throw new Error("INVALID_OPEN_INTEREST");
    }
    this.assertOpenInterestMatches(market);

    if (
      maxCapacity !== undefined &&
      (!Number.isFinite(maxCapacity) || maxCapacity < 0)
    ) {
      throw new Error("INVALID_MARKET_CAPACITY");
    }

    const currentTotal =
      market.longOpenInterest + market.shortOpenInterest;
    const nextSideOpenInterest =
      this.calculateOpenInterest(candidate.side, candidate.market) +
      candidate.size;
    const nextLongOpenInterest =
      candidate.side === "LONG"
        ? nextSideOpenInterest
        : market.longOpenInterest;
    const nextShortOpenInterest =
      candidate.side === "SHORT"
        ? nextSideOpenInterest
        : market.shortOpenInterest;
    const nextTotalOpenInterest =
      nextLongOpenInterest + nextShortOpenInterest;

    if (
      !Number.isFinite(currentTotal) ||
      !Number.isFinite(nextSideOpenInterest) ||
      !Number.isFinite(nextTotalOpenInterest) ||
      (maxCapacity !== undefined &&
        nextTotalOpenInterest > maxCapacity)
    ) {
      throw new Error("MARKET_CAPACITY_EXCEEDED");
    }

    this.assertWritableMarketField(market, "longOpenInterest");
    this.assertWritableMarketField(market, "shortOpenInterest");

    this.openPositions.set(candidate.id, candidate);

    market.longOpenInterest = this.calculateOpenInterest(
      "LONG",
      market.symbol,
    );
    market.shortOpenInterest = this.calculateOpenInterest(
      "SHORT",
      market.symbol,
    );

    return candidate;
  }

  getPosition(id: string): Readonly<Position> | undefined {
    return this.openPositions.get(id);
  }

  getPositionLifecycle(id: string): PositionLifecycle | undefined {
    if (this.openPositions.has(id)) {
      return "OPEN";
    }

    return this.terminalPositions.get(id)?.lifecycle;
  }

  assertOpenInterestMatches(market: MarketState): void {
    if (
      market.longOpenInterest !==
        this.calculateOpenInterest("LONG", market.symbol) ||
      market.shortOpenInterest !==
        this.calculateOpenInterest("SHORT", market.symbol)
    ) {
      throw new Error("POSITION_OI_MISMATCH");
    }
  }

  getPositionsByTrader(trader: string): Readonly<Position>[] {
    return Array.from(this.openPositions.values()).filter(
      position => position.trader === trader,
    );
  }

  assertCanClosePosition(id: string, market: MarketState): Readonly<Position> {
    const position = this.openPositions.get(id);
    if (!position) {
      throw new Error("POSITION_NOT_FOUND");
    }

    if (position.market !== market.symbol) {
      throw new Error("POSITION_MARKET_MISMATCH");
    }

    const openInterest =
      position.side === "LONG"
        ? market.longOpenInterest
        : market.shortOpenInterest;
    if (
      !Number.isFinite(openInterest) ||
      openInterest < position.size
    ) {
      throw new Error(
        position.side === "LONG"
          ? "INVALID_LONG_OPEN_INTEREST"
          : "INVALID_SHORT_OPEN_INTEREST",
      );
    }

    this.assertOpenInterestMatches(market);
    return position;
  }

  prepareClosePosition(
    id: string,
    market: MarketState,
    lifecycle: Exclude<PositionLifecycle, "OPEN">,
  ): PreparedPositionClose {
    const position = this.openPositions.get(id);
    if (!position) {
      throw new Error("POSITION_NOT_FOUND");
    }

    if (lifecycle !== "SETTLED" && lifecycle !== "LIQUIDATED") {
      throw new Error("INVALID_POSITION_LIFECYCLE");
    }

    const canonicalPosition = this.assertCanClosePosition(id, market);
    const previousOpenInterest =
      canonicalPosition.side === "LONG"
        ? market.longOpenInterest
        : market.shortOpenInterest;
    const nextOpenInterest = this.calculateOpenInterest(
      canonicalPosition.side,
      market.symbol,
      id,
    );

    if (!Number.isFinite(nextOpenInterest) || nextOpenInterest < 0) {
      throw new Error("INVALID_OPEN_INTEREST");
    }

    const field =
      canonicalPosition.side === "LONG"
        ? "longOpenInterest"
        : "shortOpenInterest";
    this.assertWritableMarketField(market, field);

    return {
      id,
      position: canonicalPosition,
      market,
      lifecycle,
      previousOpenInterest,
      nextOpenInterest,
    };
  }

  commitClosePosition(
    prepared: PreparedPositionClose,
    vault: LiquidityVault,
    preparedPnL: PreparedTraderPnL,
  ): Readonly<Position> {
    if (this.openPositions.get(prepared.id) !== prepared.position) {
      throw new Error("POSITION_LIFECYCLE_CHANGED");
    }

    const currentOpenInterest =
      prepared.position.side === "LONG"
        ? prepared.market.longOpenInterest
        : prepared.market.shortOpenInterest;
    if (currentOpenInterest !== prepared.previousOpenInterest) {
      throw new Error("POSITION_OPEN_INTEREST_CHANGED");
    }
    this.assertOpenInterestMatches(prepared.market);
    const marketField =
      prepared.position.side === "LONG"
        ? "longOpenInterest"
        : "shortOpenInterest";
    this.assertWritableMarketField(prepared.market, marketField);

    this.assertWritableVault(vault, "traderPnL");
    this.assertWritableVault(vault, "availableCapital");
    if (
      vault.traderPnL !== preparedPnL.previousTraderPnL ||
      vault.availableCapital !== preparedPnL.previousAvailableCapital
    ) {
      throw new Error("VAULT_STATE_CHANGED");
    }
    assertSolventPreparedPnL(preparedPnL);

    this.openPositions.delete(prepared.id);
    this.terminalPositions.set(prepared.id, {
      position: prepared.position,
      lifecycle: prepared.lifecycle,
    });
    if (prepared.position.side === "LONG") {
      prepared.market.longOpenInterest = prepared.nextOpenInterest;
    } else {
      prepared.market.shortOpenInterest = prepared.nextOpenInterest;
    }
    commitTraderPnL(vault, preparedPnL);

    return prepared.position;
  }

  getAllPositions(): Readonly<Position>[] {
    return Array.from(this.openPositions.values());
  }

  private calculateOpenInterest(
    side: Position["side"],
    marketSymbol: string,
    excludedId?: string,
  ): number {
    let total = 0;
    for (const position of this.openPositions.values()) {
      if (
        position.id !== excludedId &&
        position.market === marketSymbol &&
        position.side === side
      ) {
        total += position.size;
      }
    }
    return total;
  }

  private assertWritableVault(
    vault: LiquidityVault,
    field: "traderPnL" | "availableCapital",
  ): void {
    const descriptor = Object.getOwnPropertyDescriptor(vault, field);
    if (!descriptor || !("value" in descriptor) || !descriptor.writable) {
      throw new Error("VAULT_STATE_NOT_MUTABLE");
    }
  }

  private assertWritableMarketField(
    market: MarketState,
    field: "longOpenInterest" | "shortOpenInterest",
  ): void {
    const descriptor = Object.getOwnPropertyDescriptor(market, field);
    if (!descriptor || !("value" in descriptor) || !descriptor.writable) {
      throw new Error("MARKET_STATE_NOT_MUTABLE");
    }
  }
}

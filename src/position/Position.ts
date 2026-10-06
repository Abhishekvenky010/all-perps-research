export type PositionSide = "LONG" | "SHORT";

export interface Position {
  readonly id: string;
  readonly trader: string;
  readonly market: string;
  readonly side: PositionSide;
  readonly size: number;
  readonly entryPrice: number;
  readonly margin: number;
}

export function validatePosition(position: Position): void {
  if (
    typeof position.id !== "string" ||
    position.id.length === 0 ||
    typeof position.trader !== "string" ||
    position.trader.length === 0 ||
    typeof position.market !== "string" ||
    position.market.length === 0
  ) {
    throw new Error("INVALID_POSITION_IDENTITY");
  }

  if (position.side !== "LONG" && position.side !== "SHORT") {
    throw new Error("INVALID_POSITION_SIDE");
  }

  if (!Number.isFinite(position.size) || position.size <= 0) {
    throw new Error("INVALID_POSITION_SIZE");
  }

  if (!Number.isFinite(position.entryPrice) || position.entryPrice <= 0) {
    throw new Error("INVALID_POSITION_ENTRY_PRICE");
  }

  if (!Number.isFinite(position.margin) || position.margin <= 0) {
    throw new Error("INVALID_POSITION_MARGIN");
  }
}
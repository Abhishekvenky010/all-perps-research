export type PositionSide = "LONG" | "SHORT";


export interface Position {

  id: string;

  trader: string;

  market: string;

  side: PositionSide;

  size: number;

  entryPrice: number;

  margin: number;

}
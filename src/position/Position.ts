export type PositionSide = "LONG" | "SHORT";


export interface Position {

  trader: string;

  side: PositionSide;

  size: number;

  entryPrice: number;

  margin: number;

}
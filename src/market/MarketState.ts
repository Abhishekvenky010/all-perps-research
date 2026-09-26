export interface MarketState {
  symbol: string;

  // Current oracle reference price
  indexPrice: number;

  // Total open long positions
  longOpenInterest: number;

  // Total open short positions
  shortOpenInterest: number;

}
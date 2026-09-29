export interface MarketState {
  symbol: string;

  // Current oracle reference price
  indexPrice: number;

  // 15-minute AMM pool TWAP
  ammTwapPrice: number;

  // Total open long positions
  longOpenInterest: number;

  // Total open short positions
  shortOpenInterest: number;
}
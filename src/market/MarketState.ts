export interface MarketState {
  symbol: string;

  // Latest validated reference observation, when supplied through the oracle service.
  indexPrice: number;

  // 15-minute arithmetic TWAP of reference observations.
  ammTwapPrice: number;

  // Total open long positions
  longOpenInterest: number;

  // Total open short positions
  shortOpenInterest: number;
}
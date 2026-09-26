export type MarketSymbol = string;

export interface MarketState {
  indexPrice: number;
  markPrice: number;
  fundingRate: number;
}

export class Market {
  private markets: Map<MarketSymbol, MarketState> = new Map();

  createMarket(
    symbol: MarketSymbol,
    indexPrice: number,
    fundingRate = 0,
  ): void {
    this.markets.set(symbol, {
      indexPrice,
      markPrice: indexPrice,
      fundingRate,
    });
  }

  getIndexPrice(symbol: MarketSymbol): number {
    return this.getMarket(symbol).indexPrice;
  }

  getMarkPrice(symbol: MarketSymbol): number {
    return this.getMarket(symbol).markPrice;
  }

  getFundingRate(symbol: MarketSymbol): number {
    return this.getMarket(symbol).fundingRate;
  }

  setIndexPrice(symbol: MarketSymbol, price: number): void {
    this.getMarket(symbol).indexPrice = price;
  }

  setMarkPrice(symbol: MarketSymbol, price: number): void {
    this.getMarket(symbol).markPrice = price;
  }

  setFundingRate(symbol: MarketSymbol, rate: number): void {
    this.getMarket(symbol).fundingRate = rate;
  }

  private getMarket(symbol: MarketSymbol): MarketState {
    const market = this.markets.get(symbol);

    if (!market) {
      throw new Error(`MARKET_NOT_FOUND: ${symbol}`);
    }

    return market;
  }
}
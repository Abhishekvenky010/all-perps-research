import { describe, expect, it } from "vitest";
import { getCurrentAmmPrice } from "../src/amm/Pricing.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";
import { PositionManager } from "../src/position/PositionManager.js";
import type { MarketState } from "../src/market/MarketState.js";
import { updateMarketFromReferencePrice } from "../src/oracle/ReferencePriceService.js";
import type { ReferencePriceSource } from "../src/oracle/ReferencePriceSource.js";
import { getSettlementPrice } from "../src/settlement/SettlementPrice.js";
import { settleAndClosePosition } from "../src/settlement/SettleAndClosePosition.js";
import { settleAndLiquidatePosition } from "../src/settlement/SettleAndLiquidatePosition.js";
import { createLiquidityVault } from "../src/liquidity/LiquidityVault.js";
import {
  calculateTWAP,
  recordPriceObservation,
  type PriceObservation,
} from "../src/oracle/TWAPOracle.js";

const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: 100_000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 20,
};

function source(observation: PriceObservation): ReferencePriceSource {
  return {
    getLatestObservation: () => ({ ...observation }),
  };
}

function marketState(): MarketState {
  return {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: 100,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };
}

describe("reference price oracle pipeline", () => {
  it("validates positive finite reference observations", () => {
    const stored = recordPriceObservation([], {
      timestamp: 0,
      price: 100,
    });
    expect(stored).toEqual([{ timestamp: 0, price: 100 }]);
  });

  it("rejects invalid prices/timestamps without changing prior observations", () => {
    const original: PriceObservation[] = [
      { timestamp: 0, price: 100 },
      { timestamp: 300, price: 101 },
    ];
    const before = structuredClone(original);

    for (const price of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() =>
        recordPriceObservation(original, { timestamp: 600, price }),
      ).toThrow("INVALID_PRICE_OBSERVATION");
    }
    for (const timestamp of [
      -1,
      Number.NaN,
      Number.POSITIVE_INFINITY,
      Number.NEGATIVE_INFINITY,
    ]) {
      expect(() =>
        recordPriceObservation(original, { timestamp, price: 102 }),
      ).toThrow("INVALID_PRICE_OBSERVATION");
    }

    expect(original).toEqual(before);
  });

  it("replaces same-timestamp observations and rejects backward time atomically", () => {
    const observations = recordPriceObservation([], {
      timestamp: 100,
      price: 100,
    });
    const replaced = recordPriceObservation(observations, {
      timestamp: 100,
      price: 105,
    });

    expect(replaced).toEqual([{ timestamp: 100, price: 105 }]);
    expect(observations).toEqual([{ timestamp: 100, price: 100 }]);

    expect(() =>
      recordPriceObservation(replaced, { timestamp: 99, price: 110 }),
    ).toThrow("Observation timestamp cannot go backward");
    expect(replaced).toEqual([{ timestamp: 100, price: 105 }]);
  });

  it("does not mutate market or history when source observation is invalid or future-dated", () => {
    const market = marketState();
    const observations: PriceObservation[] = [
      { timestamp: 0, price: 100 },
    ];
    const beforeMarket = { ...market };
    const beforeObservations = structuredClone(observations);

    for (const invalid of [
      { timestamp: 300, price: 0 },
      { timestamp: 300, price: Number.NaN },
      { timestamp: Number.NaN, price: 105 },
    ]) {
      expect(() =>
        updateMarketFromReferencePrice(
          market,
          observations,
          source(invalid),
          300,
        ),
      ).toThrow("INVALID_PRICE_OBSERVATION");
    }

    expect(() =>
      updateMarketFromReferencePrice(
        market,
        observations,
        source({ timestamp: 301, price: 105 }),
        300,
      ),
    ).toThrow("FUTURE_PRICE_OBSERVATION");

    expect(market).toEqual(beforeMarket);
    expect(observations).toEqual(beforeObservations);
  });

  it("updates reference index and complete TWAP, then settles from the same canonical protocol mark", () => {
    let market = marketState();
    let observations: PriceObservation[] = [];
    let update = updateMarketFromReferencePrice(
      market,
      observations,
      source({ timestamp: 0, price: 100 }),
      0,
    );
    market = update.market;
    observations = update.observations;

    update = updateMarketFromReferencePrice(
      market,
      observations,
      source({ timestamp: 450, price: 100 }),
      450,
    );
    market = update.market;
    observations = update.observations;

    update = updateMarketFromReferencePrice(
      market,
      observations,
      source({ timestamp: 900, price: 200 }),
      900,
    );
    market = update.market;
    observations = update.observations;

    expect(market.indexPrice).toBe(200);
    expect(market.ammTwapPrice).toBe(100);
    expect(calculateTWAP(observations, 900)).toBe(100);

    update = updateMarketFromReferencePrice(
      market,
      observations,
      source({ timestamp: 1_350, price: 200 }),
      1_350,
    );
    market = update.market;
    observations = update.observations;

    expect(market.ammTwapPrice).toBe(150);
    const protocolMark = getCurrentAmmPrice(market, config);
    expect(protocolMark).toBe(150);

    const positions = new PositionManager();
    const position = positions.openPosition({
      id: "reference-settlement",
      trader: "alice",
      market: market.symbol,
      side: "LONG",
      size: 1,
      entryPrice: 100,
      margin: 20,
    }, market);
    const previousObservationCount = observations.length;
    const beforeSettlementPrice = getSettlementPrice(
      market,
      config,
      position,
    );

    const result = settleAndClosePosition(
      position.id,
      market,
      config,
      positions,
      createLiquidityVault(1_000),
    );

    expect(result.settlementPrice).toBe(beforeSettlementPrice);
    expect(result.pnl).toBe((beforeSettlementPrice - position.entryPrice) * position.size);
    expect(observations).toHaveLength(previousObservationCount);
    expect(observations.at(-1)?.price).toBe(200);
    expect(observations.at(-1)?.price).not.toBe(protocolMark);
  });

  it("does not fabricate a TWAP before complete 900-second history exists", () => {
    const initial = marketState();
    const update = updateMarketFromReferencePrice(
      initial,
      [],
      source({ timestamp: 100, price: 125 }),
      100,
    );

    expect(update.market.indexPrice).toBe(125);
    expect(update.market.ammTwapPrice).toBe(initial.ammTwapPrice);
    expect(calculateTWAP(update.observations, 100)).toBeNull();
  });

  it("uses the reference-TWAP-derived mark for liquidation as well", () => {
    const zeroSkewConfig = { ...config, skewCoefficient: 0 };
    let market = marketState();
    let observations: PriceObservation[] = [];

    for (const [timestamp, price] of [
      [0, 100],
      [900, 80],
      [1_800, 80],
    ] as const) {
      const update = updateMarketFromReferencePrice(
        market,
        observations,
        source({ timestamp, price }),
        timestamp,
      );
      market = update.market;
      observations = update.observations;
    }

    expect(market.ammTwapPrice).toBe(80);
    const positions = new PositionManager();
    const position = positions.openPosition({
      id: "reference-liquidation",
      trader: "alice",
      market: market.symbol,
      side: "LONG",
      size: 1,
      entryPrice: 100,
      margin: 0.1,
    }, market);
    const settlementPrice = getSettlementPrice(
      market,
      zeroSkewConfig,
      position,
    );

    const result = settleAndLiquidatePosition(
      position.id,
      market,
      zeroSkewConfig,
      positions,
      createLiquidityVault(1_000),
      0.05,
    );

    expect(result.settlementPrice).toBe(settlementPrice);
    expect(result.pnl).toBe((settlementPrice - position.entryPrice) * position.size);
    expect(result.lifecycle).toBe("LIQUIDATED");
  });
});

import { describe, expect, it } from "vitest";
import type { MarketConfig } from "../src/config/MarketConfig.js";
import type { MarketState } from "../src/market/MarketState.js";
import type { Position } from "../src/position/Position.js";
import { PositionManager } from "../src/position/PositionManager.js";
import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import { settleAndClosePosition } from "../src/settlement/SettleAndClosePosition.js";
import { settleAndLiquidatePosition } from "../src/settlement/SettleAndLiquidatePosition.js";
import { getSettlementPrice } from "../src/settlement/SettlementPrice.js";
import {
  createLiquidityVault,
  addPremium,
  commitTraderPnL,
  depositLP,
  prepareTraderPnL,
  type LiquidityVault,
} from "../src/liquidity/LiquidityVault.js";
import { markPosition } from "../src/risk/PositionMark.js";
import {
  calculateTWAP,
  type PriceObservation,
} from "../src/oracle/TWAPOracle.js";
import { updateMarketFromReferencePrice } from "../src/oracle/ReferencePriceService.js";
import { simulateImplementedEconomicScenario } from "../experiments/implementedEconomicSecurity.js";

const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: 100,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 20,
  maintenanceMargin: 0.05,
};

function makeMarket(overrides: Partial<MarketState> = {}): MarketState {
  return {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: 100,
    longOpenInterest: 0,
    shortOpenInterest: 0,
    ...overrides,
  };
}

function position(
  id: string,
  side: Position["side"],
  size: number,
  overrides: Partial<Position> = {},
): Position {
  return {
    id,
    trader: `${id}-trader`,
    market: "BTC-PERP",
    side,
    size,
    entryPrice: 100,
    margin: Math.max(size, 1),
    ...overrides,
  };
}

function snapshot(
  market: MarketState,
  positions: PositionManager,
  vault: LiquidityVault,
  knownIds: readonly string[],
) {
  return {
    market: { ...market },
    positions: positions.getAllPositions().map(item => ({ ...item })),
    lifecycles: knownIds.map(id => [id, positions.getPositionLifecycle(id)]),
    vault: { ...vault },
  };
}

function reconcile(
  market: MarketState,
  positions: PositionManager,
  capacity: number,
  vault?: LiquidityVault,
): void {
  const open = positions.getAllPositions().filter(
    item => item.market === market.symbol,
  );
  const long = open
    .filter(item => item.side === "LONG")
    .reduce((total, item) => total + item.size, 0);
  const short = open
    .filter(item => item.side === "SHORT")
    .reduce((total, item) => total + item.size, 0);

  expect(market.longOpenInterest).toBe(long);
  expect(market.shortOpenInterest).toBe(short);
  expect(long + short).toBeLessThanOrEqual(capacity);
  if (vault) {
    expect(vault.availableCapital).toBeGreaterThanOrEqual(0);
  }
}

describe("final protocol invariants", () => {
  it("conserves position OI across successful opens, close, and liquidation", () => {
    const market = makeMarket();
    const positions = new PositionManager();
    const vault = createLiquidityVault(10_000);
    const long = simulateTrade(
      market, "LONG", 20, 1, config, "alice", 20, positions,
    ).position;
    reconcile(market, positions, config.maxCapacity, vault);
    expect(positions.getAllPositions()).toHaveLength(1);
    expect(market.longOpenInterest).toBe(20);

    const short = positions.openPosition(
      position("short", "SHORT", 10, { margin: 10 }),
      market,
      config.maxCapacity,
    );
    reconcile(market, positions, config.maxCapacity, vault);
    expect(market.shortOpenInterest).toBe(10);

    const close = settleAndClosePosition(
      long.id, market, config, positions, vault,
    );
    expect(close.releasedOpenInterest).toBe(long.size);
    expect(positions.getPositionLifecycle(long.id)).toBe("SETTLED");
    reconcile(market, positions, config.maxCapacity, vault);

    market.ammTwapPrice = 120;
    const liquidationPosition = positions.openPosition(
      position("liquidate-long", "LONG", 10, {
        entryPrice: 100,
        margin: 0.1,
      }),
      market,
      config.maxCapacity,
    );
    market.ammTwapPrice = 80;
    const liquidation = settleAndLiquidatePosition(
      liquidationPosition.id,
      market,
      config,
      positions,
      vault,
      config.maintenanceMargin!,
    );
    expect(liquidation.releasedOpenInterest).toBe(liquidationPosition.size);
    expect(positions.getPositionLifecycle(liquidationPosition.id)).toBe("LIQUIDATED");
    reconcile(market, positions, config.maxCapacity, vault);
    expect(positions.getPosition(short.id)).toBeDefined();
  });

  it("makes duplicate and over-capacity opens fail without changing state", () => {
    const market = makeMarket();
    const positions = new PositionManager();
    const vault = createLiquidityVault(500);
    const first = positions.openPosition(
      position("duplicate-id", "LONG", 90),
      market,
      config.maxCapacity,
    );
    const before = snapshot(market, positions, vault, [first.id, "overflow"]);

    expect(() => positions.openPosition(
      position(first.id, "LONG", 5),
      market,
      config.maxCapacity,
    )).toThrow("POSITION_ID_ALREADY_EXISTS");
    expect(() => simulateTrade(
      market, "SHORT", 11, 1, config, "overflow", 11, positions,
    )).toThrow("MARKET_CAPACITY_EXCEEDED");
    expect(snapshot(market, positions, vault, [first.id, "overflow"])).toEqual(before);
    reconcile(market, positions, config.maxCapacity, vault);
  });

  it.each([
    ["LONG-heavy", 90, 0, "LONG"],
    ["SHORT-heavy", 0, 90, "SHORT"],
    ["balanced", 45, 45, "LONG"],
  ] as const)(
    "allows exact-capacity opens and rejects overflow in a %s book",
    (_label, longSize, shortSize, addedSide) => {
      const market = makeMarket();
      const positions = new PositionManager();
      if (longSize > 0) {
        positions.openPosition(position("existing-long", "LONG", longSize), market, 100);
      }
      if (shortSize > 0) {
        positions.openPosition(position("existing-short", "SHORT", shortSize), market, 100);
      }
      const remaining = 100 - longSize - shortSize;
      const before = { ...market };

      simulateTrade(
        market,
        addedSide,
        remaining,
        1,
        config,
        "boundary",
        remaining,
        positions,
      );
      expect(market.longOpenInterest + market.shortOpenInterest).toBe(100);
      reconcile(market, positions, 100);

      const afterExact = snapshot(market, positions, createLiquidityVault(50), [
        ...positions.getAllPositions().map(item => item.id),
        "overflow",
      ]);
      expect(() => simulateTrade(
        market, addedSide, Number.EPSILON * 100, 1, config, "overflow", 1, positions,
      )).toThrow("MARKET_CAPACITY_EXCEEDED");
      expect(snapshot(market, positions, createLiquidityVault(50), [
        ...positions.getAllPositions().map(item => item.id),
        "overflow",
      ])).toEqual(afterExact);
      expect(before.longOpenInterest + before.shortOpenInterest).toBeLessThan(100);
    },
  );

  it("accepts the final epsilon of capacity and rejects any further exposure", () => {
    const market = makeMarket();
    const positions = new PositionManager();
    const epsilon = Number.EPSILON * 128;
    positions.openPosition(
      position("epsilon-base", "LONG", 100 - epsilon),
      market,
      100,
    );
    expect(market.longOpenInterest).toBeLessThan(100);
    expect(100 - market.longOpenInterest).toBe(epsilon);

    positions.openPosition(
      position("epsilon-fill", "SHORT", epsilon),
      market,
      100,
    );
    expect(market.longOpenInterest + market.shortOpenInterest).toBe(100);
    const before = {
      market: { ...market },
      positions: positions.getAllPositions().map(item => ({ ...item })),
    };
    expect(() => positions.openPosition(
      position("epsilon-overflow", "LONG", epsilon),
      market,
      100,
    )).toThrow("MARKET_CAPACITY_EXCEEDED");
    expect({
      market: { ...market },
      positions: positions.getAllPositions().map(item => ({ ...item })),
    }).toEqual(before);
  });

  it("rejects invalid trade and position inputs without state changes", () => {
    const market = makeMarket();
    const positions = new PositionManager();
    const vault = createLiquidityVault(1_000);
    const before = snapshot(market, positions, vault, ["bad"]);
    for (const size of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => simulateTrade(
        market, "LONG", size, 1, config, "bad", 1, positions,
      )).toThrow("INVALID_TRADE_SIZE");
    }
    for (const steps of [0, -1, 1.5, Number.NaN, Number.POSITIVE_INFINITY]) {
      expect(() => simulateTrade(
        market, "LONG", 1, steps, config, "bad", 1, positions,
      )).toThrow("INVALID_TRADE_STEPS");
    }
    expect(() => simulateTrade(
      market,
      "LONG",
      1,
      1,
      { ...config, symbol: "ETH-PERP" },
      "bad",
      1,
      positions,
    )).toThrow("MARKET_CONFIG_MISMATCH");
    for (const indexPrice of [0, -1, Number.NaN, Number.POSITIVE_INFINITY]) {
      const invalidPriceMarket = makeMarket({ indexPrice });
      const invalidPriceBefore = { ...invalidPriceMarket };
      expect(() => simulateTrade(
        invalidPriceMarket,
        "LONG",
        1,
        1,
        config,
        "bad",
        1,
        positions,
      )).toThrow("INVALID_POSITION_ENTRY_PRICE");
      expect(invalidPriceMarket).toEqual(invalidPriceBefore);
    }

    const valid = position("bad", "LONG", 1);
    const invalidPositions: Position[] = [
      { ...valid, id: "" },
      { ...valid, market: "ETH-PERP" },
      { ...valid, size: 0 },
      { ...valid, size: -1 },
      { ...valid, size: Number.NaN },
      { ...valid, size: Number.POSITIVE_INFINITY },
      { ...valid, entryPrice: 0 },
      { ...valid, entryPrice: Number.NaN },
      { ...valid, entryPrice: Number.POSITIVE_INFINITY },
      { ...valid, margin: 0 },
      { ...valid, margin: -1 },
      { ...valid, margin: Number.NaN },
      { ...valid, margin: Number.POSITIVE_INFINITY },
    ];
    for (const invalid of invalidPositions) {
      expect(() => positions.openPosition(invalid, market, 100)).toThrow();
      expect(snapshot(market, positions, vault, ["bad"])).toEqual(before);
    }
  });

  it("rejects partially immutable market OI state before any open mutation", () => {
    const market = makeMarket();
    Object.defineProperty(market, "shortOpenInterest", {
      value: 0,
      writable: false,
      enumerable: true,
      configurable: true,
    });
    const positions = new PositionManager();
    const beforeLong = market.longOpenInterest;

    expect(() => positions.openPosition(
      position("read-only-market", "LONG", 5),
      market,
      100,
    )).toThrow("MARKET_STATE_NOT_MUTABLE");
    expect(positions.getAllPositions()).toHaveLength(0);
    expect(positions.getPositionLifecycle("read-only-market")).toBeUndefined();
    expect(market.longOpenInterest).toBe(beforeLong);
    expect(market.shortOpenInterest).toBe(0);
  });

  it("uses the canonical settlement price and ignores a caller-supplied override", () => {
    const market = makeMarket({ ammTwapPrice: 110 });
    const positions = new PositionManager();
    const opened = positions.openPosition(
      position("canonical-close", "LONG", 10, { margin: 100 }),
      market,
      100,
    );
    const vault = createLiquidityVault(10_000);
    expect(() => getSettlementPrice(
      market,
      { ...config, symbol: "ETH-PERP" },
      opened,
    )    ).toThrow("MARKET_CONFIG_MISMATCH");

    const result = Reflect.apply(
      settleAndClosePosition,
      undefined,
      [opened.id, market, config, positions, vault, 1_000_000],
    );
    expect(result.settlementPrice).toBe(110);
    expect(result.settlementPrice).not.toBe(1_000_000);
  });

  it("excludes only each LONG or SHORT's own OI at different sizes", () => {
    for (const size of [10, 20, 30, 40, 50]) {
      for (const side of ["LONG", "SHORT"] as const) {
        const market = makeMarket();
        const positions = new PositionManager();
        const opened = positions.openPosition(
          position(`${side}-${size}`, side, size),
          market,
          100,
        );
        expect(getSettlementPrice(market, config, opened)).toBe(100);
        reconcile(market, positions, 100);
      }
    }
  });

  it.each([
    ["A", ["A", "B", "C"], 101],
    ["B", ["B", "A", "C"], 99],
    ["C", ["C", "A", "B"], 106],
  ] as const)(
    "settles positions against the expected live book when %s closes first",
    (_first, order, firstPrice) => {
      const market = makeMarket();
      const positions = new PositionManager();
      positions.openPosition(position("A", "LONG", 10, { margin: 500 }), market, 100);
      positions.openPosition(position("B", "LONG", 20, { margin: 500 }), market, 100);
      positions.openPosition(position("C", "SHORT", 15, { margin: 500 }), market, 100);
      const first = positions.getPosition(order[0]!)!;
      const result = settleAndClosePosition(
        first.id,
        market,
        config,
        positions,
        createLiquidityVault(10_000),
      );
      expect(result.settlementPrice).toBe(firstPrice);
      reconcile(market, positions, 100);
    },
  );

  it("applies strict liquidation boundaries to both sides", () => {
    for (const side of ["LONG", "SHORT"] as const) {
      for (const margin of [5.01, 5]) {
        const market = makeMarket();
        const positions = new PositionManager();
        const opened = positions.openPosition(
          position(`${side}-${margin}`, side, 100, { margin }),
          market,
          100,
        );
        const mark = markPosition(opened, 100, 0.05);
        expect(mark.marginRatio).toBeCloseTo(margin / 100, 12);
        expect(mark.liquidatable).toBe(false);
        expect(() => settleAndLiquidatePosition(
          opened.id,
          market,
          config,
          positions,
          createLiquidityVault(1_000),
          0.05,
        )).toThrow("POSITION_HEALTHY");
        expect(positions.getPositionLifecycle(opened.id)).toBe("OPEN");
      }

      const market = makeMarket();
      const positions = new PositionManager();
      const opened = positions.openPosition(
        position(`${side}-below`, side, 100, { margin: 4.99 }),
        market,
        100,
      );
      const result = settleAndLiquidatePosition(
        opened.id,
        market,
        config,
        positions,
        createLiquidityVault(1_000),
        0.05,
      );
      expect(result.closed).toBe(true);
      expect(result.marginRatio).toBeLessThan(0.05);
      expect(positions.getPositionLifecycle(opened.id)).toBe("LIQUIDATED");
    }
  });

  it("keeps exact-backed settlement atomic and rejects underfunding", () => {
    const market = makeMarket();
    const backingConfig = { ...config, maxCapacity: 20_000 };
    const positions = new PositionManager();
    const opened = positions.openPosition(
      position("exact-backing", "LONG", 10_000, {
        entryPrice: 100,
        margin: 20_000,
      }),
      market,
      backingConfig.maxCapacity,
    );
    market.ammTwapPrice = 101;
    const vault = createLiquidityVault(10_000);
    const result = settleAndClosePosition(
      opened.id, market, backingConfig, positions, vault,
    );
    expect(result.pnl).toBe(10_000);
    expect(vault.availableCapital).toBe(0);
    expect(positions.getPositionLifecycle(opened.id)).toBe("SETTLED");

    const underfundedMarket = makeMarket();
    const underfundedPositions = new PositionManager();
    const underfunded = underfundedPositions.openPosition(
      position("underfunded", "LONG", 10_001, { margin: 20_000 }),
      underfundedMarket,
      backingConfig.maxCapacity,
    );
    underfundedMarket.ammTwapPrice = 101;
    const underfundedVault = createLiquidityVault(10_000);
    const before = snapshot(
      underfundedMarket,
      underfundedPositions,
      underfundedVault,
      [underfunded.id],
    );
    expect(() => settleAndClosePosition(
      underfunded.id,
      underfundedMarket,
      backingConfig,
      underfundedPositions,
      underfundedVault,
    )).toThrow("INSUFFICIENT_LP_BACKING");
    expect(snapshot(
      underfundedMarket,
      underfundedPositions,
      underfundedVault,
      [underfunded.id],
    )).toEqual(before);
  });

  it("rejects invalid or overflowing vault mutations atomically", () => {
    const vault = createLiquidityVault(100);
    const before = { ...vault };
    for (const amount of [Number.NaN, Number.POSITIVE_INFINITY, 0, -1]) {
      expect(() => depositLP(vault, amount)).toThrow("INVALID_DEPOSIT");
      expect(vault).toEqual(before);
    }
    for (const premium of [Number.NaN, Number.POSITIVE_INFINITY, -1]) {
      expect(() => addPremium(vault, premium)).toThrow("INVALID_PREMIUM");
      expect(vault).toEqual(before);
    }

    const overflowVault = createLiquidityVault(Number.MAX_VALUE);
    const overflowBefore = { ...overflowVault };
    expect(() => depositLP(overflowVault, Number.MAX_VALUE)).toThrow("INVALID_DEPOSIT");
    expect(overflowVault).toEqual(overflowBefore);
    expect(() => addPremium(overflowVault, Number.MAX_VALUE)).toThrow("INVALID_PREMIUM");
    expect(overflowVault).toEqual(overflowBefore);

    const stalePrepared = prepareTraderPnL(vault, 10);
    vault.availableCapital -= 1;
    const staleBefore = { ...vault };
    expect(() => commitTraderPnL(vault, stalePrepared)).toThrow("VAULT_STATE_CHANGED");
    expect(vault).toEqual(staleBefore);
  });

  it("prevents duplicate financial settlement through all terminal paths", () => {
    const market = makeMarket();
    const positions = new PositionManager();
    const vault = createLiquidityVault(1_000);
    const opened = positions.openPosition(
      position("terminal", "LONG", 10, { margin: 100 }),
      market,
      100,
    );
    const first = settleAndClosePosition(
      opened.id, market, config, positions, vault,
    );
    const after = { ...vault };
    expect(positions.getPositionLifecycle(opened.id)).toBe("SETTLED");
    expect(() => settleAndClosePosition(
      opened.id, market, config, positions, vault,
    )).toThrow("POSITION_NOT_FOUND");
    expect(() => settleAndLiquidatePosition(
      opened.id, market, config, positions, vault, 0.05,
    )).toThrow("POSITION_NOT_FOUND");
    expect(vault).toEqual(after);
    expect(positions.getPositionLifecycle(opened.id)).toBe(first.lifecycle);

    const liquidationMarket = makeMarket({ ammTwapPrice: 80 });
    const liquidationPositions = new PositionManager();
    const liquidatable = liquidationPositions.openPosition(
      position("terminal-liquidation", "LONG", 10, {
        entryPrice: 100,
        margin: 0.1,
      }),
      liquidationMarket,
      100,
    );
    const liquidationVault = createLiquidityVault(1_000);
    const liquidation = settleAndLiquidatePosition(
      liquidatable.id,
      liquidationMarket,
      config,
      liquidationPositions,
      liquidationVault,
      0.05,
    );
    const afterLiquidation = { ...liquidationVault };
    expect(liquidationPositions.getPositionLifecycle(liquidatable.id)).toBe("LIQUIDATED");
    expect(() => settleAndLiquidatePosition(
      liquidatable.id,
      liquidationMarket,
      config,
      liquidationPositions,
      liquidationVault,
      0.05,
    )).toThrow("POSITION_NOT_FOUND");
    expect(() => settleAndClosePosition(
      liquidatable.id,
      liquidationMarket,
      config,
      liquidationPositions,
      liquidationVault,
    )).toThrow("POSITION_NOT_FOUND");
    expect(liquidationVault).toEqual(afterLiquidation);
    expect(liquidation.lifecycle).toBe("LIQUIDATED");
  });

  it("rejects invalid reference updates without changing prior oracle inputs", () => {
    const market = makeMarket({ ammTwapPrice: 97 });
    const observations: PriceObservation[] = [
      { timestamp: 0, price: 100 },
      { timestamp: 900, price: 110 },
    ];
    const originalMarket = { ...market };
    const originalObservations = structuredClone(observations);
    for (const observation of [
      { timestamp: 901, price: -1 },
      { timestamp: 901, price: 0 },
      { timestamp: 901, price: Number.NaN },
      { timestamp: 901, price: Number.POSITIVE_INFINITY },
      { timestamp: -1, price: 100 },
      { timestamp: 899, price: 100 },
    ]) {
      expect(() => updateMarketFromReferencePrice(
        market,
        observations,
        { getLatestObservation: () => observation },
        1_000,
      )).toThrow();
      expect(market).toEqual(originalMarket);
      expect(observations).toEqual(originalObservations);
    }
    expect(() => updateMarketFromReferencePrice(
      market,
      observations,
      { getLatestObservation: () => ({ timestamp: 1_001, price: 100 }) },
      1_000,
    )).toThrow("FUTURE_PRICE_OBSERVATION");
    expect(() => calculateTWAP(observations, Number.NaN)).toThrow("INVALID_TWAP_TIME");
  });

  it("uses a complete arithmetic 900-second TWAP and leaves incomplete history unchanged", () => {
    const market = makeMarket();
    const observations: PriceObservation[] = [];
    const update = updateMarketFromReferencePrice(
      market,
      observations,
      { getLatestObservation: () => ({ timestamp: 0, price: 100 }) },
      0,
    );
    expect(update.market.ammTwapPrice).toBe(100);

    const at900 = updateMarketFromReferencePrice(
      update.market,
      update.observations,
      { getLatestObservation: () => ({ timestamp: 900, price: 200 }) },
      900,
    );
    expect(at900.market.ammTwapPrice).toBe(100);
    const at1350 = updateMarketFromReferencePrice(
      at900.market,
      at900.observations,
      { getLatestObservation: () => ({ timestamp: 1_350, price: 200 }) },
      1_350,
    );
    expect(at1350.market.ammTwapPrice).toBe(150);
  });

  it("reproduces the five historical self-skew violation paths without extraction", () => {
    const cases = [
      [600, 0.4],
      [600, 0.5],
      [900, 0.3],
      [900, 0.4],
      [900, 0.5],
    ] as const;
    for (const [duration, utilization] of cases) {
      const result = simulateImplementedEconomicScenario({
        targetTwap: 95,
        duration,
        utilization,
        vaultDeposit: 10_000_000,
      });
      expect(result.attackCost).toBeGreaterThan(0);
      expect(result.settlementPrice).toBe(95);
      expect(result.realizedExtraction).toBe(0);
      expect(result.costToExtractionRatio).toBeNull();
      expect(result.liquidationOutcome).toBe("LIQUIDATED");
    }
  });

  it("checks conservation after each deterministic randomized lifecycle transition", () => {
    const market = makeMarket();
    const positions = new PositionManager();
    const vault = createLiquidityVault(1_000_000);
    const allIds: string[] = [];
    let seed = 0x5eed1234;
    const random = (limit: number): number => {
      seed = (Math.imul(seed, 1_664_525) + 1_013_904_223) >>> 0;
      return seed % limit;
    };

    for (let step = 0; step < 100; step++) {
      const openPositions = positions.getAllPositions();
      if (openPositions.length === 0 || random(3) !== 0) {
        const size = 1 + random(10);
        const side = random(2) === 0 ? "LONG" : "SHORT";
        const id = `seeded-${step}`;
        const before = snapshot(market, positions, vault, [...allIds, id]);
        if (market.longOpenInterest + market.shortOpenInterest + size > 100) {
          expect(() => simulateTrade(
            market,
            side,
            size,
            1,
            config,
            "randomized",
            size,
            positions,
          )).toThrow("MARKET_CAPACITY_EXCEEDED");
          expect(snapshot(market, positions, vault, [...allIds, id])).toEqual(before);
        } else {
          try {
            const result = simulateTrade(
              market,
              side,
              size,
              1,
              config,
              "randomized",
              size,
              positions,
            );
            allIds.push(result.position.id);
          } catch (error) {
            if (!(error instanceof Error)) {
              throw error;
            }
            expect([
              "CAPACITY_REACHED",
              "INVALID_POSITION_ENTRY_PRICE",
              "INVALID_TRADE_EXECUTION",
              "MARKET_CAPACITY_EXCEEDED",
            ]).toContain(error.message);
            expect(snapshot(market, positions, vault, [...allIds, id])).toEqual(before);
          }
        }
      } else {
        const target = openPositions[random(openPositions.length)]!;
        market.ammTwapPrice = 100 + (random(11) - 5);
        settleAndClosePosition(target.id, market, config, positions, vault);
      }
      reconcile(market, positions, config.maxCapacity, vault);
    }
  });
});

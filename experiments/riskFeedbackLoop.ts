
/**
 * Demonstrates the full risk feedback loop:
 *
 *   AMM price
 *     -> position PnL
 *     -> margin ratio
 *     -> liquidation
 *     -> OI released
 *     -> capacity recovered
 *
 * A long-crowded market is running at its capacity limit.
 * The TWAP then crashes, which pushes marks below entry for
 * thin-margin longs. Those positions liquidate, their open
 * interest is released, and capacity comes back.
 */
import assert from "node:assert/strict";
import fs from "fs";

import type {
  MarketState,
} from "../src/market/MarketState.js";

import type {
  MarketConfig,
} from "../src/config/MarketConfig.js";

import {
  PositionManager,
} from "../src/position/PositionManager.js";

import {
  runLiquidationSweep,
} from "../src/risk/LiquidationSweep.js";
import {
  createLiquidityVault,
} from "../src/liquidity/LiquidityVault.js";

import {
  getCurrentAmmPrice,
} from "../src/amm/Pricing.js";


const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: 100_000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 20,
  maintenanceMargin: 0.05,
};


interface ScenarioInput {
  name: string;
  longOpenInterest: number;
  shortOpenInterest: number;
  twap: number;
  entryPrice: number;
  margin: number;
}


/*
  Both positions are registered at the full open interest
  of their side, so the book is internally consistent: the
  sum of position sizes always equals market open interest.
*/
function runScenario(input: ScenarioInput) {
  const state: MarketState = {
    symbol: config.symbol,
    indexPrice: input.twap,
    ammTwapPrice: input.twap,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };

  const positionManager = new PositionManager();

  if (input.longOpenInterest > 0) {
    positionManager.openPosition({
      id: `${input.name}-long`,
      trader: "trader-long",
      market: config.symbol,
      side: "LONG",
      size: input.longOpenInterest,
      entryPrice: input.entryPrice,
      margin: input.margin,
    }, state);
  }

  if (input.shortOpenInterest > 0) {
    positionManager.openPosition({
      id: `${input.name}-short`,
      trader: "trader-short",
      market: config.symbol,
      side: "SHORT",
      size: input.shortOpenInterest,
      entryPrice: input.entryPrice,
      margin: input.margin,
    }, state);
  }


  const markPrice = getCurrentAmmPrice(
    state,
    config,
  );

  /*
    Snapshot the pre-sweep state: runLiquidationSweep mutates
    open interest in place, so reading these afterwards would
    report post-liquidation values under a pre-sweep label.
  */
  const before = {
    twap: state.ammTwapPrice,
    skew: state.longOpenInterest - state.shortOpenInterest,
    markPrice,
  };

  const result = runLiquidationSweep(
    state,
    config,
    positionManager,
    createLiquidityVault(1_000_000),
  );


  console.log(`\n=== ${input.name} ===`);
  console.log("step 1  AMM price", before);

  const marks = [
    ...result.liquidations.map(l => ({
      id: l.positionId,
      pnl: Number(l.pnl.toFixed(2)),
      marginRatio: Number(l.marginRatio.toFixed(4)),
      liquidatable: true,
    })),
    ...result.marks.map(m => ({
      id: m.positionId,
      pnl: Number(m.pnl.toFixed(2)),
      marginRatio: Number(m.marginRatio.toFixed(4)),
      liquidatable: m.liquidatable,
    })),
  ];

  console.log("step 2-3  marks", { marks });

  console.log("step 4-5  liquidations", {
    count: result.liquidations.length,
    releasedOpenInterest: result.releasedOpenInterest,
  });

  console.log("step 6  capacity", {
    before: result.capacityBefore,
    after: result.capacityAfter,
    recovered: result.recoveredCapacity,
  });


  /*
    The chain is only meaningful if releasing OI strictly
    increases available capacity.
  */
  assert.equal(
    result.recoveredCapacity,
    result.releasedOpenInterest,
  );

  assert.ok(
    result.capacityAfter.remainingCapacity >=
      result.capacityBefore.remainingCapacity,
  );


  return {
    scenario: input.name,
    markPrice: Number(markPrice.toFixed(4)),
    liquidated: result.liquidations.length,
    releasedOpenInterest: result.releasedOpenInterest,
    capacityBefore: result.capacityBefore.remainingCapacity,
    capacityAfter: result.capacityAfter.remainingCapacity,
    recoveredCapacity: result.recoveredCapacity,
    capacityUsageBefore: Number(
      result.capacityBefore.capacityUsage.toFixed(4),
    ),
    capacityUsageAfter: Number(
      result.capacityAfter.capacityUsage.toFixed(4),
    ),
    markPriceAfter: Number(
      result.capacityAfter.markPrice.toFixed(4),
    ),
  };
}


const results = [
  runScenario({
    name: "CRASH INTO LONG CROWD",
    longOpenInterest: 90_000,
    shortOpenInterest: 10_000,
    twap: 90,
    entryPrice: 110,
    margin: 2_000,
  }),

  runScenario({
    name: "HEALTHY BOOK (no liquidations)",
    longOpenInterest: 50_000,
    shortOpenInterest: 50_000,
    twap: 100,
    entryPrice: 100,
    margin: 50_000,
  }),

  runScenario({
    name: "SPIKE INTO SHORT CROWD",
    longOpenInterest: 10_000,
    shortOpenInterest: 90_000,
    twap: 90,
    entryPrice: 110,
    margin: 2_000,
  }),
];


fs.mkdirSync("results", { recursive: true });

fs.writeFileSync(
  "results/risk-loop.json",
  JSON.stringify(results, null, 2),
);

console.log("\nAll risk-loop assertions passed.");
console.log("Saved to results/risk-loop.json");

// HISTORICAL / COUNTERFACTUAL VALIDATION ONLY. This module recreates the
// pre-fix comparison and must not be imported by production protocol code.
import { getCurrentAmmPrice } from "../../src/amm/Pricing.js";
import { calculatePositionSettlement } from "../../src/settlement/PositionSettlement.js";
import {
  createLiquidityVault,
  prepareTraderPnL,
  commitTraderPnL,
} from "../../src/liquidity/LiquidityVault.js";
import { PositionManager } from "../../src/position/PositionManager.js";
import { markPosition } from "../../src/risk/PositionMark.js";
import { simulateTrade } from "../../src/simulation/TradeSimulator.js";
import { updateMarketFromReferencePrice } from "../../src/oracle/ReferencePriceService.js";
import { manipulationAttackCost } from "./attackEconomicsModel.js";
import type { MarketConfig } from "../../src/config/MarketConfig.js";
import type { MarketState } from "../../src/market/MarketState.js";
import type { Position } from "../../src/position/Position.js";
import type { Side } from "../../src/amm/Pricing.js";
import type { PriceObservation } from "../../src/oracle/TWAPOracle.js";

const BASE_PRICE = 100;
const WINDOW_SECONDS = 900;
const INTERVAL_SECONDS = 15;
const DEFAULT_BACKING = 10_000_000;

export type SettlementModel = "A" | "B" | "C";

export interface ModelResult {
  model: SettlementModel;
  settlementMark: number;
  pnl: number;
  vaultImpact: number;
  attackCost: number;
  costToExtractionRatio: number | null;
  liquidatableAtSettlement: boolean;
  committedByProduction: boolean;
}

export interface SelfSkewScenarioResult {
  targetTwap: number;
  duration: number;
  utilization: number;
  side: Side;
  positionSize: number;
  entryPrice: number;
  margin: number;
  twap: number;
  initialMarket: MarketState;
  position: Readonly<Position>;
  models: Record<SettlementModel, ModelResult>;
}

export interface SelfSkewScenarioInput {
  targetTwap?: number;
  duration?: number;
  utilization: number;
  side: Side;
  capacity?: number;
  skewCoefficient?: number;
  capacityCoefficient?: number;
  vaultBacking?: number;
  leverage?: number;
}

function createConfig(
  capacity: number,
  skewCoefficient: number,
  capacityCoefficient: number,
): MarketConfig {
  return {
    symbol: "BTC-PERP",
    maxCapacity: capacity,
    skewCoefficient,
    capacityCoefficient,
    maxLeverage: 10,
    maintenanceMargin: 0.05,
  };
}

/**
 * EXPERIMENTAL / COUNTERFACTUAL: mark as if this position's own exposure
 * had already been removed from OI. Does not mutate either argument.
 */
export function getCounterfactualSettlementMark(
  market: Readonly<MarketState>,
  position: Readonly<Position>,
  config: MarketConfig,
): number {
  if (position.market !== market.symbol) {
    throw new Error("POSITION_MARKET_MISMATCH");
  }

  const longOpenInterest =
    position.side === "LONG"
      ? market.longOpenInterest - position.size
      : market.longOpenInterest;
  const shortOpenInterest =
    position.side === "SHORT"
      ? market.shortOpenInterest - position.size
      : market.shortOpenInterest;

  if (
    !Number.isFinite(position.size) ||
    position.size <= 0 ||
    !Number.isFinite(longOpenInterest) ||
    longOpenInterest < 0 ||
    !Number.isFinite(shortOpenInterest) ||
    shortOpenInterest < 0
  ) {
    throw new Error("INVALID_COUNTERFACTUAL_OPEN_INTEREST");
  }

  return getCurrentAmmPrice(
    {
      ...market,
      longOpenInterest,
      shortOpenInterest,
    },
    config,
  );
}

function referenceUpdate(
  market: MarketState,
  observations: PriceObservation[],
  price: number,
  timestamp: number,
): { market: MarketState; observations: PriceObservation[] } {
  return updateMarketFromReferencePrice(
    market,
    observations,
    { getLatestObservation: () => ({ timestamp, price }) },
    timestamp,
  );
}

function buildRecoveredMarket(
  targetTwap: number,
  duration: number,
): { market: MarketState; observations: PriceObservation[] } {
  const config = createConfig(100_000, 0.2, 0.05);
  let market: MarketState = {
    symbol: config.symbol,
    indexPrice: BASE_PRICE,
    ammTwapPrice: BASE_PRICE,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };
  let observations: PriceObservation[] = [];
  const manipulatedPrice =
    (targetTwap * WINDOW_SECONDS -
      BASE_PRICE * (WINDOW_SECONDS - duration)) /
    duration;

  if (!Number.isFinite(manipulatedPrice) || manipulatedPrice <= 0) {
    throw new Error("UNREACHABLE_TARGET_TWAP");
  }

  for (
    let timestamp = 0;
    timestamp <= WINDOW_SECONDS;
    timestamp += INTERVAL_SECONDS
  ) {
    const result = referenceUpdate(
      market,
      observations,
      timestamp < duration ? manipulatedPrice : BASE_PRICE,
      timestamp,
    );
    market = result.market;
    observations = result.observations;
  }

  for (
    let timestamp = WINDOW_SECONDS + INTERVAL_SECONDS;
    timestamp <= 2 * WINDOW_SECONDS;
    timestamp += INTERVAL_SECONDS
  ) {
    const result = referenceUpdate(
      market,
      observations,
      BASE_PRICE,
      timestamp,
    );
    market = result.market;
    observations = result.observations;
  }

  return { market, observations };
}

function assessModel(
  model: SettlementModel,
  settlementMark: number,
  position: Readonly<Position>,
  config: MarketConfig,
  vaultBacking: number,
  attackCost: number,
  committedByProduction: boolean,
): ModelResult {
  const settlement = calculatePositionSettlement(
    position as Position,
    settlementMark,
  );
  const mark = markPosition(
    position as Position,
    settlementMark,
    config.maintenanceMargin ?? 0.05,
  );
  const pnl = settlement.pnl;
  const vault = createLiquidityVault(vaultBacking);
  const prepared = prepareTraderPnL(vault, pnl);
  commitTraderPnL(vault, prepared);

  return {
    model,
    settlementMark,
    pnl,
    vaultImpact: vaultBacking - vault.availableCapital,
    attackCost,
    costToExtractionRatio:
      pnl > 0 ? attackCost / pnl : null,
    liquidatableAtSettlement: mark.liquidatable,
    committedByProduction,
  };
}

/**
 * HISTORICAL / COUNTERFACTUAL VALIDATION: recreates pre-fix A/B/C settlement
 * marks against the same opened position and recovered reference/TWAP path.
 * No model executes production settlement.
 */
export function runSelfSkewSettlementScenario(
  input: SelfSkewScenarioInput,
): SelfSkewScenarioResult {
  const targetTwap = input.targetTwap ?? 95;
  const duration = input.duration ?? 900;
  const capacity = input.capacity ?? 100_000;
  const skewCoefficient = input.skewCoefficient ?? 0.2;
  const capacityCoefficient = input.capacityCoefficient ?? 0.05;
  const vaultBacking = input.vaultBacking ?? DEFAULT_BACKING;
  const leverage = input.leverage ?? 1;
  const utilization = input.utilization;
  const side = input.side;

  if (
    !Number.isFinite(utilization) ||
    utilization <= 0 ||
    utilization > 0.5 ||
    !Number.isFinite(leverage) ||
    leverage <= 0 ||
    leverage > 10
  ) {
    throw new Error("INVALID_SELF_SKEW_SCENARIO");
  }

  const config = createConfig(
    capacity,
    skewCoefficient,
    capacityCoefficient,
  );
  const marketPath = buildRecoveredMarket(targetTwap, duration);
  const market = marketPath.market;
  const twap = market.ammTwapPrice;
  const positionSize = capacity * utilization;
  const margin = positionSize / leverage;
  const manager = new PositionManager();

  // Use the recovered state only to snapshot the path; open at the target
  // TWAP state, as in the original manipulation scenario.
  const entryMarket: MarketState = {
    ...market,
    ammTwapPrice: targetTwap,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };
  const trade = simulateTrade(
    entryMarket,
    side,
    positionSize,
    5,
    config,
    "attacker",
    margin,
    manager,
  );
  const position = trade.position;

  const settlementMarket: MarketState = {
    ...market,
    longOpenInterest: entryMarket.longOpenInterest,
    shortOpenInterest: entryMarket.shortOpenInterest,
  };
  const attackCost = manipulationAttackCost(
    (targetTwap * WINDOW_SECONDS -
      BASE_PRICE * (WINDOW_SECONDS - duration)) /
      duration,
    duration,
  ).totalAttackCost;

  const modelAMark = getCurrentAmmPrice(settlementMarket, config);
  const modelBMark = getCounterfactualSettlementMark(
    settlementMarket,
    position,
    config,
  );
  const modelCMark = settlementMarket.ammTwapPrice;

  const modelA = assessModel(
    "A",
    modelAMark,
    position,
    config,
    vaultBacking,
    attackCost,
    false,
  );
  const modelB = assessModel(
    "B",
    modelBMark,
    position,
    config,
    vaultBacking,
    attackCost,
    false,
  );
  const modelC = assessModel(
    "C",
    modelCMark,
    position,
    config,
    vaultBacking,
    attackCost,
    false,
  );

  return {
    targetTwap,
    duration,
    utilization,
    side,
    positionSize,
    entryPrice: trade.averagePrice,
    margin,
    twap,
    initialMarket: settlementMarket,
    position,
    models: { A: modelA, B: modelB, C: modelC },
  };
}

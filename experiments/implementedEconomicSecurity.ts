import { manipulationAttackCost } from "./manipulationCostModel.js";
import { getSettlementPrice } from "../src/settlement/SettlementPrice.js";
import { updateMarketFromReferencePrice } from "../src/oracle/ReferencePriceService.js";
import { calculatePositionSettlement } from "../src/settlement/PositionSettlement.js";
import { createLiquidityVault } from "../src/liquidity/LiquidityVault.js";
import { PositionManager } from "../src/position/PositionManager.js";
import { markPosition } from "../src/risk/PositionMark.js";
import { settleAndClosePosition } from "../src/settlement/SettleAndClosePosition.js";
import { settleAndLiquidatePosition } from "../src/settlement/SettleAndLiquidatePosition.js";
import { simulateTrade } from "../src/simulation/TradeSimulator.js";
import type { MarketConfig } from "../src/config/MarketConfig.js";
import type { MarketState } from "../src/market/MarketState.js";
import type { Side } from "../src/amm/Pricing.js";
import type { PriceObservation } from "../src/oracle/TWAPOracle.js";

const INITIAL_PRICE = 100;
const TWAP_WINDOW = 900;
const OBSERVATION_INTERVAL = 15;

export type AttackLifecycle =
  | "REJECTED BEFORE POSITION"
  | "OPENED BUT LIQUIDATED"
  | "OPENED BUT UNABLE TO REALIZE PROFIT"
  | "REALIZED PROFIT"
  | "REALIZED LOSS";

export interface EconomicScenarioInput {
  targetTwap: number;
  duration: number;
  utilization: number;
  capacity?: number;
  vaultDeposit?: number;
  leverage?: number;
  side?: Side;
}

export interface EconomicScenarioResult {
  targetTwap: number;
  duration: number;
  utilization: number;
  capacity: number;
  positionSize: number;
  manipulatedReferencePrice: number;
  actualTwap: number;
  entryPrice: number | null;
  margin: number;
  manipulatedMark: number | null;
  entryMarginRatio: number | null;
  liquidationOutcome: "LIQUIDATED" | "NOT LIQUIDATED" | "NOT OPENED";
  settlementPrice: number | null;
  grossSettlementPnl: number | null;
  realizedTraderPnl: number;
  realizedExtraction: number;
  traderClaim: number | null;
  vaultChange: number;
  attackCost: number | null;
  costToExtractionRatio: number | null;
  status: AttackLifecycle;
  failure?: string;
}

function createConfig(
  symbol: string,
  capacity: number,
): MarketConfig {
  return {
    symbol,
    maxCapacity: capacity,
    skewCoefficient: 0.2,
    capacityCoefficient: 0.05,
    maxLeverage: 10,
    maintenanceMargin: 0.05,
  };
}

function nextReferenceUpdate(
  market: MarketState,
  observations: PriceObservation[],
  price: number,
  timestamp: number,
): {
  market: MarketState;
  observations: PriceObservation[];
} {
  return updateMarketFromReferencePrice(
    market,
    observations,
    {
      getLatestObservation: () => ({ timestamp, price }),
    },
    timestamp,
  );
}

function requiredReferencePrice(
  targetTwap: number,
  duration: number,
): number {
  return (
    (targetTwap * TWAP_WINDOW -
      INITIAL_PRICE * (TWAP_WINDOW - duration)) /
    duration
  );
}

function validateInput(input: EconomicScenarioInput): void {
  if (
    !Number.isFinite(input.targetTwap) ||
    input.targetTwap <= 0 ||
    !Number.isInteger(input.duration) ||
    input.duration <= 0 ||
    input.duration > TWAP_WINDOW ||
    input.duration % OBSERVATION_INTERVAL !== 0 ||
    !Number.isFinite(input.utilization) ||
    input.utilization <= 0 ||
    input.utilization > 1 ||
    (input.capacity !== undefined &&
      (!Number.isFinite(input.capacity) || input.capacity <= 0)) ||
    (input.vaultDeposit !== undefined &&
      (!Number.isFinite(input.vaultDeposit) ||
        input.vaultDeposit < 0)) ||
    (input.leverage !== undefined &&
      (!Number.isFinite(input.leverage) ||
        input.leverage <= 0 ||
        input.leverage > 10))
  ) {
    throw new Error("INVALID_ECONOMIC_SCENARIO");
  }
}

export function simulateImplementedEconomicScenario(
  input: EconomicScenarioInput,
): EconomicScenarioResult {
  validateInput(input);

  const capacity = input.capacity ?? 100_000;
  const duration = input.duration;
  const side = input.side ?? "LONG";
  const targetTwap = input.targetTwap;
  const utilization = input.utilization;
  const positionSize = capacity * utilization;
  const leverage = input.leverage ?? 5;
  const margin = positionSize / leverage;
  const manipulatedReferencePrice = requiredReferencePrice(
    targetTwap,
    duration,
  );
  const cost =
    manipulatedReferencePrice > 0 &&
    manipulatedReferencePrice < INITIAL_PRICE
      ? manipulationAttackCost(
          manipulatedReferencePrice,
          duration,
        ).totalAttackCost
      : null;

  const symbol = "BTC-PERP";
  const config = createConfig(symbol, capacity);
  let market: MarketState = {
    symbol,
    indexPrice: INITIAL_PRICE,
    ammTwapPrice: INITIAL_PRICE,
    longOpenInterest: 0,
    shortOpenInterest: 0,
  };
  let observations: PriceObservation[] = [];

  if (
    !Number.isFinite(manipulatedReferencePrice) ||
    manipulatedReferencePrice <= 0
  ) {
    return {
      targetTwap,
      duration,
      utilization,
      capacity,
      positionSize,
      manipulatedReferencePrice,
      actualTwap: Number.NaN,
      entryPrice: null,
      margin,
      manipulatedMark: null,
      entryMarginRatio: null,
      liquidationOutcome: "NOT OPENED",
      settlementPrice: null,
      grossSettlementPnl: null,
      realizedTraderPnl: 0,
      realizedExtraction: 0,
      traderClaim: null,
      vaultChange: 0,
      attackCost: cost,
      costToExtractionRatio: null,
      status: "REJECTED BEFORE POSITION",
      failure: "UNREACHABLE_TARGET_TWAP",
    };
  }

  for (
    let timestamp = 0;
    timestamp <= TWAP_WINDOW;
    timestamp += OBSERVATION_INTERVAL
  ) {
    const referencePrice =
      timestamp < duration
        ? manipulatedReferencePrice
        : INITIAL_PRICE;
    const update = nextReferenceUpdate(
      market,
      observations,
      referencePrice,
      timestamp,
    );
    market = update.market;
    observations = update.observations;
  }

  const actualTwap = market.ammTwapPrice;
  const positionManager = new PositionManager();
  const vault = createLiquidityVault(input.vaultDeposit ?? 50_000);
  const initialVaultCapital = vault.availableCapital;

  let trade;
  try {
    trade = simulateTrade(
      market,
      side,
      positionSize,
      5,
      config,
      "attacker",
      margin,
      positionManager,
    );
  } catch (error) {
    return {
      targetTwap,
      duration,
      utilization,
      capacity,
      positionSize,
      manipulatedReferencePrice,
      actualTwap,
      entryPrice: null,
      margin,
      manipulatedMark: null,
      entryMarginRatio: null,
      liquidationOutcome: "NOT OPENED",
      settlementPrice: null,
      grossSettlementPnl: null,
      realizedTraderPnl: 0,
      realizedExtraction: 0,
      traderClaim: null,
      vaultChange: 0,
      attackCost: cost,
      costToExtractionRatio: null,
      status: "REJECTED BEFORE POSITION",
      failure: error instanceof Error ? error.message : String(error),
    };
  }

  const maintenanceMargin = config.maintenanceMargin ?? 0.05;
  const positionId = trade.position.id;
  const manipulatedMark = getSettlementPrice(
    market,
    config,
    trade.position,
  );
  let currentMark = manipulatedMark;
  let mark = markPosition(
    trade.position,
    currentMark,
    maintenanceMargin,
  );
  const entryMarginRatio = mark.marginRatio;

  const settleLiquidation = (): EconomicScenarioResult => {
    const result = settleAndLiquidatePosition(
      positionId,
      market,
      config,
      positionManager,
      vault,
      maintenanceMargin,
    );
    const realizedTraderPnl = result.realizedPnL;
    const realizedExtraction = Math.max(realizedTraderPnl, 0);
    return {
      targetTwap,
      duration,
      utilization,
      capacity,
      positionSize,
      manipulatedReferencePrice,
      actualTwap,
      entryPrice: trade.averagePrice,
      margin,
      manipulatedMark,
      entryMarginRatio,
      liquidationOutcome: "LIQUIDATED",
      settlementPrice: result.settlementPrice,
      grossSettlementPnl: result.realizedPnL,
      realizedTraderPnl,
      realizedExtraction,
      traderClaim: result.traderSettlement,
      vaultChange: initialVaultCapital - vault.availableCapital,
      attackCost: cost,
      costToExtractionRatio:
        realizedExtraction > 0 && cost !== null
          ? cost / realizedExtraction
          : null,
      status: "OPENED BUT LIQUIDATED",
    };
  };

  if (mark.liquidatable) {
    try {
      return settleLiquidation();
    } catch (error) {
      if (
        !(error instanceof Error) ||
        error.message !== "INSUFFICIENT_LP_BACKING"
      ) {
        throw error;
      }
    }
  }

  for (
    let timestamp = TWAP_WINDOW + OBSERVATION_INTERVAL;
    timestamp <= 2 * TWAP_WINDOW;
    timestamp += OBSERVATION_INTERVAL
  ) {
    const update = nextReferenceUpdate(
      market,
      observations,
      INITIAL_PRICE,
      timestamp,
    );
    market = update.market;
    observations = update.observations;
    currentMark = getSettlementPrice(
      market,
      config,
      trade.position,
    );
    mark = markPosition(
      trade.position,
      currentMark,
      maintenanceMargin,
    );

    if (mark.liquidatable) {
      try {
        return settleLiquidation();
      } catch (error) {
        if (
          !(error instanceof Error) ||
          error.message !== "INSUFFICIENT_LP_BACKING"
        ) {
          throw error;
        }
      }
    }
  }

  const settlementPrice = getSettlementPrice(
    market,
    config,
    trade.position,
  );
  const grossSettlementPnl = calculatePositionSettlement(
    trade.position,
    settlementPrice,
  ).pnl;

  try {
    const result = settleAndClosePosition(
      positionId,
      market,
      config,
      positionManager,
      vault,
    );
    const realizedTraderPnl = result.pnl;
    const realizedExtraction = Math.max(realizedTraderPnl, 0);
    return {
      targetTwap,
      duration,
      utilization,
      capacity,
      positionSize,
      manipulatedReferencePrice,
      actualTwap,
      entryPrice: trade.averagePrice,
      margin,
      manipulatedMark,
      entryMarginRatio,
      liquidationOutcome: "NOT LIQUIDATED",
      settlementPrice: result.settlementPrice,
      grossSettlementPnl,
      realizedTraderPnl,
      realizedExtraction,
      traderClaim: result.traderSettlement,
      vaultChange: initialVaultCapital - vault.availableCapital,
      attackCost: cost,
      costToExtractionRatio:
        realizedExtraction > 0 && cost !== null
          ? cost / realizedExtraction
          : null,
      status:
        result.pnl > 0
          ? "REALIZED PROFIT"
          : "REALIZED LOSS",
    };
  } catch (error) {
    if (
      !(error instanceof Error) ||
      error.message !== "INSUFFICIENT_LP_BACKING"
    ) {
      throw error;
    }

    return {
      targetTwap,
      duration,
      utilization,
      capacity,
      positionSize,
      manipulatedReferencePrice,
      actualTwap,
      entryPrice: trade.averagePrice,
      margin,
      manipulatedMark,
      entryMarginRatio,
      liquidationOutcome: "NOT LIQUIDATED",
      settlementPrice,
      grossSettlementPnl,
      realizedTraderPnl: 0,
      realizedExtraction: 0,
      traderClaim: null,
      vaultChange: initialVaultCapital - vault.availableCapital,
      attackCost: cost,
      costToExtractionRatio: null,
      status: "OPENED BUT UNABLE TO REALIZE PROFIT",
      failure: error.message,
    };
  }
}

export function runImplementedEconomicSecurityMatrix(
  targets: readonly number[] = [95, 90, 85, 80],
  durations: readonly number[] = [15, 30, 60, 120, 300, 600, 900],
  utilizations: readonly number[] = [0.1, 0.2, 0.3, 0.4, 0.5],
  vaultDeposit = 50_000,
): EconomicScenarioResult[] {
  return targets.flatMap(targetTwap =>
    durations.flatMap(duration =>
      utilizations.map(utilization =>
        simulateImplementedEconomicScenario({
          targetTwap,
          duration,
          utilization,
          vaultDeposit,
        }),
      ),
    ),
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const rows = runImplementedEconomicSecurityMatrix();
  const fundedRows = runImplementedEconomicSecurityMatrix(
    undefined,
    undefined,
    undefined,
    10_000_000,
  );
  const capacityAxis = [50_000, 100_000, 200_000].map(capacity =>
    simulateImplementedEconomicScenario({
      targetTwap: 95,
      duration: 900,
      utilization: 0.3,
      capacity,
      vaultDeposit: 10_000_000,
    }),
  );
  const successful = fundedRows.filter(row => row.realizedExtraction > 0);
  const worstRatio = successful
    .filter(row => row.costToExtractionRatio !== null)
    .reduce<typeof successful[number] | null>(
      (worst, row) =>
        !worst ||
        (row.costToExtractionRatio ?? Infinity) <
          (worst.costToExtractionRatio ?? Infinity)
          ? row
          : worst,
      null,
    );
  const maximumExtractionScenario = fundedRows.reduce(
    (maximum, row) =>
      row.realizedExtraction > maximum.realizedExtraction ? row : maximum,
    fundedRows[0]!,
  );
  const maximumVaultLossScenario = fundedRows.reduce(
    (maximum, row) =>
      row.vaultChange > maximum.vaultChange ? row : maximum,
    fundedRows[0]!,
  );

  console.log(JSON.stringify({
    scenarioCount: rows.length,
    statuses: Object.fromEntries(
      [...new Set(rows.map(row => row.status))].map(status => [
        status,
        rows.filter(row => row.status === status).length,
      ]),
    ),
    fundedScenarioCount: fundedRows.length,
    capacityAxis,
    fundedStatusCounts: Object.fromEntries(
      [...new Set(fundedRows.map(row => row.status))].map(status => [
        status,
        fundedRows.filter(row => row.status === status).length,
      ]),
    ),
    worstRatio,
    maximumExtraction: maximumExtractionScenario.realizedExtraction,
    maximumExtractionScenario,
    maximumVaultLoss: maximumVaultLossScenario.vaultChange,
    maximumVaultLossScenario,
    historicalUnfunded: rows.filter(
      row =>
        row.targetTwap === 95 &&
        row.duration === 900 &&
        row.utilization === 0.3,
    ),
    historicalFunded: fundedRows.filter(
      row =>
        row.targetTwap === 95 &&
        row.duration === 900 &&
        row.utilization === 0.3,
    ),
    severityAtThirtyPercent: fundedRows.filter(
      row =>
        [95, 90, 85, 80].includes(row.targetTwap) &&
        row.duration === 900 &&
        row.utilization === 0.3,
    ),
  }, null, 2));
}

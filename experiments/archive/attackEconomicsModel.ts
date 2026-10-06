/*
 * ============================================================
 * ATTACK ECONOMICS MODEL
 * ============================================================
 *
 * The attack-economics sweep, extracted from
 * experiments/fullAttackEconomics.ts so that the experiment
 * only prints and tests/attackEconomics.test.ts can assert on
 * it without reimplementing the math.
 *
 * Two layers, deliberately kept apart:
 *
 *   1. The simulated oracle and execution path:
 *      TWAPOracle.ts arithmetic mean, the explicitly simulated
 *      protocol-mark observation adapter, updateAmmTwap for the TWAP, simulateTrade for both
 *      fills, markPosition for the liquidation check.
 *
 *   2. The constant-product manipulation cost, which is a
 *      prototype assumption. The All Perps source requires
 *      attack cost > attacker profit but does not specify a
 *      constant-product liquidity model, so nothing in layer 2
 *      is a specification.
 *
 * The quantity under test is the cost of *sustaining* a
 * manipulation against the profit extractable from the perp:
 *
 *   cost of sustaining manipulation > profit from perp
 *
 * Sustaining means paying the slippage on every block the
 * price is held off, so
 *
 *   attackCost = costPerBlock * manipulatedBlocks
 */

import { simulateTrade } from "../../src/simulation/TradeSimulator.js";
import { PositionManager } from "../../src/position/PositionManager.js";
import { markPosition } from "../../src/risk/PositionMark.js";

import { recordSimulatedProtocolMarkObservation } from "../../src/oracle/SimulatedProtocolMarkObservation.js";
import {
  updateAmmTwap,
  type PriceObservation,
} from "../../src/oracle/TWAPOracle.js";

import type { MarketState } from "../../src/market/MarketState.js";
import type { MarketConfig } from "../../src/config/MarketConfig.js";
import type { Position } from "../../src/position/Position.js";

/* ============================================================
 * CONFIGURATION
 * ========================================================== */

export const INITIAL_SPOT_PRICE = 100;

/** Production TWAP_WINDOW in TWAPOracle.ts, in seconds. */
export const TWAP_WINDOW = 15 * 60;

/** Observation spacing. The oracle accepts one per block. */
export const BLOCK = 15;

export const MANIPULATED_DURATIONS = [
  15, 30, 60, 120, 300, 600, 900,
];

export const TARGET_TWAPS = [
  90, 80, 70, 60, 50, 40,
];

/**
 * Attacker size is kept well under maxCapacity so that the
 * round trip (open long, then close it with a short) does not
 * push total open interest to the boundary. getCapacityImpact
 * throws CAPACITY_REACHED at usage >= 1, so a position that
 * filled to exactly maxCapacity cannot be closed through the
 * same path.
 */
const ATTACKER_SIZE = 20_000;
const ATTACKER_MARGIN = 4_000;
const TRADE_STEPS = 5;

const BASE_LIQUIDITY = 50_000;

export const config: MarketConfig = {
  symbol: "BTC-PERP",
  maxCapacity: 100_000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
  maxLeverage: 10,
};

export const MAINTENANCE_MARGIN =
  config.maintenanceMargin ?? 0.05;

/* ============================================================
 * MARKET STATE
 * ========================================================== */

function market(
  ammTwapPrice: number,
  longOpenInterest = 0,
  shortOpenInterest = 0,
): MarketState {
  return {
    symbol: config.symbol,
    indexPrice: INITIAL_SPOT_PRICE,
    ammTwapPrice,
    longOpenInterest,
    shortOpenInterest,
  };
}

/* ============================================================
 * TWAP INVERSION AND ORACLE REPLAY
 * ========================================================== */

/**
 * Arithmetic inversion of the TWAP.
 *
 * The oracle integrates the observed price linearly across the
 * window, so for a depressed price held for `duration`:
 *
 *   target * window
 *     = requiredSpot * duration
 *     + base * (window - duration)
 *
 * The old geometric inversion,
 * q = (target^n / p^(n-m))^(1/m), does not apply: production
 * averages linearly. It disagrees materially (81.0 vs 80.0 for
 * a half-window manipulation targeting 90) and loses precision
 * near m == n.
 */
export function requiredSpotForTwap(
  targetTwap: number,
  duration: number,
): number {
  if (duration <= 0 || duration > TWAP_WINDOW) {
    throw new Error("Invalid manipulation duration");
  }

  return (
    (targetTwap * TWAP_WINDOW -
      INITIAL_SPOT_PRICE *
        (TWAP_WINDOW - duration)) /
    duration
  );
}

/**
 * Replay a manipulation through the production oracle.
 *
 * `selfFlow` decides whether the depressed price is produced
 * by the attacker's own open interest. When it is, the price
 * is pushed twice: once by the exogenous pool level and again
 * by the attacker's skew, so the achieved TWAP undershoots.
 */
export function replayTwap(
  manipulatedSpot: number,
  duration: number,
  selfFlow: boolean,
): number {
  let observations: PriceObservation[] = [];

  for (
    let t = 0;
    t <= TWAP_WINDOW;
    t += BLOCK
  ) {
    const isManipulated = t < duration;

    const openInterest = selfFlow
      ? ATTACKER_SIZE *
        Math.min(t / duration, 1)
      : 0;

    const state = isManipulated
      ? market(manipulatedSpot, 0, openInterest)
      : market(
          INITIAL_SPOT_PRICE,
          0,
          openInterest,
        );

    observations = recordSimulatedProtocolMarkObservation(
      observations,
      state,
      config,
      t,
    );
  }

  return updateAmmTwap(
    market(INITIAL_SPOT_PRICE),
    observations,
    TWAP_WINDOW,
  ).ammTwapPrice;
}

/**
 * Open interest the attacker would need in order to move the
 * price by the same amount through their own skew alone.
 *
 *   price = base * (1 + skewCoefficient * oi / maxCapacity)
 */
export function openInterestForSkewMove(
  from: number,
  to: number,
): number {
  return (
    ((from - to) / from) *
    config.maxCapacity /
    config.skewCoefficient
  );
}

/* ============================================================
 * CONSTANT-PRODUCT MANIPULATION COST
 * ========================================================== */

function costToMovePrice(
  baseInput: number,
  referencePrice: number,
): number {
  const baseReserve = BASE_LIQUIDITY;
  const quoteReserve =
    BASE_LIQUIDITY * INITIAL_SPOT_PRICE;

  const newBase = baseReserve + baseInput;
  const newQuote =
    (baseReserve * quoteReserve) / newBase;

  const quoteOutput = quoteReserve - newQuote;

  const cost =
    baseInput * referencePrice - quoteOutput;

  return Math.max(cost, 0);
}

/**
 * Base input needed to drag the pool price down to `target`.
 * Constant product: p = quote / base, so the invariant gives
 *
 *   baseInput = sqrt(base * quote / target) - base
 */
function baseInputToReach(target: number): number {
  const baseReserve = BASE_LIQUIDITY;
  const quoteReserve =
    BASE_LIQUIDITY * INITIAL_SPOT_PRICE;

  if (target >= INITIAL_SPOT_PRICE) {
    throw new Error(
      "Downward leg requires target < spot",
    );
  }

  return (
    Math.sqrt(
      (baseReserve * quoteReserve) / target,
    ) - baseReserve
  );
}

/**
 * Cost of sustaining the manipulation.
 *
 * Holding a TWAP off the honest price is not a one-off trade.
 * The attacker pays the slippage on every block they keep the
 * pool off price, so
 *
 *   attackCost = costPerBlock * manipulatedBlocks
 *
 * with manipulatedBlocks = duration / BLOCK. At a fixed depth
 * the per-block cost is constant and the total is therefore
 * linear in duration.
 *
 * Restoring the price afterwards is part of the attack
 * narrative but is not added as a second independent slippage
 * cost. The sustained cost already accounts for the inventory
 * carried while the price is off, so charging the mirror move
 * again would double count it.
 */
export function manipulationAttackCost(
  target: number,
  duration: number,
): {
  costPerBlock: number;
  manipulatedBlocks: number;
  totalAttackCost: number;
} {
  const costPerBlock = costToMovePrice(
    baseInputToReach(target),
    INITIAL_SPOT_PRICE,
  );

  const manipulatedBlocks = duration / BLOCK;

  return {
    costPerBlock,
    manipulatedBlocks,
    totalAttackCost: costPerBlock * manipulatedBlocks,
  };
}

/* ============================================================
 * PERP EXECUTION
 * ========================================================== */

interface ExtractionResult {
  averageEntryPrice: number;
  averageExitPrice: number;
  roundTripPnl: number;
  entryError?: string | undefined;
  exitError?: string | undefined;
}

/**
 * The attacker buys the perp while the TWAP is depressed and
 * closes the position once the price recovers.
 *
 * Both legs go through simulateTrade, so skew, capacity spread
 * and the attacker's own accumulated open interest are priced
 * into the fills rather than assumed away.
 */
export function extractFromDepressedTwap(
  targetTwap: number,
  attackerSize = ATTACKER_SIZE,
): ExtractionResult {
  const positionManager = new PositionManager();

  const entryState = market(targetTwap);

  let entry;
  try {
    entry = simulateTrade(
      entryState,
      "LONG",
      attackerSize,
      TRADE_STEPS,
      config,
      "attacker",
      ATTACKER_MARGIN,
      positionManager,
    );
  } catch (error) {
    return {
      averageEntryPrice: NaN,
      averageExitPrice: NaN,
      roundTripPnl: NaN,
      entryError: (error as Error).message,
    };
  }

  /*
   * Exit. The honest price has recovered, and the attacker's
   * own long is still open, so closing means selling into
   * their own position.
   */
  const exitState = entry.finalState;
  exitState.ammTwapPrice = INITIAL_SPOT_PRICE;

  let averageExitPrice: number;
  let exitError: string | undefined;

  try {
    const exit = simulateTrade(
      exitState,
      "SHORT",
      entry.position.size,
      TRADE_STEPS,
      config,
      "attacker",
      ATTACKER_MARGIN,
      positionManager,
    );

    averageExitPrice = exit.averagePrice;
  } catch (error) {
    averageExitPrice = NaN;
    exitError = (error as Error).message;
  }

  const roundTripPnl = Number.isFinite(
    averageExitPrice,
  )
    ? (averageExitPrice - entry.averagePrice) *
      entry.position.size
    : NaN;

  return {
    averageEntryPrice: entry.averagePrice,
    averageExitPrice,
    roundTripPnl,
    exitError,
  };
}

/* ============================================================
 * LIQUIDATION ALONG THE RECOVERY PATH
 * ========================================================== */

export interface RecoveryCheck {
  liquidated: boolean;
  liquidatedOnEntry: boolean;
  firstLiquidationPrice: number | null;
  worstMarginRatio: number;
  marginRatioAtManipulatedMark: number;
}

/**
 * A long opened at the depressed TWAP has to survive the
 * window in which the price is still moving. Check the mark at
 * every block between the depressed TWAP and the honest price.
 *
 * The binding moment is the entry itself. The attacker buys
 * through the spread, so the fill sits above the TWAP that
 * marks their position, and the long starts life already under
 * water. If the gap between the fill and the mark exceeds the
 * margin buffer, the position is liquidatable before any
 * recovery happens at all.
 */
export function survivesRecovery(
  position: Position,
  targetTwap: number,
  maintenanceMargin = MAINTENANCE_MARGIN
): RecoveryCheck {
  let worstMarginRatio = Infinity;
  let firstLiquidationPrice: number | null =
    null;

  const steps = 20;

  for (let i = 0; i <= steps; i++) {
    const markPrice =
      targetTwap +
      ((INITIAL_SPOT_PRICE - targetTwap) * i) /
        steps;

    const mark = markPosition(
      position,
      markPrice,
      maintenanceMargin,
    );

    if (mark.marginRatio < worstMarginRatio) {
      worstMarginRatio = mark.marginRatio;
    }

    if (
      mark.liquidatable &&
      firstLiquidationPrice === null
    ) {
      firstLiquidationPrice = markPrice;
    }
  }

  const atManipulatedMark = markPosition(
    position,
    targetTwap,
    MAINTENANCE_MARGIN,
  );

  return {
    liquidated: firstLiquidationPrice !== null,
    liquidatedOnEntry: atManipulatedMark.liquidatable,
    firstLiquidationPrice,
    worstMarginRatio,
    marginRatioAtManipulatedMark:
      atManipulatedMark.marginRatio,
  };
}

/* ============================================================
 * SWEEP
 * ========================================================== */

export interface AttackRow {
  targetTwap: number;
  duration: number;
  requiredSpot: number;
  oracleTwap: number;
  oracleError: number;
  reachable: boolean;
  selfFlowUsagePct: number | null;
  selfFlowFeasible: boolean;
  entryPrice: number;
  exitPrice: number;
  roundTripPnl: number;
  manipulationCostPerBlock: number;
  manipulatedBlocks: number;
  attackCost: number;
  costToProfitRatio: number;
  naivePnlPositive: boolean;
  liquidated: boolean;
  liquidatedOnEntry: boolean;
  marginRatioAtManipulatedMark: number;
  worstMarginRatio: number;
  realizable: boolean;
  note: string;
}

export function runAttackSweep(
  durations: readonly number[] = MANIPULATED_DURATIONS,
  targets: readonly number[] = TARGET_TWAPS,
): AttackRow[] {
  const rows: AttackRow[] = [];

  for (const duration of durations) {
    for (const targetTwap of targets) {
      const requiredSpot =
        requiredSpotForTwap(targetTwap, duration);

      /*
       * The arithmetic TWAP is an average over a bounded
       * window, so a deep target held briefly needs a negative
       * spot. Report it rather than clamping.
       */
      if (
        requiredSpot <= 0 ||
        requiredSpot >= INITIAL_SPOT_PRICE
      ) {
        rows.push({
          targetTwap,
          duration,
          requiredSpot,
          oracleTwap: NaN,
          oracleError: NaN,
          reachable: false,
          selfFlowUsagePct: null,
          selfFlowFeasible: false,
          entryPrice: NaN,
          exitPrice: NaN,
          roundTripPnl: NaN,
          manipulationCostPerBlock: NaN,
          manipulatedBlocks: NaN,
          attackCost: NaN,
          costToProfitRatio: NaN,
          naivePnlPositive: false,
          liquidated: false,
          liquidatedOnEntry: false,
          marginRatioAtManipulatedMark: NaN,
          worstMarginRatio: NaN,
          realizable: false,
          note:
            requiredSpot <= 0
              ? "unreachable: needs a negative price"
              : "degenerate: no manipulation required",
        });

        continue;
      }

      const oracleTwap = replayTwap(
        requiredSpot,
        duration,
        false,
      );

      const oracleError = oracleTwap - targetTwap;

      const selfFlowOi = openInterestForSkewMove(
        INITIAL_SPOT_PRICE,
        requiredSpot,
      );

      const selfFlowUsagePct =
        (selfFlowOi / config.maxCapacity) * 100;

      const selfFlowFeasible =
        selfFlowUsagePct < 100;

      const extraction = extractFromDepressedTwap(
        targetTwap,
      );

      const cost = manipulationAttackCost(
        requiredSpot,
        duration,
      );

      const liquidation = survivesRecovery(
        openLongAt(targetTwap),
        targetTwap,
      );

      const costToProfitRatio =
        extraction.roundTripPnl > 0
          ? cost.totalAttackCost /
            extraction.roundTripPnl
          : NaN;

      /*
       * Naive profitability ignores the risk chain. Realizable
       * profit requires the attacker to still be holding the
       * position when the price recovers, and to come out
       * ahead after paying to sustain the manipulation.
       */
      const naivePnlPositive =
        Number.isFinite(extraction.roundTripPnl) &&
        extraction.roundTripPnl > 0;

      const realizable =
        naivePnlPositive &&
        !liquidation.liquidated &&
        cost.totalAttackCost < extraction.roundTripPnl;

      rows.push({
        targetTwap,
        duration,
        requiredSpot,
        oracleTwap,
        oracleError,
        reachable: true,
        selfFlowUsagePct,
        selfFlowFeasible,
        entryPrice: extraction.averageEntryPrice,
        exitPrice: extraction.averageExitPrice,
        roundTripPnl: extraction.roundTripPnl,
        manipulationCostPerBlock: cost.costPerBlock,
        manipulatedBlocks: cost.manipulatedBlocks,
        attackCost: cost.totalAttackCost,
        costToProfitRatio,
        naivePnlPositive,
        liquidated: liquidation.liquidated,
        liquidatedOnEntry:
          liquidation.liquidatedOnEntry,
        marginRatioAtManipulatedMark:
          liquidation.marginRatioAtManipulatedMark,
        worstMarginRatio: liquidation.worstMarginRatio,
        realizable,
        note: [
          extraction.entryError,
          extraction.exitError,
          selfFlowFeasible
            ? null
            : "self-flow exceeds capacity",
        ]
          .filter(Boolean)
          .join("; "),
      });
    }
  }

  return rows;
}


/**
 * The long the attacker is holding while the price is off,
 * opened through the production execution path so the fill
 * carries the real spread and skew.
 */
function openLongAt(targetTwap: number): Position {
  return simulateTrade(
    market(targetTwap),
    "LONG",
    ATTACKER_SIZE,
    TRADE_STEPS,
    config,
    "attacker",
    ATTACKER_MARGIN,
    new PositionManager(),
  ).position;
}

/* ============================================================
 * CAPACITY AXIS
 * ========================================================== */

/**
 * The cost sweep answers "can this attack pay for itself".
 * It does not answer "can the attacker actually put it on",
 * because a headline PnL is reported whether or not the trade
 * was accepted and whether or not the position survives.
 *
 * This sweep varies only capacity utilization, holding the
 * target TWAP fixed, and records executability separately from
 * profit. The two are independent: a large enough trade is
 * rejected outright and never produces a PnL at all, and a
 * small enough one is accepted, books a headline profit, and
 * is still liquidated before it can be closed.
 *
 * Leverage is held constant at 5x so that margin scales with
 * size and the capacity axis is not confounded by it.
 */

/**
 * Utilization points bracketing the round-trip boundary.
 *
 * A long of size S closed with a short of size S leaves 2S of
 * open interest, so the round trip stops fitting at S =
 * maxCapacity / 2. The points just below and just above 0.5
 * are included so the boundary is pinned by the data rather
 * than inferred.
 */
export const CAPACITY_UTILIZATIONS = [
  0.1, 0.2, 0.3, 0.4, 0.45, 0.49, 0.5, 0.6, 0.7, 0.8, 0.9,
  0.95, 0.99,
];

const CAPACITY_ATTACK_LEVERAGE = 5;

/** Target TWAP for the capacity sweep, fixed across sizes. */
const CAPACITY_TARGET_TWAP = 90;

export interface CapacityAttackRow {
  utilization: number;
  attackerSize: number;
  attackerMargin: number;
  entryPrice: number | null;
  exitPrice: number | null;
  headlinePnl: number | null;
  liquidatedOnEntry: boolean | null;
  realizablePnl: number | null;
  entryError?: string | undefined;
  exitError?: string | undefined;
}

export function runCapacityAttackSweep(
  utilizations: readonly number[] = CAPACITY_UTILIZATIONS,
  targetTwap: number = CAPACITY_TARGET_TWAP,
): CapacityAttackRow[] {
  return utilizations.map((utilization) => {
    const attackerSize = utilization * config.maxCapacity;
    const attackerMargin =
      attackerSize / CAPACITY_ATTACK_LEVERAGE;

    const row: CapacityAttackRow = {
      utilization,
      attackerSize,
      attackerMargin,
      entryPrice: null,
      exitPrice: null,
      headlinePnl: null,
      liquidatedOnEntry: null,
      realizablePnl: null,
    };

    const positionManager = new PositionManager();

    /*
     * Entry. Accepted trades carry the real spread and skew.
     * A rejected trade leaves every downstream field null,
     * because nothing was opened and there is no PnL to report.
     */
    let entry;
    try {
      entry = simulateTrade(
        market(targetTwap),
        "LONG",
        attackerSize,
        TRADE_STEPS,
        config,
        "attacker",
        attackerMargin,
        positionManager,
      );

      row.entryPrice = entry.averagePrice;
    } catch (error) {
      row.entryError = (error as Error).message;
      return row;
    }

    /*
     * Is the position holdable? The fill sits above the TWAP
     * that marks it, so this is decided at the manipulated
     * mark before any recovery.
     */
    row.liquidatedOnEntry = markPosition(
      entry.position,
      targetTwap,
      MAINTENANCE_MARGIN,
    ).liquidatable;

    /*
     * Exit. The honest price has recovered, and the attacker's
     * own long is still open, so closing means selling into
     * their own position. The short does not offset the long:
     * both legs remain open interest, so the round trip needs
     * twice the capacity the entry consumed.
     */
    const exitState = entry.finalState;
    exitState.ammTwapPrice = INITIAL_SPOT_PRICE;

    let exit;
    try {
      exit = simulateTrade(
        exitState,
        "SHORT",
        entry.position.size,
        TRADE_STEPS,
        config,
        "attacker",
        attackerMargin,
        positionManager,
      );

      row.exitPrice = exit.averagePrice;
    } catch (error) {
      row.exitError = (error as Error).message;
      return row;
    }

    row.headlinePnl =
      (exit.averagePrice - entry.averagePrice) *
      entry.position.size;

    /*
     * Realizable only if the attacker was never liquidated. A
     * headline profit on a position that was taken out at the
     * manipulated mark is not money the attacker ever holds.
     */
    row.realizablePnl = row.liquidatedOnEntry
      ? null
      : row.headlinePnl;

    return row;
  });
}
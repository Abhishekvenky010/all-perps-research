
/**
 * Euler-inspired TWAP manipulation cost experiment.
 *
 * IMPORTANT:
 * - All Perps gives the security requirement:
 *     cost of attack > profit from attacking the protocol.
 *
 * - The All Perps source does NOT specify the underlying
 *   liquidity/reserve formula.
 *
 * - This experiment therefore uses the constant-product
 *   mathematical model described in the supplied Euler research.
 *
 * - This is an experiment only. It does not modify production
 *   AMM or pricing code.
 */

const INITIAL_SPOT_PRICE = 100;

// Prototype liquidity assumption.
// Reserve-implied price:
//
// quoteReserve / baseReserve = 100
//
const INITIAL_BASE_RESERVE = 50_000;

const INITIAL_QUOTE_RESERVE =
  INITIAL_BASE_RESERVE *
  INITIAL_SPOT_PRICE;

const TWAP_WINDOW_BLOCKS = 72;
const MANIPULATED_BLOCKS = 72;
const TARGET_TWAP = 60;

// Measured from the real perp extraction experiment.
const PERP_EXTRACTION = 1_918_154.7619047621;

/**
 * Calculate the manipulated spot price required to produce
 * a target geometric TWAP.
 *
 * TWAP = (p^(n-m) * q^m)^(1/n)
 *
 * Rearranged:
 *
 * q = (TWAP^n / p^(n-m))^(1/m)
 */
function requiredManipulatedSpot(
  normalPrice: number,
  targetTwap: number,
  windowBlocks: number,
  manipulatedBlocks: number,
): number {
  if (
    normalPrice <= 0 ||
    targetTwap <= 0 ||
    windowBlocks <= 0 ||
    manipulatedBlocks <= 0 ||
    manipulatedBlocks > windowBlocks
  ) {
    throw new Error("Invalid TWAP parameters");
  }

  const unmanipulatedBlocks =
    windowBlocks - manipulatedBlocks;

  return Math.pow(
    Math.pow(targetTwap, windowBlocks) /
      Math.pow(
        normalPrice,
        unmanipulatedBlocks,
      ),
    1 / manipulatedBlocks,
  );
}

/**
 * Downward manipulation.
 *
 * Initial price:
 *
 *     p = quoteReserve / baseReserve
 *
 * For q < p, the attacker deposits base into the pool
 * and withdraws quote.
 *
 * Δbase =
 *
 *     sqrt(baseReserve * quoteReserve / q)
 *     - baseReserve
 */
function requiredBaseInput(
  baseReserve: number,
  quoteReserve: number,
  targetPrice: number,
): number {
  if (
    baseReserve <= 0 ||
    quoteReserve <= 0 ||
    targetPrice <= 0
  ) {
    throw new Error("Invalid AMM reserves or price");
  }

  const currentPrice =
    quoteReserve / baseReserve;

  if (targetPrice >= currentPrice) {
    throw new Error(
      "requiredBaseInput only supports downward price manipulation",
    );
  }

  return (
    Math.sqrt(
      (baseReserve * quoteReserve) /
        targetPrice,
    ) - baseReserve
  );
}

/**
 * Quote received when base is deposited.
 *
 * Constant product:
 *
 *     x * y = k
 *
 * New base reserve:
 *
 *     x + Δx
 *
 * New quote reserve:
 *
 *     k / (x + Δx)
 */
function quoteReceived(
  baseReserve: number,
  quoteReserve: number,
  baseInput: number,
): number {
  if (
    baseReserve <= 0 ||
    quoteReserve <= 0 ||
    baseInput < 0
  ) {
    throw new Error("Invalid AMM swap parameters");
  }

  const invariant =
    baseReserve * quoteReserve;

  const newQuoteReserve =
    invariant /
    (baseReserve + baseInput);

  return quoteReserve - newQuoteReserve;
}

/**
 * Euler-inspired upper-limit slippage cost per block.
 *
 * For downward manipulation:
 *
 *     c = Δbase * p - Δquote
 *
 * This expresses the attack cost in quote units.
 */
function manipulationCostPerBlock(
  baseInput: number,
  quoteOutput: number,
  normalPrice: number,
): number {
  const cost =
    baseInput * normalPrice -
    quoteOutput;

  if (cost < 0) {
    throw new Error(
      "Manipulation cost cannot be negative",
    );
  }

  return cost;
}

/**
 * Calculate the total attack cost for a particular
 * liquidity level and manipulation duration.
 */
function calculateAttackCost(
  baseReserve: number,
  targetTwap: number,
  manipulatedBlocks: number,
) {
  const quoteReserve =
    baseReserve * INITIAL_SPOT_PRICE;

  const manipulatedSpot =
    requiredManipulatedSpot(
      INITIAL_SPOT_PRICE,
      targetTwap,
      TWAP_WINDOW_BLOCKS,
      manipulatedBlocks,
    );

  const baseInput =
    requiredBaseInput(
      baseReserve,
      quoteReserve,
      manipulatedSpot,
    );

  const quoteOutput =
    quoteReceived(
      baseReserve,
      quoteReserve,
      baseInput,
    );

  const costPerBlock =
    manipulationCostPerBlock(
      baseInput,
      quoteOutput,
      INITIAL_SPOT_PRICE,
    );

  const totalAttackCost =
    costPerBlock * manipulatedBlocks;

  return {
    quoteReserve,
    manipulatedSpot,
    baseInput,
    quoteOutput,
    costPerBlock,
    totalAttackCost,
  };
}

/* ============================================================
 * BASE CASE
 * ========================================================== */

const baseCase = calculateAttackCost(
  INITIAL_BASE_RESERVE,
  TARGET_TWAP,
  MANIPULATED_BLOCKS,
);

console.log("=== TWAP ATTACK COST ===");

console.log({
  normalSpotPrice: INITIAL_SPOT_PRICE,
  targetTwap: TARGET_TWAP,
  twapWindowBlocks: TWAP_WINDOW_BLOCKS,
  manipulatedBlocks: MANIPULATED_BLOCKS,
  manipulatedSpot: baseCase.manipulatedSpot,
});

console.log("\n=== MANIPULATION SWAP ===");

console.log({
  initialBaseReserve:
    INITIAL_BASE_RESERVE,

  initialQuoteReserve:
    INITIAL_QUOTE_RESERVE,

  baseInput:
    baseCase.baseInput,

  quoteOutput:
    baseCase.quoteOutput,

  costPerBlock:
    baseCase.costPerBlock,
});

console.log("\n=== ATTACK COST ===");

console.log({
  totalAttackCost:
    baseCase.totalAttackCost,

  perpExtraction:
    PERP_EXTRACTION,

  attackCostMinusExtraction:
    baseCase.totalAttackCost -
    PERP_EXTRACTION,

  attackCostGreaterThanExtraction:
    baseCase.totalAttackCost >
    PERP_EXTRACTION,

  extractionToAttackCostRatio:
    PERP_EXTRACTION /
    baseCase.totalAttackCost,
});

/* ============================================================
 * MANIPULATION DURATION SWEEP
 * ========================================================== */

console.log(
  "\n=== MANIPULATION DURATION SWEEP ===",
);

const manipulationDurations = [
  1,
  5,
  10,
  20,
  36,
  72,
];

const durationSweep =
  manipulationDurations.map(
    (manipulatedBlocks) => {
      const result =
        calculateAttackCost(
          INITIAL_BASE_RESERVE,
          TARGET_TWAP,
          manipulatedBlocks,
        );

      return {
        manipulatedBlocks,
        manipulatedSpot:
          result.manipulatedSpot,
        costPerBlock:
          result.costPerBlock,
        totalAttackCost:
          result.totalAttackCost,
        perpExtraction:
          PERP_EXTRACTION,
        costExceedsExtraction:
          result.totalAttackCost >
          PERP_EXTRACTION,
      };
    },
  );

console.table(durationSweep);

/* ============================================================
 * LIQUIDITY SECURITY SWEEP
 * ========================================================== */

console.log(
  "\n=== LIQUIDITY SECURITY SWEEP ===",
);

const liquidityLevels = [
  5_000,
  10_000,
  25_000,
  50_000,
  100_000,
];

const liquiditySweep =
  liquidityLevels.map(
    (baseReserve) => {
      const result =
        calculateAttackCost(
          baseReserve,
          TARGET_TWAP,
          TWAP_WINDOW_BLOCKS,
        );

      return {
        baseReserve,
        quoteReserve:
          result.quoteReserve,
        manipulatedSpot:
          result.manipulatedSpot,
        costPerBlock:
          result.costPerBlock,
        totalAttackCost:
          result.totalAttackCost,
        perpExtraction:
          PERP_EXTRACTION,
        costExceedsExtraction:
          result.totalAttackCost >
          PERP_EXTRACTION,
        costToExtractionRatio:
          result.totalAttackCost /
          PERP_EXTRACTION,
      };
    },
  );

console.table(liquiditySweep);

/* ============================================================
 * BREAK-EVEN LIQUIDITY
 * ========================================================== */

console.log(
  "\n=== BREAK-EVEN LIQUIDITY ===",
);

/*
 * We calculate the attack cost using ONE unit
 * of base liquidity.
 *
 * Because the constant-product model scales linearly
 * with reserve size, this gives us the attack cost
 * per unit of base liquidity.
 */

const normalizedBaseReserve = 1;

const normalizedResult =
  calculateAttackCost(
    normalizedBaseReserve,
    TARGET_TWAP,
    TWAP_WINDOW_BLOCKS,
  );

const normalizedTotalAttackCost =
  normalizedResult.totalAttackCost;

/*
 * SECURITY INEQUALITY
 *
 * We want:
 *
 *     attackCost >= perpExtraction
 *
 * Attack cost scales linearly with liquidity:
 *
 *     liquidity *
 *     normalizedTotalAttackCost
 *     >=
 *     PERP_EXTRACTION
 *
 * Therefore:
 *
 *     liquidity
 *     >=
 *     PERP_EXTRACTION /
 *     normalizedTotalAttackCost
 *
 * The RHS is the break-even liquidity.
 */

const breakEvenBaseReserve =
  PERP_EXTRACTION /
  normalizedTotalAttackCost;

const breakEvenQuoteReserve =
  breakEvenBaseReserve *
  INITIAL_SPOT_PRICE;

const attackCostAtBreakEvenLiquidity =
  breakEvenBaseReserve *
  normalizedTotalAttackCost;

console.log({
  targetTwap: TARGET_TWAP,

  manipulatedBlocks:
    TWAP_WINDOW_BLOCKS,

  manipulatedSpot:
    normalizedResult.manipulatedSpot,

  normalizedTotalAttackCost,

  perpExtraction:
    PERP_EXTRACTION,

  breakEvenBaseReserve,

  breakEvenQuoteReserve,

  attackCostAtBreakEvenLiquidity,

  securityCondition:
    "attack cost >= perp extraction",

  securityDirection:
    "liquidity >= break-even liquidity",

  securityConditionAtBreakEven:
    attackCostAtBreakEvenLiquidity >=
    PERP_EXTRACTION,
});

/* ============================================================
 * TWAP TARGET BREAK-EVEN SWEEP
 * ========================================================== */

console.log(
  "\n=== TWAP TARGET BREAK-EVEN SWEEP ===",
);

const targetTwapLevels = [
  90,
  80,
  70,
  60,
  50,
  40,
];

const targetTwapSweep =
  targetTwapLevels.map(
    (targetTwap) => {
      const manipulatedBlocks =
        TWAP_WINDOW_BLOCKS;

      /*
       * Calculate the spot price required to
       * produce the target TWAP.
       */
      const manipulatedSpot =
        requiredManipulatedSpot(
          INITIAL_SPOT_PRICE,
          targetTwap,
          TWAP_WINDOW_BLOCKS,
          manipulatedBlocks,
        );

      /*
       * Normalize liquidity to one base unit.
       */
      const normalizedBaseReserve = 1;

      const normalizedQuoteReserve =
        normalizedBaseReserve *
        INITIAL_SPOT_PRICE;

      const baseInput =
        requiredBaseInput(
          normalizedBaseReserve,
          normalizedQuoteReserve,
          manipulatedSpot,
        );

      const quoteOutput =
        quoteReceived(
          normalizedBaseReserve,
          normalizedQuoteReserve,
          baseInput,
        );

      const costPerBlock =
        manipulationCostPerBlock(
          baseInput,
          quoteOutput,
          INITIAL_SPOT_PRICE,
        );

      const normalizedTotalAttackCost =
        costPerBlock *
        manipulatedBlocks;

      /*
       * Explicit security inequality:
       *
       *     attackCost >= perpExtraction
       *
       * Therefore:
       *
       *     liquidity >=
       *     perpExtraction /
       *     normalizedAttackCost
       */

      const breakEvenBaseReserve =
        PERP_EXTRACTION /
        normalizedTotalAttackCost;

      const breakEvenQuoteReserve =
        breakEvenBaseReserve *
        INITIAL_SPOT_PRICE;

      return {
        targetTwap,
        manipulatedBlocks,
        manipulatedSpot,

        normalizedTotalAttackCost,

        perpExtraction:
          PERP_EXTRACTION,

        breakEvenBaseReserve,

        breakEvenQuoteReserve,

        securityDirection:
          "liquidity >= break-even liquidity",
      };
    },
  );

console.table(targetTwapSweep);


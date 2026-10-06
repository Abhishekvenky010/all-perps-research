/**
 * Constant-product spot-manipulation cost proxy used by the current economic
 * scenario. This is a repeated one-way slippage score, not minimum net attack
 * cost or a model of pool reserves evolving during the hold.
 */
export const INITIAL_SPOT_PRICE = 100;
export const BLOCK_SECONDS = 15;
export const BASE_LIQUIDITY = 50_000;

function costToMovePrice(baseInput: number): number {
  const baseReserve = BASE_LIQUIDITY;
  const quoteReserve = BASE_LIQUIDITY * INITIAL_SPOT_PRICE;
  const newBase = baseReserve + baseInput;
  const newQuote = (baseReserve * quoteReserve) / newBase;
  const quoteOutput = quoteReserve - newQuote;
  return Math.max(
    baseInput * INITIAL_SPOT_PRICE - quoteOutput,
    0,
  );
}

function baseInputToReach(target: number): number {
  if (target >= INITIAL_SPOT_PRICE) {
    throw new Error("Downward leg requires target < spot");
  }

  const baseReserve = BASE_LIQUIDITY;
  const quoteReserve = BASE_LIQUIDITY * INITIAL_SPOT_PRICE;
  return Math.sqrt(
    (baseReserve * quoteReserve) / target,
  ) - baseReserve;
}

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
  );
  const manipulatedBlocks = duration / BLOCK_SECONDS;

  return {
    costPerBlock,
    manipulatedBlocks,
    totalAttackCost: costPerBlock * manipulatedBlocks,
  };
}

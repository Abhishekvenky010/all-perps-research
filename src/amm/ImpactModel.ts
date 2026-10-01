export function getSkewImpact(
  skewRatio: number,
  coefficient: number,
): number {
  return coefficient * skewRatio;
}

export function getCapacityImpact(
  usage: number,
  coefficient: number,
): number {

  if (usage >= 1) {
    throw new Error("CAPACITY_REACHED");
  }

  return coefficient * (usage / (1 - usage));
}


/**
 * The skew-adjusted fair value of the market.
 *
 * Skew moves the fair value itself: a long-crowded book is
 * worth more, a short-crowded book less. This is a single
 * signed price, not a per-side penalty.
 */
export function getFairValue(
  basePrice: number,
  skewRatio: number,
  skewCoefficient: number,
): number {

  const skewImpact = getSkewImpact(
    skewRatio,
    skewCoefficient,
  );

  return basePrice * (1 + skewImpact);
}


/**
 * Execution price as a symmetric spread around the fair value.
 *
 * The two mechanisms are kept separate because they answer
 * different questions:
 *
 *   skew     -> what is the perp worth?      (moves the centre)
 *   capacity -> how expensive is it to trade? (widens the spread)
 *
 * Capacity impact is unsigned, so it cannot be added to skew
 * impact: that would always push LONG up and SHORT down,
 * making it a permanent tax on longs and a subsidy to shorts,
 * large enough in a crowded book to invert the intended
 * behaviour. Applied symmetrically it simply widens the
 * spread in both directions, which is what "the market is
 * full" should mean.
 */
export function getExecutionPriceFromImpact(
  basePrice: number,
  skewRatio: number,
  skewCoefficient: number,
  usage: number,
  capacityCoefficient: number,
  side: "LONG" | "SHORT",
): number {

  const fairValue = getFairValue(
    basePrice,
    skewRatio,
    skewCoefficient,
  );

  const capacityImpact = getCapacityImpact(
    usage,
    capacityCoefficient,
  );

  return side === "LONG"
    ? fairValue * (1 + capacityImpact)
    : fairValue * (1 - capacityImpact);
}


/**
 * Experimental bounded capacity-impact model.
 * Impact increases linearly from 0% to a maximum of 10%.
 */
export function getBoundedCapacityImpact(
  usage: number,
  maxImpact: number = 0.10,
): number {
  if (!Number.isFinite(usage) || usage < 0 || usage > 1) {
    throw new Error("Capacity usage must be between 0 and 1");
  }

  if (!Number.isFinite(maxImpact) || maxImpact < 0 || maxImpact > 1) {
    throw new Error("Maximum impact must be between 0 and 1");
  }

  return maxImpact * usage;
}
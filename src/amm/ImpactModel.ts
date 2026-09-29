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
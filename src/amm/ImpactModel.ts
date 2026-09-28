export function getSkewImpact(
  skewRatio: number,
  coefficient: number,
): number {
  return coefficient * Math.abs(skewRatio);
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
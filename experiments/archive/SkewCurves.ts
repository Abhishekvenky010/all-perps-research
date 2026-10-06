export function linearSkewImpact(
  skewRatio: number,
  coefficient: number,
): number {
  return coefficient * skewRatio;
}

export function quadraticSkewImpact(
  skewRatio: number,
  coefficient: number,
): number {
  return coefficient * skewRatio * skewRatio;
}

export function cubicSkewImpact(
  skewRatio: number,
  coefficient: number,
): number {
  return (
    coefficient *
    skewRatio *
    skewRatio *
    skewRatio
  );
}
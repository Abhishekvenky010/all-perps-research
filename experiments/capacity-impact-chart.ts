const capacityCoefficient = 0.05;
const maxImpact = 0.10;

const maxUtilization = 0.99;
const chartHeight = 20;
const chartWidth = 50;

function originalImpact(usage: number): number {
  return capacityCoefficient * (usage / (1 - usage));
}

function boundedImpact(usage: number): number {
  return maxImpact * usage;
}

const maxValue = originalImpact(maxUtilization);

console.log("\n=== Capacity Impact Curve Comparison ===\n");
console.log("O = Original curve | B = Bounded curve\n");

for (let row = chartHeight; row >= 0; row--) {
  const level = (row / chartHeight) * maxValue;

  let line = "";

  for (let col = 0; col <= chartWidth; col++) {
    const usage = (col / chartWidth) * maxUtilization;

    const original = originalImpact(usage);
    const bounded = boundedImpact(usage);

    const originalRow = Math.round(
      (original / maxValue) * chartHeight,
    );

    const boundedRow = Math.round(
      (bounded / maxValue) * chartHeight,
    );

    if (
      originalRow === row &&
      boundedRow === row
    ) {
      line += "X";
    } else if (originalRow === row) {
      line += "O";
    } else if (boundedRow === row) {
      line += "B";
    } else {
      line += " ";
    }
  }

  console.log(
    `${(level * 100).toFixed(0).padStart(5)}% |${line}`,
  );
}

console.log(
  "      +" + "-".repeat(chartWidth + 1),
);
console.log("       0%                 50%               99%");
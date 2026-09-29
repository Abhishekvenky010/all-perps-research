import {
  getCapacityImpact,
  getBoundedCapacityImpact,
} from "../src/amm/ImpactModel.js";

const utilizationLevels = [
  0.2, 0.4, 0.6, 0.8, 0.9, 0.95, 0.99,
];

const capacityCoefficient = 0.05;
const maxImpact = 0.10;

console.log("\n=== Capacity Impact Comparison ===\n");

console.log(
  "Utilization | Original Impact | Bounded Impact",
);
console.log(
  "------------|-----------------|---------------",
);

for (const usage of utilizationLevels) {
  const original = getCapacityImpact(
    usage,
    capacityCoefficient,
  );

  const bounded = getBoundedCapacityImpact(
    usage,
    maxImpact,
  );

  console.log(
    `${(usage * 100).toFixed(0).padStart(3)}%        | ` +
      `${(original * 100).toFixed(2).padStart(7)}%         | ` +
      `${(bounded * 100).toFixed(2).padStart(7)}%`,
  );
}
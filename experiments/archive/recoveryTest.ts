
import { getExecutionPrice } from "../../src/amm/Pricing.js";
import fs from "fs";
import assert from "node:assert/strict";

const config = {
  symbol: "BTC-PERP",
  maxCapacity: 120000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0,
  maxLeverage: 10,
};

function runScenario(
  scenario: string,
  longOI: number,
  shortOI: number,
  side: "LONG" | "SHORT",
) {
  const state = {
    symbol: "BTC-PERP",
    indexPrice: 100,
    ammTwapPrice: 100,
    longOpenInterest: longOI,
    shortOpenInterest: shortOI,
  };

  const initialSkew =
    state.longOpenInterest - state.shortOpenInterest;

  const initialAbsSkew = Math.abs(initialSkew);
  const results = [];

  let previousPrice = Infinity;

  console.log(`\n${scenario}`);
  console.log("INITIAL STATE", { ...state });

  for (let i = 0; i < 6; i++) {
    const size = 10000;

    const skewBefore =
      state.longOpenInterest - state.shortOpenInterest;

    const price = getExecutionPrice(state, config, side);

    // Apply the trade
    if (side === "LONG") {
      state.longOpenInterest += size;
    } else {
      state.shortOpenInterest += size;
    }

    const skewAfter =
      state.longOpenInterest - state.shortOpenInterest;

    // Assert recovery during the first five trades
    if (i < 5) {
      assert.ok(
        Math.abs(skewAfter) < Math.abs(skewBefore),
        `${scenario}: skew should move toward zero`,
      );
    }

    // Assert that the sixth trade crosses zero
    if (i === 5) {
      assert.ok(
        skewBefore === 0 ||
          Math.sign(skewAfter) !== Math.sign(skewBefore),
        `${scenario}: sixth trade should cross zero skew`,
      );
    }

    /*
      Skew sets the fair value, so a recovery trade should pull
      the price back toward the index: falling when the book is
      long-heavy (fair value above the index) and rising when
      it is short-heavy (fair value below).
    */
    if (i > 0 && i < 5) {
      /*
        Compare against the sign of the skew the price was
        quoted on, not the post-trade skew, which has already
        moved and may have crossed zero.
      */
      const movingTowardIndex =
        skewBefore > 0
          ? price <= previousPrice
          : price >= previousPrice;

      assert.ok(
        movingTowardIndex,
        `${scenario}: recovery-side price should move toward the index`,
      );
    }

    const data = {
      side,
      size,
      longOI: state.longOpenInterest,
      shortOI: state.shortOpenInterest,
      executionPrice: Number(price.toFixed(2)),
      skewBefore,
      skewAfter,
    };

    results.push(data);
    console.log(data);

    previousPrice = price;
  }

  const finalSkew =
    state.longOpenInterest - state.shortOpenInterest;

  assert.ok(
    Math.abs(finalSkew) <= initialAbsSkew,
    `${scenario}: final absolute skew should not exceed initial skew`,
  );

  console.log("PASS:", scenario);

  return results;
}

const results = [
  ...runScenario(
    "LONG-HEAVY → SHORT RECOVERY",
    50000,
    0,
    "SHORT",
  ),
  ...runScenario(
    "SHORT-HEAVY → LONG RECOVERY",
    0,
    50000,
    "LONG",
  ),
];

fs.mkdirSync("results", { recursive: true });

fs.writeFileSync(
  "results/recovery.json",
  JSON.stringify(results, null, 2),
);

console.log("\nAll recovery assertions passed.");
console.log("Recovery results saved.");
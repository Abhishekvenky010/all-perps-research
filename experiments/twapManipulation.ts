/**
 * TWAP manipulation resistance.
 *
 * Models a 900-second (15-minute) window in which the spot price
 * is manipulated from a baseline of 100 up to 1000 (10x) for a
 * fixed duration, then returns to baseline.
 *
 * The closed form being tested is:
 *
 *   TWAP = (baselinePrice * normalDuration
 *           + manipulatedPrice * manipulationDuration)
 *          / window
 *
 * The interesting property is that a 10x spot manipulation moves
 * the TWAP by only (manipulationDuration / window) * 900%, so a
 * short manipulation is heavily damped and the attacker has to
 * hold the manipulation for a large fraction of the window.
 *
 * This experiment is deliberately isolated: it does not touch
 * the AMM, positions, or capacity. It only characterizes the
 * oracle, then cross-checks the closed form against the real
 * calculateTWAP implementation.
 */
import assert from "node:assert/strict";
import fs from "fs";

import {
  recordPriceObservation,
  calculateTWAP,
  type PriceObservation,
} from "../src/oracle/TWAPOracle.js";


const WINDOW = 900;

const BASELINE_PRICE = 100;

const MANIPULATED_PRICE = 1000;

const MANIPULATION_DURATIONS = [
  0.4, 10, 60, 300, 900,
];


/**
 * Closed form: the window is part baseline, part manipulated.
 */
function closedFormTwap(
  manipulationDuration: number,
  window: number = WINDOW,
): number {

  const normalDuration =
    window - manipulationDuration;

  return (
    BASELINE_PRICE * normalDuration +
    MANIPULATED_PRICE * manipulationDuration
  ) / window;
}


/**
 * Same scenario fed through the production oracle.
 *
 * Observations are placed at the start of the window, so the
 * manipulated segment is bracketed by baseline observations on
 * both sides:
 *
 *   t = 0        price = manipulated
 *   t = d        price = baseline
 *   t = window   price = baseline  (at `now`, ignored by TWAP)
 *
 * calculateTWAP weights each observation by the interval it
 * covers, which reproduces the closed form exactly.
 */
function oracleTwap(
  manipulationDuration: number,
  window: number = WINDOW,
): number {

  let observations: PriceObservation[] = [];

  observations = recordPriceObservation(
    observations,
    { timestamp: 0, price: MANIPULATED_PRICE },
  );

  observations = recordPriceObservation(
    observations,
    {
      timestamp: manipulationDuration,
      price: BASELINE_PRICE,
    },
  );

  observations = recordPriceObservation(
    observations,
    {
      timestamp: window,
      price: BASELINE_PRICE,
    },
  );

  const twap = calculateTWAP(
    observations,
    window,
  );

  assert.ok(
    twap !== null,
    "oracle returned no TWAP: insufficient history",
  );

  return twap;
}


function displacement(twap: number): number {
  return ((twap - BASELINE_PRICE) / BASELINE_PRICE) * 100;
}


/**
 * Manipulation duration required to move the TWAP by a target
 * percentage. Inverts the closed form:
 *
 *   twap = base + d * (manip - base) / window
 */
function durationForDisplacement(
  targetPercent: number,
  window: number = WINDOW,
): number {

  const targetTwap =
    BASELINE_PRICE * (1 + targetPercent / 100);

  return (
    (targetTwap - BASELINE_PRICE) *
    window /
    (MANIPULATED_PRICE - BASELINE_PRICE)
  );
}


console.log("TWAP manipulation resistance");
console.log(
  `window=${WINDOW}s  baseline=${BASELINE_PRICE}  ` +
  `manipulated=${MANIPULATED_PRICE} (10x spot move)`,
);

console.log(
  "\nspot displacement is +900% in every case below",
);


const header =
  "duration".padEnd(10) +
  "baseline_s".padStart(12) +
  "twap".padStart(12) +
  "displacement".padStart(14) +
  "oracle_twap".padStart(14);

console.log("\n" + header);
console.log("-".repeat(header.length));

const rows = [];

for (const duration of MANIPULATION_DURATIONS) {

  const twap = closedFormTwap(duration);

  const fromOracle = oracleTwap(duration);

  /*
    The whole point of the exercise: verify that the production
    oracle agrees with the closed form, so the damping observed
    here is a property of the engine and not of this script.
  */
  assert.ok(
    Math.abs(twap - fromOracle) < 1e-9,
    `oracle disagrees with closed form for ` +
    `${duration}s: ${fromOracle} vs ${twap}`,
  );

  const percent = displacement(twap);

  console.log(
    `${duration}s`.padEnd(10) +
    `${WINDOW - duration}`.padStart(12) +
    twap.toFixed(4).padStart(12) +
    `${percent.toFixed(4)}%`.padStart(14) +
    fromOracle.toFixed(4).padStart(14),
  );

  rows.push({
    manipulationDuration: duration,
    normalDuration: WINDOW - duration,
    twap: Number(twap.toFixed(6)),
    oracleTwap: Number(fromOracle.toFixed(6)),
    displacementPercent: Number(percent.toFixed(6)),
  });
}


console.log(
  "\nClosed form matches the production oracle for every case.",
);


console.log(
  "\nHow long must the attacker hold the manipulation?",
);

const thresholds = [1, 5, 10, 25, 50, 90];

for (const target of thresholds) {

  const needed = durationForDisplacement(target);

  console.log(
    `  TWAP +${String(target).padStart(2)}%  ` +
    `requires holding for ${needed.toFixed(1)}s ` +
    `of the ${WINDOW}s window ` +
    `(${((needed / WINDOW) * 100).toFixed(1)}% of the window)`,
  );
}

rows.push({
  thresholdTable: thresholds.map(
    target => ({
      targetDisplacementPercent: target,
      requiredDuration: Number(
        durationForDisplacement(target).toFixed(4),
      ),
      windowSharePercent: Number(
        (
          (durationForDisplacement(target) / WINDOW) *
          100
        ).toFixed(4),
      ),
    }),
  ),
});


/*
  Sanity checks on the two worked examples from the brief.
*/
assert.equal(
  closedFormTwap(0.4),
  100.4,
  "0.4s manipulation should move the TWAP to 100.4",
);

assert.equal(
  closedFormTwap(300),
  400,
  "300s manipulation should move the TWAP to 400",
);

assert.ok(
  displacement(closedFormTwap(0.4)) < 1,
  "0.4s manipulation should displace the TWAP by under 1%",
);


fs.mkdirSync("results", { recursive: true });

fs.writeFileSync(
  "results/twap-manipulation.json",
  JSON.stringify(
    {
      window: WINDOW,
      baselinePrice: BASELINE_PRICE,
      manipulatedPrice: MANIPULATED_PRICE,
      cases: rows,
    },
    null,
    2,
  ),
);

console.log(
  "\nWorked examples verified. Saved to results/twap-manipulation.json",
);
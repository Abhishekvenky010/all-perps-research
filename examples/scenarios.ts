import { simulateTrade } from "../src/simulation/TradeSimulator.js";


const config = {
  symbol: "BTC-PERP",
  maxCapacity: 100000,
  skewCoefficient: 0.2,
  capacityCoefficient: 0.05,
};


function runScenario(
  name: string,
  state: any,
  side: "LONG" | "SHORT",
  size: number,
) {

  console.log("\n====================");
  console.log(name);
  console.log("====================");


  try {

    const result = simulateTrade(
      state,
      side,
      size,
      10,
      config,
    );


    console.log(
      "Average execution price:",
      result.averagePrice,
    );


    console.log(
      "Price movement:",
      result.priceHistory,
    );


    console.log(
      "Final state:",
      result.finalState,
    );


  } catch(error) {

    console.log(
      "Trade rejected:",
      (error as Error).message,
    );

  }

}


// Scenario 1

runScenario(
  "Healthy Market",
  {
    symbol:"BTC-PERP",
    indexPrice:100,
    longOpenInterest:20000,
    shortOpenInterest:20000,
  },
  "LONG",
  5000,
);


// Scenario 2

runScenario(
  "Long Crowded Market",
  {
    symbol:"BTC-PERP",
    indexPrice:100,
    longOpenInterest:60000,
    shortOpenInterest:20000,
  },
  "LONG",
  10000,
);


// Scenario 3

runScenario(
  "Capacity Stress",
  {
    symbol:"BTC-PERP",
    indexPrice:100,
    longOpenInterest:90000,
    shortOpenInterest:5000,
  },
  "LONG",
  10000,
);
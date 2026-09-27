import { describe, it, expect } from "vitest";

import {
  isLiquidatable,
} from "../src/risk/Liquidation.js";


describe("Liquidation Engine", () => {


  const position = {

    id:"1",

    trader:"Alice",

    market:"BTC-PERP",

    side:"LONG" as const,

    size:10000,

    entryPrice:100,

    margin:1000,

  };


  it("keeps healthy position alive", () => {


    const result =
      isLiquidatable(
        position,
        -200,
        0.05,
      );


    expect(result)
      .toBe(false);

  });



  it("liquidates risky position", () => {


    const result =
      isLiquidatable(
        position,
        -600,
        0.05,
      );


    expect(result)
      .toBe(true);

  });



  it("liquidates when equity becomes negative", () => {


    const result =
      isLiquidatable(
        position,
        -1200,
        0.05,
      );


    expect(result)
      .toBe(true);

  });


});
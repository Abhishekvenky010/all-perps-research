import { describe, expect, it } from "vitest";
import {
  simulateImplementedEconomicScenario,
} from "../experiments/implementedEconomicSecurity.js";

describe("implemented economic-security scenarios", () => {
  it("liquidates the historical TWAP95 position before it can realize extraction", () => {
    const result = simulateImplementedEconomicScenario({
      targetTwap: 95,
      duration: 900,
      utilization: 0.3,
      vaultDeposit: 50_000,
    });

    expect(result.actualTwap).toBeCloseTo(95, 10);
    expect(result.grossSettlementPnl).toBeLessThan(0);
    expect(result.status).toBe("OPENED BUT LIQUIDATED");
    expect(result.liquidationOutcome).toBe("LIQUIDATED");
    expect(result.realizedTraderPnl).toBeLessThan(0);
    expect(result.realizedExtraction).toBe(0);
  });

  it("does not realize the historical profit even with ample vault backing", () => {
    const result = simulateImplementedEconomicScenario({
      targetTwap: 95,
      duration: 900,
      utilization: 0.1,
      vaultDeposit: 1_000_000,
    });

    expect(result.status).toBe("OPENED BUT LIQUIDATED");
    expect(result.liquidationOutcome).toBe("LIQUIDATED");
    expect(result.realizedExtraction).toBe(0);
    expect(result.costToExtractionRatio).toBeNull();
  });

  it("prevents historical extraction at both tested capacity utilizations", () => {
    const low = simulateImplementedEconomicScenario({
      targetTwap: 95,
      duration: 900,
      utilization: 0.1,
      vaultDeposit: 10_000_000,
    });
    const high = simulateImplementedEconomicScenario({
      targetTwap: 95,
      duration: 900,
      utilization: 0.5,
      vaultDeposit: 10_000_000,
    });

    expect(low.status).toBe("OPENED BUT LIQUIDATED");
    expect(high.status).toBe("OPENED BUT LIQUIDATED");
    expect(low.realizedExtraction).toBe(0);
    expect(high.realizedExtraction).toBe(0);
    expect(low.realizedTraderPnl).toBeLessThan(0);
    expect(high.realizedTraderPnl).toBeLessThan(0);
  });

  it("prevents historical extraction under larger configured capacities", () => {
    const halfCapacity = simulateImplementedEconomicScenario({
      targetTwap: 95,
      duration: 900,
      utilization: 0.3,
      capacity: 50_000,
      vaultDeposit: 10_000_000,
    });
    const doubleCapacity = simulateImplementedEconomicScenario({
      targetTwap: 95,
      duration: 900,
      utilization: 0.3,
      capacity: 200_000,
      vaultDeposit: 10_000_000,
    });

    expect(halfCapacity.status).toBe("OPENED BUT LIQUIDATED");
    expect(doubleCapacity.status).toBe("OPENED BUT LIQUIDATED");
    expect(halfCapacity.realizedExtraction).toBe(0);
    expect(doubleCapacity.realizedExtraction).toBe(0);
  });

  it("runs high-capacity adverse positions through production liquidation", () => {
    const result = simulateImplementedEconomicScenario({
      targetTwap: 95,
      duration: 900,
      utilization: 0.1,
      vaultDeposit: 1_000_000,
      side: "SHORT",
      leverage: 10,
    });

    expect(result.status).toBe("OPENED BUT LIQUIDATED");
    expect(result.liquidationOutcome).toBe("LIQUIDATED");
    expect(result.grossSettlementPnl).toBeDefined();
    expect(result.realizedTraderPnl).toBeLessThan(0);
    expect(result.realizedExtraction).toBe(0);
  });

  it("rejects TWAP targets that require a non-positive reference price", () => {
    const result = simulateImplementedEconomicScenario({
      targetTwap: 80,
      duration: 15,
      utilization: 0.1,
    });

    expect(result.status).toBe("REJECTED BEFORE POSITION");
    expect(result.failure).toBe("UNREACHABLE_TARGET_TWAP");
    expect(result.realizedTraderPnl).toBe(0);
  });
});

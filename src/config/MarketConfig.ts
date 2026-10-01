export interface MarketConfig {

  symbol: string;

  maxCapacity: number;

  skewCoefficient: number;

  capacityCoefficient: number;

  maxLeverage: number;

  // Optional: defaults to 0.05 when omitted.
  maintenanceMargin?: number;

}
export interface LiquidityVault {
  totalDeposited: number;
  availableCapital: number;
  traderPnL: number;
  premiums: number;
}

export function createLiquidityVault(
  initialDeposit = 0,
): LiquidityVault {
  if (initialDeposit < 0) {
    throw new Error("INVALID_INITIAL_DEPOSIT");
  }

  return {
    totalDeposited: initialDeposit,
    availableCapital: initialDeposit,
    traderPnL: 0,
    premiums: 0,
  };
}

export function depositLP(
  vault: LiquidityVault,
  amount: number,
): void {
  if (amount <= 0) {
    throw new Error("INVALID_DEPOSIT");
  }

  vault.totalDeposited += amount;
  vault.availableCapital += amount;
}

export function recordTraderPnL(
  vault: LiquidityVault,
  pnl: number,
): void {
  if (!Number.isFinite(pnl)) {
    throw new Error("INVALID_TRADER_PNL");
  }

  vault.traderPnL += pnl;

  // Positive trader PnL consumes vault capital.
  // Negative trader PnL adds to vault capital.
  vault.availableCapital -= pnl;
}

export function addPremium(
  vault: LiquidityVault,
  premium: number,
): void {
  if (premium < 0) {
    throw new Error("INVALID_PREMIUM");
  }

  vault.premiums += premium;
  vault.availableCapital += premium;
}

export function getLpEquity(
  vault: LiquidityVault,
): number {
  return (
    vault.totalDeposited -
    vault.traderPnL +
    vault.premiums
  );
}
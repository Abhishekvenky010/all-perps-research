export interface LiquidityVault {
  totalDeposited: number;
  availableCapital: number;
  traderPnL: number;
  premiums: number;
}

function assertWritableVaultField(
  vault: LiquidityVault,
  field: keyof LiquidityVault,
): void {
  const descriptor = Object.getOwnPropertyDescriptor(vault, field);
  if (!descriptor || !("value" in descriptor) || !descriptor.writable) {
    throw new Error("VAULT_STATE_NOT_MUTABLE");
  }
}

export interface PreparedTraderPnL {
  previousTraderPnL: number;
  previousAvailableCapital: number;
  traderPnL: number;
  availableCapital: number;
}

export function createLiquidityVault(
  initialDeposit = 0,
): LiquidityVault {
  if (!Number.isFinite(initialDeposit) || initialDeposit < 0) {
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
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error("INVALID_DEPOSIT");
  }

  const totalDeposited = vault.totalDeposited + amount;
  const availableCapital = vault.availableCapital + amount;
  if (!Number.isFinite(totalDeposited) || !Number.isFinite(availableCapital)) {
    throw new Error("INVALID_DEPOSIT");
  }

  assertWritableVaultField(vault, "totalDeposited");
  assertWritableVaultField(vault, "availableCapital");
  vault.totalDeposited = totalDeposited;
  vault.availableCapital = availableCapital;
}

export function recordTraderPnL(
  vault: LiquidityVault,
  pnl: number,
): void {
  const prepared = prepareTraderPnL(vault, pnl);
  commitTraderPnL(vault, prepared);
}

export function prepareTraderPnL(
  vault: LiquidityVault,
  pnl: number,
): PreparedTraderPnL {
  if (!Number.isFinite(pnl)) {
    throw new Error("INVALID_TRADER_PNL");
  }

  const traderPnL = vault.traderPnL + pnl;
  const availableCapital = vault.availableCapital - pnl;
  assertSolventPreparedPnL({ traderPnL, availableCapital });

  assertWritableVaultField(vault, "traderPnL");
  assertWritableVaultField(vault, "availableCapital");

  return {
    previousTraderPnL: vault.traderPnL,
    previousAvailableCapital: vault.availableCapital,
    traderPnL,
    availableCapital,
  };
}

export function commitTraderPnL(
  vault: LiquidityVault,
  prepared: PreparedTraderPnL,
): void {
  assertSolventPreparedPnL(prepared);
  assertWritableVaultField(vault, "traderPnL");
  assertWritableVaultField(vault, "availableCapital");
  if (
    vault.traderPnL !== prepared.previousTraderPnL ||
    vault.availableCapital !== prepared.previousAvailableCapital
  ) {
    throw new Error("VAULT_STATE_CHANGED");
  }
  vault.traderPnL = prepared.traderPnL;
  vault.availableCapital = prepared.availableCapital;
}

export function assertSolventPreparedPnL(
  prepared: Pick<PreparedTraderPnL, "traderPnL" | "availableCapital">,
): void {
  if (
    !Number.isFinite(prepared.traderPnL) ||
    !Number.isFinite(prepared.availableCapital)
  ) {
    throw new Error("INVALID_TRADER_PNL");
  }

  if (prepared.availableCapital < 0) {
    throw new Error("INSUFFICIENT_LP_BACKING");
  }
}

export function assertLpBackingCovers(
  vault: LiquidityVault,
  claim: number,
): void {
  if (
    !Number.isFinite(vault.availableCapital) ||
    vault.availableCapital < 0 ||
    !Number.isFinite(claim) ||
    claim < 0
  ) {
    throw new Error("INVALID_LP_CLAIM");
  }

  if (claim > vault.availableCapital) {
    throw new Error("INSUFFICIENT_LP_BACKING");
  }
}

export function addPremium(
  vault: LiquidityVault,
  premium: number,
): void {
  if (!Number.isFinite(premium) || premium < 0) {
    throw new Error("INVALID_PREMIUM");
  }

  const premiums = vault.premiums + premium;
  const availableCapital = vault.availableCapital + premium;
  if (!Number.isFinite(premiums) || !Number.isFinite(availableCapital)) {
    throw new Error("INVALID_PREMIUM");
  }

  assertWritableVaultField(vault, "premiums");
  assertWritableVaultField(vault, "availableCapital");
  vault.premiums = premiums;
  vault.availableCapital = availableCapital;
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
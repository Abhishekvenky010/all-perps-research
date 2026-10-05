import {
  runCapacityAttackSweep,
} from "./attackEconomicsModel.js";

const rows = runCapacityAttackSweep();

console.table(
  rows.map((row) => ({
    utilization: `${(row.utilization * 100).toFixed(0)}%`,
    attackerSize: row.attackerSize,
    entry:
      row.entryPrice === null
        ? "--"
        : row.entryPrice.toFixed(4),
    exit:
      row.exitPrice === null
        ? "--"
        : row.exitPrice.toFixed(4),
    headlinePnl:
      row.headlinePnl === null
        ? "--"
        : row.headlinePnl.toFixed(0),
    liquidatedOnEntry: row.liquidatedOnEntry,
    realizablePnl:
      row.realizablePnl === null
        ? "--"
        : row.realizablePnl.toFixed(0),
    status: row.entryError
      ? `entry rejected: ${row.entryError}`
      : row.exitError
        ? `exit rejected: ${row.exitError}`
        : "executable",
  })),
);

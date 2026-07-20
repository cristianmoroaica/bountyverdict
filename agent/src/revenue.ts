export const SINGLE_PAYMENT_ATOMIC = 50_000n;
export const PORTFOLIO_PAYMENT_ATOMIC = 400_000n;
export const HARNESS_PAYMENT_ATOMIC = 30_000n;
export const SKILL_PAYMENT_ATOMIC = 60_000n;
export const RUN_PAYMENT_ATOMIC = 40_000n;
export const REVENUE_TARGET_ATOMIC = 1_000_000_000n;
export const KNOWN_NON_REVENUE_TX_HASHES = [
  // Capped production interoperability proofs funded by the project owner.
  "0x6d308dcf6a53aae946b3a5ee55ab5afab8579acfbde7147fa18734ebb11fc7d4",
  "0x7387f1de74c7441d3d82416e4ece1df8cfd27075ddeb692dda5250ef971d12cd",
  "0x5cb517f6e3c621f7ba0bc99f70ee9e4be0e9d464accba7482b7fda8f6ccbbf10",
  "0x498267e8a4759de4a337bb70880bd90c51ad82305d78d932b7edaa45b4b599f6",
] as const;

export interface SettlementTransfer {
  amount: bigint;
  transaction_hash: string;
  log_index: number;
}

export interface RevenueSummary {
  target_usdc: string;
  recognized_usdc: string;
  remaining_usdc: string;
  progress_percent: number;
  purchases: {
    single: number;
    portfolio: number;
    harness: number;
    skill: number;
    run: number;
    total: number;
  };
  recognized_transfers: SettlementTransfer[];
  unrecognized_transfers: SettlementTransfer[];
  excluded_transfers: SettlementTransfer[];
}

function formatUsdc(atomic: bigint): string {
  const whole = atomic / 1_000_000n;
  const fraction = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function summarizeRevenue(
  transfers: SettlementTransfer[],
  excludedTransactionHashes: readonly string[] = KNOWN_NON_REVENUE_TX_HASHES,
): RevenueSummary {
  const exclusions = new Set(excludedTransactionHashes.map((hash) => hash.toLowerCase()));
  const excluded = transfers.filter(({ transaction_hash }) =>
    exclusions.has(transaction_hash.toLowerCase())
  );
  const eligible = transfers.filter(({ transaction_hash }) =>
    !exclusions.has(transaction_hash.toLowerCase())
  );
  const recognized = eligible.filter(({ amount }) =>
    amount === SINGLE_PAYMENT_ATOMIC || amount === PORTFOLIO_PAYMENT_ATOMIC || amount === HARNESS_PAYMENT_ATOMIC || amount === SKILL_PAYMENT_ATOMIC || amount === RUN_PAYMENT_ATOMIC
  );
  const unrecognized = eligible.filter(({ amount }) =>
    amount !== SINGLE_PAYMENT_ATOMIC && amount !== PORTFOLIO_PAYMENT_ATOMIC && amount !== HARNESS_PAYMENT_ATOMIC && amount !== SKILL_PAYMENT_ATOMIC && amount !== RUN_PAYMENT_ATOMIC
  );
  const recognizedAtomic = recognized.reduce((sum, transfer) => sum + transfer.amount, 0n);
  const remainingAtomic = recognizedAtomic >= REVENUE_TARGET_ATOMIC
    ? 0n
    : REVENUE_TARGET_ATOMIC - recognizedAtomic;
  const single = recognized.filter(({ amount }) => amount === SINGLE_PAYMENT_ATOMIC).length;
  const portfolio = recognized.filter(({ amount }) => amount === PORTFOLIO_PAYMENT_ATOMIC).length;
  const harness = recognized.filter(({ amount }) => amount === HARNESS_PAYMENT_ATOMIC).length;
  const skill = recognized.filter(({ amount }) => amount === SKILL_PAYMENT_ATOMIC).length;
  const run = recognized.filter(({ amount }) => amount === RUN_PAYMENT_ATOMIC).length;

  return {
    target_usdc: formatUsdc(REVENUE_TARGET_ATOMIC),
    recognized_usdc: formatUsdc(recognizedAtomic),
    remaining_usdc: formatUsdc(remainingAtomic),
    progress_percent: Number((recognizedAtomic * 1_000_000n) / REVENUE_TARGET_ATOMIC) / 10_000,
    purchases: { single, portfolio, harness, skill, run, total: single + portfolio + harness + skill + run },
    recognized_transfers: recognized,
    unrecognized_transfers: unrecognized,
    excluded_transfers: excluded,
  };
}

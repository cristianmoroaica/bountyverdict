export const SINGLE_PAYMENT_ATOMIC = 50_000n;
export const PORTFOLIO_PAYMENT_ATOMIC = 400_000n;
export const REVENUE_TARGET_ATOMIC = 1_000_000_000n;

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
    total: number;
  };
  recognized_transfers: SettlementTransfer[];
  unrecognized_transfers: SettlementTransfer[];
}

function formatUsdc(atomic: bigint): string {
  const whole = atomic / 1_000_000n;
  const fraction = (atomic % 1_000_000n).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

export function summarizeRevenue(transfers: SettlementTransfer[]): RevenueSummary {
  const recognized = transfers.filter(({ amount }) =>
    amount === SINGLE_PAYMENT_ATOMIC || amount === PORTFOLIO_PAYMENT_ATOMIC
  );
  const unrecognized = transfers.filter(({ amount }) =>
    amount !== SINGLE_PAYMENT_ATOMIC && amount !== PORTFOLIO_PAYMENT_ATOMIC
  );
  const recognizedAtomic = recognized.reduce((sum, transfer) => sum + transfer.amount, 0n);
  const remainingAtomic = recognizedAtomic >= REVENUE_TARGET_ATOMIC
    ? 0n
    : REVENUE_TARGET_ATOMIC - recognizedAtomic;
  const single = recognized.filter(({ amount }) => amount === SINGLE_PAYMENT_ATOMIC).length;
  const portfolio = recognized.filter(({ amount }) => amount === PORTFOLIO_PAYMENT_ATOMIC).length;

  return {
    target_usdc: formatUsdc(REVENUE_TARGET_ATOMIC),
    recognized_usdc: formatUsdc(recognizedAtomic),
    remaining_usdc: formatUsdc(remainingAtomic),
    progress_percent: Number((recognizedAtomic * 1_000_000n) / REVENUE_TARGET_ATOMIC) / 10_000,
    purchases: { single, portfolio, total: single + portfolio },
    recognized_transfers: recognized,
    unrecognized_transfers: unrecognized,
  };
}

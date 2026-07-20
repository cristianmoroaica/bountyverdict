export interface PaymentRequirement {
  amount: string;
  network: string;
  asset?: string;
  payTo?: string;
}

export function validatePaymentChallenge(
  challenge: any,
  options: {
    maximumAtomic: bigint;
    executePayment: boolean;
    allowMainnet: boolean;
  },
): PaymentRequirement {
  const requirement = challenge?.accepts?.[0] as PaymentRequirement | undefined;
  if (!requirement) throw new Error("The payment challenge has no accepted payment option.");

  let amount: bigint;
  try {
    amount = BigInt(requirement.amount);
  } catch {
    throw new Error("The payment challenge contains an invalid amount.");
  }
  if (amount > options.maximumAtomic) {
    throw new Error(`Advertised price ${amount} exceeds safety cap ${options.maximumAtomic}.`);
  }
  if (
    options.executePayment &&
    requirement.network === "eip155:8453" &&
    !options.allowMainnet
  ) {
    throw new Error("Mainnet payment refused. Set ALLOW_MAINNET_PAYMENT=YES explicitly.");
  }
  return requirement;
}

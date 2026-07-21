import {
  decodeEventLog,
  parseAbi,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import {
  CLAWLANCER_CHAIN,
  type ClawlancerTransaction,
} from "./clawlancer-work.ts";

type ChainLog = {
  address: Address;
  data: Hex;
  topics: readonly Hex[];
  logIndex: number | null;
};

type TransactionReceipt = { status: "success" | "reverted"; logs: ChainLog[] };
type ChainTransaction = { from: Address; to: Address | null };

export type ClawlancerChainClient = {
  getTransactionReceipt(args: { hash: Hash }): Promise<TransactionReceipt>;
  getTransaction(args: { hash: Hash }): Promise<ChainTransaction>;
  readContract(args: Record<string, unknown>): Promise<unknown>;
};

const escrowAbi = parseAbi([
  "event Created(bytes32 indexed id, address indexed buyer, address indexed seller, uint256 amount, address token)",
  "event Released(bytes32 indexed id, uint256 sellerAmount, uint256 feeAmount)",
  "function getEscrow(bytes32 id) view returns (address buyer, address seller, uint256 amount, uint256 deadline, uint8 state, address token)",
  "function treasury() view returns (address)",
]);
const transferAbi = parseAbi([
  "event Transfer(address indexed from, address indexed to, uint256 value)",
]);

type Transfer = { from: Address; to: Address; value: bigint; logIndex: number };
type Created = { id: Hex; buyer: Address; seller: Address; amount: bigint; token: Address; logIndex: number };
type Released = { id: Hex; sellerAmount: bigint; feeAmount: bigint; logIndex: number };

function logIndex(value: number | null): number {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error("Clawlancer receipt log index is invalid.");
  return Number(value);
}

function transfers(logs: ChainLog[]): Transfer[] {
  return logs.flatMap((log) => {
    if (log.address.toLowerCase() !== CLAWLANCER_CHAIN.usdcAddress.toLowerCase()) return [];
    try {
      const decoded = decodeEventLog({ abi: transferAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (decoded.eventName !== "Transfer") return [];
      const args = decoded.args as { from: Address; to: Address; value: bigint };
      return [{ ...args, logIndex: logIndex(log.logIndex) }];
    } catch {
      return [];
    }
  });
}

function createdEvents(logs: ChainLog[]): Created[] {
  return logs.flatMap((log) => {
    if (log.address.toLowerCase() !== CLAWLANCER_CHAIN.escrowAddress.toLowerCase()) return [];
    try {
      const decoded = decodeEventLog({ abi: escrowAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (decoded.eventName !== "Created") return [];
      const args = decoded.args as Omit<Created, "logIndex">;
      return [{ ...args, logIndex: logIndex(log.logIndex) }];
    } catch {
      return [];
    }
  });
}

function releasedEvents(logs: ChainLog[]): Released[] {
  return logs.flatMap((log) => {
    if (log.address.toLowerCase() !== CLAWLANCER_CHAIN.escrowAddress.toLowerCase()) return [];
    try {
      const decoded = decodeEventLog({ abi: escrowAbi, data: log.data, topics: log.topics as [Hex, ...Hex[]] });
      if (decoded.eventName !== "Released") return [];
      const args = decoded.args as Omit<Released, "logIndex">;
      return [{ ...args, logIndex: logIndex(log.logIndex) }];
    } catch {
      return [];
    }
  });
}

function escrowTuple(value: unknown): readonly [Address, Address, bigint, bigint, number, Address] {
  if (!Array.isArray(value) || value.length !== 6 || typeof value[0] !== "string" ||
    typeof value[1] !== "string" || typeof value[2] !== "bigint" || typeof value[3] !== "bigint" ||
    !Number.isSafeInteger(value[4]) || typeof value[5] !== "string") {
    throw new Error("Clawlancer onchain escrow state is malformed.");
  }
  return value as unknown as readonly [Address, Address, bigint, bigint, number, Address];
}

function requireFundedMetadata(transaction: ClawlancerTransaction): asserts transaction is ClawlancerTransaction & {
  fundingTxHash: Hash;
  escrowId: Hex;
} {
  if (!transaction.fundingTxHash || !transaction.escrowId || transaction.oracleFunded !== true ||
    transaction.reconciled !== true || transaction.contractVersion !== CLAWLANCER_CHAIN.contractVersion) {
    throw new Error("Clawlancer API funding metadata is incomplete or unreconciled.");
  }
}

export async function verifyClawlancerFunding(
  client: ClawlancerChainClient,
  transaction: ClawlancerTransaction,
  now = Date.now(),
): Promise<Record<string, unknown>> {
  requireFundedMetadata(transaction);
  const [receipt, call, rawEscrow] = await Promise.all([
    client.getTransactionReceipt({ hash: transaction.fundingTxHash }),
    client.getTransaction({ hash: transaction.fundingTxHash }),
    client.readContract({
      address: CLAWLANCER_CHAIN.escrowAddress,
      abi: escrowAbi,
      functionName: "getEscrow",
      args: [transaction.escrowId],
    }),
  ]);
  if (receipt.status !== "success" || call.to?.toLowerCase() !== CLAWLANCER_CHAIN.escrowAddress.toLowerCase() ||
    call.from.toLowerCase() !== CLAWLANCER_CHAIN.oracleAddress.toLowerCase()) {
    throw new Error("Clawlancer funding transaction is not a successful oracle call to the pinned escrow.");
  }
  const expectedAmount = BigInt(transaction.amountAtomic);
  const created = createdEvents(receipt.logs).filter((event) =>
    event.id.toLowerCase() === transaction.escrowId.toLowerCase() &&
    event.buyer.toLowerCase() === CLAWLANCER_CHAIN.oracleAddress.toLowerCase() &&
    event.seller.toLowerCase() === transaction.sellerAddress.toLowerCase() &&
    event.amount === expectedAmount &&
    event.token.toLowerCase() === CLAWLANCER_CHAIN.usdcAddress.toLowerCase()
  );
  const deposits = transfers(receipt.logs).filter((event) =>
    event.from.toLowerCase() === CLAWLANCER_CHAIN.oracleAddress.toLowerCase() &&
    event.to.toLowerCase() === CLAWLANCER_CHAIN.escrowAddress.toLowerCase() &&
    event.value === expectedAmount
  );
  if (created.length !== 1 || deposits.length !== 1) {
    throw new Error("Clawlancer funding receipt lacks one exact Created event and escrow deposit.");
  }
  const escrow = escrowTuple(rawEscrow);
  if (escrow[0].toLowerCase() !== CLAWLANCER_CHAIN.oracleAddress.toLowerCase() ||
    escrow[1].toLowerCase() !== transaction.sellerAddress.toLowerCase() || escrow[2] !== expectedAmount ||
    escrow[4] !== 0 || escrow[5].toLowerCase() !== CLAWLANCER_CHAIN.usdcAddress.toLowerCase() ||
    escrow[3] * 1000n <= BigInt(now)) {
    throw new Error("Clawlancer escrow storage does not prove a live exact funded job.");
  }
  return {
    verified: true,
    network: CLAWLANCER_CHAIN.network,
    funding_tx_hash: transaction.fundingTxHash,
    escrow_id: transaction.escrowId,
    escrow_contract: CLAWLANCER_CHAIN.escrowAddress,
    oracle_address: CLAWLANCER_CHAIN.oracleAddress,
    worker_address: transaction.sellerAddress,
    amount_atomic: transaction.amountAtomic,
    created_log_index: created[0].logIndex,
    deposit_log_index: deposits[0].logIndex,
    escrow_deadline: escrow[3].toString(),
  };
}

export async function verifyClawlancerRelease(
  client: ClawlancerChainClient,
  transaction: ClawlancerTransaction,
): Promise<Record<string, unknown>> {
  requireFundedMetadata(transaction);
  if (transaction.state !== "RELEASED" || !transaction.releaseTxHash) {
    throw new Error("Clawlancer transaction is not released with a release hash.");
  }
  const [receipt, call, rawEscrow, rawTreasury] = await Promise.all([
    client.getTransactionReceipt({ hash: transaction.releaseTxHash as Hash }),
    client.getTransaction({ hash: transaction.releaseTxHash as Hash }),
    client.readContract({
      address: CLAWLANCER_CHAIN.escrowAddress,
      abi: escrowAbi,
      functionName: "getEscrow",
      args: [transaction.escrowId],
    }),
    client.readContract({ address: CLAWLANCER_CHAIN.escrowAddress, abi: escrowAbi, functionName: "treasury" }),
  ]);
  if (receipt.status !== "success" || call.to?.toLowerCase() !== CLAWLANCER_CHAIN.escrowAddress.toLowerCase() ||
    call.from.toLowerCase() !== CLAWLANCER_CHAIN.oracleAddress.toLowerCase()) {
    throw new Error("Clawlancer release transaction is not a successful oracle call to the pinned escrow.");
  }
  if (typeof rawTreasury !== "string" || !/^0x[a-f0-9]{40}$/i.test(rawTreasury)) {
    throw new Error("Clawlancer treasury address is malformed.");
  }
  const escrow = escrowTuple(rawEscrow);
  const expectedAmount = BigInt(transaction.amountAtomic);
  if (escrow[0].toLowerCase() !== CLAWLANCER_CHAIN.oracleAddress.toLowerCase() ||
    escrow[1].toLowerCase() !== transaction.sellerAddress.toLowerCase() || escrow[2] !== expectedAmount ||
    escrow[4] !== 1 || escrow[5].toLowerCase() !== CLAWLANCER_CHAIN.usdcAddress.toLowerCase()) {
    throw new Error("Clawlancer escrow storage does not prove this exact released job.");
  }
  const released = releasedEvents(receipt.logs).filter((event) =>
    event.id.toLowerCase() === transaction.escrowId!.toLowerCase() &&
    event.sellerAmount > 0n && event.sellerAmount + event.feeAmount === expectedAmount
  );
  if (released.length !== 1) throw new Error("Clawlancer receipt lacks one exact Released event.");
  const sellerPayments = transfers(receipt.logs).filter((event) =>
    event.from.toLowerCase() === CLAWLANCER_CHAIN.escrowAddress.toLowerCase() &&
    event.to.toLowerCase() === transaction.sellerAddress.toLowerCase() &&
    event.value === released[0].sellerAmount
  );
  const feePayments = transfers(receipt.logs).filter((event) =>
    event.from.toLowerCase() === CLAWLANCER_CHAIN.escrowAddress.toLowerCase() &&
    event.to.toLowerCase() === rawTreasury.toLowerCase() &&
    event.value === released[0].feeAmount
  );
  if (sellerPayments.length !== 1 || (released[0].feeAmount > 0n && feePayments.length !== 1)) {
    throw new Error("Clawlancer release receipt lacks exact escrow-sourced seller and fee transfers.");
  }
  return {
    verified: true,
    network: CLAWLANCER_CHAIN.network,
    release_tx_hash: transaction.releaseTxHash,
    escrow_id: transaction.escrowId,
    escrow_contract: CLAWLANCER_CHAIN.escrowAddress,
    base_usdc_address: CLAWLANCER_CHAIN.usdcAddress,
    oracle_address: CLAWLANCER_CHAIN.oracleAddress,
    worker_address: transaction.sellerAddress,
    gross_amount_atomic: transaction.amountAtomic,
    worker_amount_atomic: released[0].sellerAmount.toString(),
    fee_amount_atomic: released[0].feeAmount.toString(),
    released_log_index: released[0].logIndex,
    worker_transfer_log_index: sellerPayments[0].logIndex,
    fee_transfer_log_index: feePayments[0]?.logIndex ?? null,
  };
}

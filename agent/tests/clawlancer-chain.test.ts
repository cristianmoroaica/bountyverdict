import assert from "node:assert/strict";
import test from "node:test";
import {
  encodeAbiParameters,
  encodeEventTopics,
  parseAbi,
  parseAbiParameters,
  type Address,
  type Hash,
  type Hex,
} from "viem";
import {
  verifyClawlancerFunding,
  verifyClawlancerRelease,
  type ClawlancerChainClient,
} from "../src/clawlancer-chain.ts";
import {
  CLAWLANCER_CANARY,
  CLAWLANCER_CHAIN,
  type ClawlancerTransaction,
} from "../src/clawlancer-work.ts";

const fundingHash = `0x${"1".repeat(64)}` as Hash;
const releaseHash = `0x${"2".repeat(64)}` as Hash;
const escrowId = `0x${"3".repeat(64)}` as Hex;
const treasury = `0x${"4".repeat(40)}` as Address;
const other = `0x${"5".repeat(40)}` as Address;
const createdAbi = parseAbi(["event Created(bytes32 indexed id, address indexed buyer, address indexed seller, uint256 amount, address token)"]);
const releasedAbi = parseAbi(["event Released(bytes32 indexed id, uint256 sellerAmount, uint256 feeAmount)"]);
const transferAbi = parseAbi(["event Transfer(address indexed from, address indexed to, uint256 value)"]);

const transaction = (state: ClawlancerTransaction["state"]): ClawlancerTransaction => ({
  id: CLAWLANCER_CANARY.transactionId,
  listingId: CLAWLANCER_CANARY.listingId,
  buyerAddress: CLAWLANCER_CANARY.buyerAddress,
  sellerAddress: CLAWLANCER_CANARY.sellerAddress,
  amountAtomic: CLAWLANCER_CANARY.amountAtomic,
  currency: "USDC",
  state,
  fundingTxHash: fundingHash,
  releaseTxHash: state === "RELEASED" ? releaseHash : null,
  escrowId,
  oracleFunded: true,
  reconciled: true,
  contractVersion: 1,
  deadline: "2026-07-28T08:30:55.170Z",
});

function createdLog(id = escrowId) {
  return {
    address: CLAWLANCER_CHAIN.escrowAddress as Address,
    topics: encodeEventTopics({
      abi: createdAbi,
      eventName: "Created",
      args: { id, buyer: CLAWLANCER_CHAIN.oracleAddress as Address, seller: CLAWLANCER_CANARY.sellerAddress as Address },
    }),
    data: encodeAbiParameters(parseAbiParameters("uint256 amount, address token"), [
      10_000n,
      CLAWLANCER_CHAIN.usdcAddress as Address,
    ]),
    logIndex: 1,
  };
}

function transferLog(from: Address, to: Address, value: bigint, index: number) {
  return {
    address: CLAWLANCER_CHAIN.usdcAddress as Address,
    topics: encodeEventTopics({ abi: transferAbi, eventName: "Transfer", args: { from, to } }),
    data: encodeAbiParameters(parseAbiParameters("uint256 value"), [value]),
    logIndex: index,
  };
}

function releasedLog(id = escrowId, sellerAmount = 9_900n, feeAmount = 100n) {
  return {
    address: CLAWLANCER_CHAIN.escrowAddress as Address,
    topics: encodeEventTopics({ abi: releasedAbi, eventName: "Released", args: { id } }),
    data: encodeAbiParameters(parseAbiParameters("uint256 sellerAmount, uint256 feeAmount"), [sellerAmount, feeAmount]),
    logIndex: 3,
  };
}

function client(options: { wrongDepositSource?: boolean; wrongReleaseSource?: boolean; wrongReleasedId?: boolean } = {}): ClawlancerChainClient {
  return {
    async getTransactionReceipt({ hash }) {
      if (hash === fundingHash) {
        return {
          status: "success",
          logs: [
            createdLog(),
            transferLog(
              (options.wrongDepositSource ? other : CLAWLANCER_CHAIN.oracleAddress) as Address,
              CLAWLANCER_CHAIN.escrowAddress as Address,
              10_000n,
              2,
            ),
          ],
        };
      }
      return {
        status: "success",
        logs: [
          releasedLog(options.wrongReleasedId ? `0x${"9".repeat(64)}` as Hex : escrowId),
          transferLog(
            (options.wrongReleaseSource ? other : CLAWLANCER_CHAIN.escrowAddress) as Address,
            CLAWLANCER_CANARY.sellerAddress as Address,
            9_900n,
            4,
          ),
          transferLog(CLAWLANCER_CHAIN.escrowAddress as Address, treasury, 100n, 5),
        ],
      };
    },
    async getTransaction() {
      return {
        from: CLAWLANCER_CHAIN.oracleAddress as Address,
        to: CLAWLANCER_CHAIN.escrowAddress as Address,
      };
    },
    async readContract(args) {
      if (args.functionName === "treasury") return treasury;
      const state = args.args && Array.isArray(args.args) && transaction("RELEASED").releaseTxHash ? 1 : 0;
      return [
        CLAWLANCER_CHAIN.oracleAddress,
        CLAWLANCER_CANARY.sellerAddress,
        10_000n,
        BigInt(Math.floor(Date.parse("2026-07-28T08:30:55.170Z") / 1000)),
        state,
        CLAWLANCER_CHAIN.usdcAddress,
      ];
    },
  };
}

function clientForState(state: 0 | 1, options: Parameters<typeof client>[0] = {}): ClawlancerChainClient {
  const baseClient = client(options);
  return {
    ...baseClient,
    async readContract(args) {
      if (args.functionName === "treasury") return treasury;
      return [
        CLAWLANCER_CHAIN.oracleAddress,
        CLAWLANCER_CANARY.sellerAddress,
        10_000n,
        BigInt(Math.floor(Date.parse("2026-07-28T08:30:55.170Z") / 1000)),
        state,
        CLAWLANCER_CHAIN.usdcAddress,
      ];
    },
  };
}

test("Clawlancer delivery gate requires exact live onchain escrow funding", async () => {
  const evidence = await verifyClawlancerFunding(
    clientForState(0),
    transaction("FUNDED"),
    Date.parse("2026-07-21T09:00:00Z"),
  );
  assert.equal(evidence.verified, true);
  await assert.rejects(
    verifyClawlancerFunding(clientForState(0, { wrongDepositSource: true }), transaction("FUNDED")),
    /Created event and escrow deposit/,
  );
  await assert.rejects(
    verifyClawlancerFunding(clientForState(0), { ...transaction("FUNDED"), fundingTxHash: null }),
    /incomplete or unreconciled/,
  );
});

test("Clawlancer release accounting binds exact escrow event and escrow-sourced transfers", async () => {
  const evidence = await verifyClawlancerRelease(clientForState(1), transaction("RELEASED"));
  assert.equal(evidence.verified, true);
  assert.equal(evidence.worker_amount_atomic, "9900");
  assert.equal(evidence.fee_amount_atomic, "100");
  await assert.rejects(
    verifyClawlancerRelease(clientForState(1, { wrongReleaseSource: true }), transaction("RELEASED")),
    /escrow-sourced seller and fee transfers/,
  );
  await assert.rejects(
    verifyClawlancerRelease(clientForState(1, { wrongReleasedId: true }), transaction("RELEASED")),
    /Released event/,
  );
});

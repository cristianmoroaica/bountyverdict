import assert from "node:assert/strict";
import test from "node:test";
import {
  findPublicTaskmarketSubmission,
  taskmarketRetryGate,
} from "../src/taskmarket-submit-retry.ts";

const taskId = `0x${"a".repeat(64)}`;
const workerAddress = `0x${"b".repeat(40)}`;

test("public reconciliation requires both the exact task and worker", () => {
  const artifact = { role: "final", fileName: "submission.json", sha256: "f".repeat(64) };
  const exact = {
    id: "7405cc23-ba8c-40d8-9b6d-c3647251d519",
    taskId,
    workerAddress,
    submitTxHash: `0x${"e".repeat(64)}`,
    deliverableHash: `0x${"1".repeat(64)}`,
    rejectedAt: null,
    artifacts: [{
      taskId,
      submissionId: "7405cc23-ba8c-40d8-9b6d-c3647251d519",
      workerAddress,
      ...artifact,
      sha256Hash: artifact.sha256,
    }],
  };
  const payload = [
    { ...exact, taskId: `0x${"c".repeat(64)}` },
    { ...exact, workerAddress: `0x${"d".repeat(40)}` },
    exact,
  ];
  assert.equal(findPublicTaskmarketSubmission(payload, taskId.toUpperCase(), workerAddress.toUpperCase(), artifact), exact);
  assert.equal(findPublicTaskmarketSubmission(payload.slice(0, 2), taskId, workerAddress, artifact), null);
  assert.equal(findPublicTaskmarketSubmission([{ ...exact, artifacts: [{ ...exact.artifacts[0], sha256Hash: "0".repeat(64) }] }], taskId, workerAddress, artifact), null);
  assert.equal(findPublicTaskmarketSubmission([{ ...exact, rejectedAt: "2026-07-21T09:00:00Z" }], taskId, workerAddress, artifact), null);
});

test("retry gate distinguishes transient metadata failures from terminal task states", () => {
  const now = Date.parse("2026-07-21T08:00:00Z");
  const open = { id: taskId, status: "open", submissionWindowOpen: true, expiryTime: "2026-07-22T08:00:00Z" };
  assert.deepEqual(taskmarketRetryGate(open, taskId, now), {
    eligible: true,
    expiryTime: "2026-07-22T08:00:00Z",
  });
  assert.deepEqual(taskmarketRetryGate({ ...open, status: "completed" }, taskId, now), {
    eligible: false,
    terminal: true,
    reason: "task_completed",
    expiryTime: "2026-07-22T08:00:00Z",
  });
  assert.deepEqual(taskmarketRetryGate({ ...open, expiryTime: "2026-07-20T08:00:00Z" }, taskId, now), {
    eligible: false,
    terminal: true,
    reason: "task_expired",
    expiryTime: "2026-07-20T08:00:00Z",
  });
  assert.equal(taskmarketRetryGate({}, taskId, now).terminal, false);
});

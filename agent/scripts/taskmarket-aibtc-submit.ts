import { createHash } from "node:crypto";
import { execFile as execFileCallback } from "node:child_process";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";
import { promisify } from "node:util";
import { acquireExclusiveRun } from "../src/exclusive-run.ts";
import {
  findPublicTaskmarketSubmission,
  taskmarketRetryGate,
} from "../src/taskmarket-submit-retry.ts";

const execFile = promisify(execFileCallback);
const TASK_ID = "0x100219baba1f9df11f7f15f226bbd9994c445060ca2bd2ac7ef820bd4f7759f7";
const WORKER_ADDRESS = "0xe5E0fe496B7283032d034Dc79C305b384Ad1ee67";
const ARTIFACT_PATH = "/home/mcr/notes/taskmarket/source-discovery-aibtc.json";
const ARTIFACT_SHA256 = "f7b038f449c1ff78e6f31cebc85a38feabdc5fdccc9a489548225976ba014f1d";
const TASKMARKET_API = "https://api.taskmarket.dev";
const STATE_PATH = `${homedir()}/.local/state/bountyverdict/taskmarket-aibtc-submit.json`;
const LOCK_PATH = `${homedir()}/.local/state/bountyverdict/taskmarket-aibtc-submit.lock`;
const timeoutMs = 20_000;
const maximumResponseBytes = 2_000_000;

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function writeState(value: Record<string, unknown>): Promise<void> {
  await atomicWrite(STATE_PATH, `${JSON.stringify(value, null, 2)}\n`);
}

async function publicJson(path: string): Promise<unknown> {
  const response = await fetch(new URL(path, TASKMARKET_API), {
    redirect: "error",
    headers: { Accept: "application/json", "User-Agent": "bountyverdict-taskmarket-submit-reconciler/1.0" },
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (!response.ok) throw new Error(`Taskmarket returned HTTP ${response.status}.`);
  if (!(response.headers.get("content-type") || "").toLowerCase().includes("application/json")) {
    throw new Error("Taskmarket returned a non-JSON response.");
  }
  const declaredLength = Number(response.headers.get("content-length") || 0);
  if (Number.isFinite(declaredLength) && declaredLength > maximumResponseBytes) {
    throw new Error("Taskmarket response exceeded the byte cap.");
  }
  const body = await response.text();
  if (new TextEncoder().encode(body).length > maximumResponseBytes) {
    throw new Error("Taskmarket response exceeded the byte cap.");
  }
  return JSON.parse(body) as unknown;
}

async function reconcile(): Promise<Record<string, unknown> | null> {
  const encoded = encodeURIComponent(TASK_ID);
  const publicSubmissions = await publicJson(`/api/tasks/${encoded}/submissions`);
  return findPublicTaskmarketSubmission(publicSubmissions, TASK_ID, WORKER_ADDRESS, {
    role: "final",
    fileName: "source-discovery-aibtc.json",
    sha256: ARTIFACT_SHA256,
  });
}

const checkedAt = new Date().toISOString();
let releaseLock: (() => Promise<void>) | null = null;
try {
  releaseLock = await acquireExclusiveRun(LOCK_PATH);
  const artifact = await readFile(ARTIFACT_PATH);
  const sha256 = createHash("sha256").update(artifact).digest("hex");
  if (sha256 !== ARTIFACT_SHA256) throw new Error("Pinned AIBTC artifact hash changed; refusing submission.");
  JSON.parse(artifact.toString("utf8"));

  const existing = await reconcile();
  if (existing) {
    const state = { status: "submitted", checked_at: checkedAt, task_id: TASK_ID, worker_address: WORKER_ADDRESS, submission: existing };
    await writeState(state);
    console.log(JSON.stringify(state, null, 2));
  } else {
    const gate = taskmarketRetryGate(await publicJson(`/api/tasks/${encodeURIComponent(TASK_ID)}`), TASK_ID);
    if (!gate.eligible) {
      const state = { status: gate.terminal ? "terminal" : "deferred", checked_at: checkedAt, task_id: TASK_ID, reason: gate.reason, expiry_time: gate.expiryTime };
      await writeState(state);
      console.log(JSON.stringify(state, null, 2));
      if (!gate.terminal) process.exitCode = 1;
    } else {
      await execFile(
        "npx",
        [
          "-y", "@lucid-agents/taskmarket@1.4.0", "task", "submit", TASK_ID,
          "--file", ARTIFACT_PATH, "--role", "final",
        ],
        { cwd: "/home/mcr/Projects/sandbox/bountyverdict", timeout: 60_000, maxBuffer: maximumResponseBytes },
      );

      const submitted = await reconcile();
      if (!submitted) throw new Error("Submission command returned successfully but reconciliation found no exact artifact submission.");
      const state = { status: "submitted", checked_at: new Date().toISOString(), task_id: TASK_ID, worker_address: WORKER_ADDRESS, submission: submitted };
      await writeState(state);
      console.log(JSON.stringify(state, null, 2));
    }
  }
} catch (error) {
  const message = error instanceof Error ? error.message : "unknown submission failure";
  const state = { status: "retry_pending", checked_at: checkedAt, task_id: TASK_ID, worker_address: WORKER_ADDRESS, error: message.slice(0, 500) };
  await writeState(state);
  console.error(JSON.stringify(state, null, 2));
  process.exitCode = 1;
} finally {
  if (releaseLock) await releaseLock();
}

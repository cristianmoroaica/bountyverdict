import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { acquireExclusiveRun } from "../src/exclusive-run.ts";

test("exclusive worker lock rejects overlap and can be released exactly once", async () => {
  const root = await mkdtemp(join(tmpdir(), "bountyverdict-lock-"));
  try {
    const path = join(root, "worker.lock");
    const release = await acquireExclusiveRun(path);
    await assert.rejects(acquireExclusiveRun(path), /already holds/);
    await release();
    await release();
    const nextRelease = await acquireExclusiveRun(path);
    await nextRelease();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("exclusive worker lock safely takes over an old owner-dead lock", async () => {
  const root = await mkdtemp(join(tmpdir(), "bountyverdict-stale-lock-"));
  try {
    const path = join(root, "worker.lock");
    await mkdir(path, { mode: 0o700 });
    await writeFile(join(path, "owner.json"), `${JSON.stringify({
      schema_version: 1,
      pid: 424242,
      started_at_ms: 1_000,
      token: "11111111-1111-4111-8111-111111111111",
    })}\n`, { mode: 0o600 });
    const release = await acquireExclusiveRun(path, {
      now: () => 120_000,
      pid: 777,
      staleAfterMs: 60_000,
      isProcessAlive: () => false,
    });
    await release();
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

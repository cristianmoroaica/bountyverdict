import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rmdir, stat, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";

type LockOptions = {
  now?: () => number;
  pid?: number;
  isProcessAlive?: (pid: number) => boolean;
  staleAfterMs?: number;
};

type Owner = { schema_version: 1; pid: number; started_at_ms: number; token: string };

function liveProcess(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return (error as NodeJS.ErrnoException).code !== "ESRCH";
  }
}

function parseOwner(value: unknown): Owner | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const owner = value as Record<string, unknown>;
  return owner.schema_version === 1 && Number.isSafeInteger(owner.pid) && Number(owner.pid) > 0 &&
    Number.isSafeInteger(owner.started_at_ms) && Number(owner.started_at_ms) >= 0 &&
    typeof owner.token === "string" && /^[a-f0-9-]{36}$/i.test(owner.token)
    ? owner as Owner
    : null;
}

export async function acquireExclusiveRun(path: string, options: LockOptions = {}): Promise<() => Promise<void>> {
  const now = options.now || Date.now;
  const pid = options.pid ?? process.pid;
  const isProcessAlive = options.isProcessAlive || liveProcess;
  const staleAfterMs = options.staleAfterMs ?? 60_000;
  if (!Number.isSafeInteger(pid) || pid <= 0 || !Number.isSafeInteger(staleAfterMs) || staleAfterMs < 1_000) {
    throw new Error("Exclusive-run lock options are invalid.");
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const ownerPath = join(path, "owner.json");
  const owner: Owner = { schema_version: 1, pid, started_at_ms: now(), token: randomUUID() };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      await mkdir(path, { mode: 0o700 });
      try {
        await writeFile(ownerPath, `${JSON.stringify(owner)}\n`, { mode: 0o600, flag: "wx" });
      } catch (error) {
        await rmdir(path).catch(() => undefined);
        throw error;
      }
      break;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let existing: Owner | null = null;
      let ageMs = 0;
      try {
        existing = parseOwner(JSON.parse(await readFile(ownerPath, "utf8")));
        ageMs = now() - (existing?.started_at_ms ?? 0);
      } catch {
        const lockStat = await stat(path);
        ageMs = now() - lockStat.mtimeMs;
      }
      const abandoned = ageMs >= staleAfterMs && (!existing || !isProcessAlive(existing.pid));
      if (!abandoned || attempt > 0) throw new Error(`Another bounded worker already holds ${path}.`);
      const quarantined = `${path}.abandoned-${randomUUID()}`;
      try {
        await rename(path, quarantined);
      } catch (renameError) {
        if ((renameError as NodeJS.ErrnoException).code === "ENOENT") continue;
        throw renameError;
      }
      await unlink(join(quarantined, "owner.json")).catch((unlinkError) => {
        if ((unlinkError as NodeJS.ErrnoException).code !== "ENOENT") throw unlinkError;
      });
      await rmdir(quarantined);
    }
  }
  let released = false;
  return async () => {
    if (released) return;
    released = true;
    const current = parseOwner(JSON.parse(await readFile(ownerPath, "utf8")));
    if (!current || current.token !== owner.token) throw new Error("Exclusive-run lock ownership changed before release.");
    await unlink(ownerPath);
    await rmdir(path);
  };
}

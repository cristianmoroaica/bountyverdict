type UnknownRecord = Record<string, unknown>;

function record(value: unknown): UnknownRecord | null {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as UnknownRecord
    : null;
}

function rows(value: unknown): UnknownRecord[] {
  const direct = Array.isArray(value) ? value : record(value)?.data;
  return Array.isArray(direct)
    ? direct.map(record).filter((item): item is UnknownRecord => item !== null)
    : [];
}

export function findPublicTaskmarketSubmission(
  value: unknown,
  taskId: string,
  workerAddress: string,
  artifact: { role: string; fileName: string; sha256: string },
): UnknownRecord | null {
  const expectedTask = taskId.toLowerCase();
  const expectedWorker = workerAddress.toLowerCase();
  return rows(value).find((item) => {
    if (typeof item.taskId !== "string" || item.taskId.toLowerCase() !== expectedTask ||
      typeof item.workerAddress !== "string" || item.workerAddress.toLowerCase() !== expectedWorker ||
      typeof item.id !== "string" || !/^[a-f0-9-]{36}$/i.test(item.id) ||
      typeof item.submitTxHash !== "string" || !/^0x[a-f0-9]{64}$/i.test(item.submitTxHash) ||
      typeof item.deliverableHash !== "string" || !/^0x[a-f0-9]{64}$/i.test(item.deliverableHash) ||
      item.rejectedAt !== null || !Array.isArray(item.artifacts)) return false;
    const exactArtifacts = item.artifacts.map(record).filter((candidate): candidate is UnknownRecord =>
      candidate !== null && candidate.taskId === item.taskId && candidate.submissionId === item.id &&
      typeof candidate.workerAddress === "string" && candidate.workerAddress.toLowerCase() === expectedWorker &&
      candidate.role === artifact.role && candidate.fileName === artifact.fileName &&
      typeof candidate.sha256Hash === "string" && candidate.sha256Hash.toLowerCase() === artifact.sha256.toLowerCase()
    );
    return exactArtifacts.length === 1;
  }) || null;
}

export type TaskmarketRetryGate =
  | { eligible: true; expiryTime: string }
  | { eligible: false; terminal: boolean; reason: string; expiryTime: string | null };

export function taskmarketRetryGate(value: unknown, taskId: string, now = Date.now()): TaskmarketRetryGate {
  const task = record(value);
  if (!task || typeof task.id !== "string" || task.id.toLowerCase() !== taskId.toLowerCase()) {
    return { eligible: false, terminal: false, reason: "task_identity_unavailable", expiryTime: null };
  }
  const expiryTime = typeof task.expiryTime === "string" ? task.expiryTime : null;
  const expiryMs = expiryTime === null ? Number.NaN : Date.parse(expiryTime);
  if (!expiryTime || !Number.isFinite(expiryMs)) {
    return { eligible: false, terminal: false, reason: "task_expiry_unavailable", expiryTime };
  }
  if (now >= expiryMs) {
    return { eligible: false, terminal: true, reason: "task_expired", expiryTime };
  }
  if (task.status !== "open" || task.submissionWindowOpen !== true) {
    return {
      eligible: false,
      terminal: task.status !== "open",
      reason: task.status === "open" ? "submission_window_closed" : `task_${String(task.status || "not_open")}`,
      expiryTime,
    };
  }
  return { eligible: true, expiryTime };
}

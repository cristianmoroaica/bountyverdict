import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";

const repository = "https://github.com/cristianmoroaica/bountyverdict";
const agentToolUrl = "https://agenttool.sh/tools/bountyverdict-agent-decision-apis";
const skillsUrl = "https://skills.sh/cristianmoroaica/bountyverdict";
const stateFile = process.env.DIRECTORY_STATE_FILE || `${homedir()}/.local/state/bountyverdict/directories.json`;
const timeoutMs = 30_000;

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function pageStatus(url: string, expected: string): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(url, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.text();
    return {
      url,
      http_status: response.status,
      listed: response.ok && body.includes(expected) && !body.toLowerCase().includes("not found"),
    };
  } catch (error) {
    return {
      url,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function agentToolStatus(): Promise<Record<string, unknown>> {
  const apiUrl = "https://agenttool.sh/api/tools/bountyverdict-agent-decision-apis";
  try {
    const response = await fetch(apiUrl, { signal: AbortSignal.timeout(timeoutMs) });
    return {
      url: agentToolUrl,
      api_url: apiUrl,
      http_status: response.status,
      listed: response.ok,
      status: response.ok ? "listed" : response.status === 404 ? "scanning" : "unexpected_response",
    };
  } catch (error) {
    return {
      url: agentToolUrl,
      api_url: apiUrl,
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

async function submitAgentSkill(): Promise<Record<string, unknown>> {
  try {
    const response = await fetch("https://agentskill.sh/api/skills/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: repository }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const payload = await response.json() as {
      success?: boolean;
      data?: { summary?: { found?: number; imported?: number; updated?: number; failed?: number } };
    };
    const summary = payload.data?.summary || {};
    const listed = response.ok && payload.success === true && summary.found === 7 && summary.failed === 0;
    return {
      url: "https://agentskill.sh/submit",
      http_status: response.status,
      listed,
      status: listed ? "accepted" : "upstream_blocked",
      summary,
    };
  } catch (error) {
    return {
      url: "https://agentskill.sh/submit",
      listed: false,
      status: "request_failed",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

let previous: Record<string, any> = {};
try {
  previous = JSON.parse(await readFile(stateFile, "utf8"));
} catch (error) {
  if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
}

const [skills, agenttool] = await Promise.all([
  pageStatus(skillsUrl, "bountyverdict"),
  agentToolStatus(),
]);
const agentskill = previous.agentskill?.listed === true
  ? previous.agentskill
  : await submitAgentSkill();
const state = {
  checked_at: new Date().toISOString(),
  repository,
  skills_sh: skills,
  agenttool,
  agentskill,
  x402scan: {
    url: "https://www.x402scan.com/resources/register",
    listed: false,
    status: "wallet_authenticated_registration_unavailable_to_automation",
  },
};
await atomicWrite(stateFile, `${JSON.stringify(state, null, 2)}\n`);
console.log(JSON.stringify(state, null, 2));

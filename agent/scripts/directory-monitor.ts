import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { homedir } from "node:os";
import { parseSkillsShInstallCounts } from "../src/acquisition.ts";

const repository = "https://github.com/cristianmoroaica/bountyverdict";
const agentToolUrl = "https://agenttool.sh/tools/bountyverdict-agent-decision-apis";
const skillsUrl = "https://skills.sh/cristianmoroaica/bountyverdict";
const securityDirectoryPrUrl = "https://github.com/LLMSecurity/awesome-agent-skills-security/pull/38";
const x402DirectoryPrUrl = "https://github.com/xpaysh/awesome-x402/pull/934";
const stateFile = process.env.DIRECTORY_STATE_FILE || `${homedir()}/.local/state/bountyverdict/directories.json`;
const timeoutMs = 30_000;
const agentSkillRetryMs = 20 * 60 * 60 * 1000;

async function atomicWrite(path: string, contents: string): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporary = `${path}.${process.pid}.tmp`;
  await writeFile(temporary, contents, { mode: 0o600 });
  await rename(temporary, path);
}

async function skillsShStatus(): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(skillsUrl, { signal: AbortSignal.timeout(timeoutMs) });
    const body = await response.text();
    const listed = response.ok && body.includes("bountyverdict") && !body.toLowerCase().includes("not found");
    if (!listed) return { url: skillsUrl, http_status: response.status, listed };
    try {
      const installs = parseSkillsShInstallCounts(body);
      return {
        url: skillsUrl,
        http_status: response.status,
        listed: true,
        total_installs: installs.total,
        install_counts: installs.by_skill,
        measurement: "anonymous_cli_install_telemetry_not_customer_purchases",
      };
    } catch (error) {
      return {
        url: skillsUrl,
        http_status: response.status,
        listed: true,
        measurement: "unavailable",
        measurement_error: error instanceof Error ? error.message : String(error),
      };
    }
  } catch (error) {
    return {
      url: skillsUrl,
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

async function githubPrStatus(
  owner: string,
  repo: string,
  pull: number,
  url: string,
): Promise<Record<string, unknown>> {
  try {
    const response = await fetch(`https://api.github.com/repos/${owner}/${repo}/pulls/${pull}`, {
      headers: {
        Accept: "application/vnd.github+json",
        "User-Agent": "bountyverdict-directory-monitor",
        "X-GitHub-Api-Version": "2022-11-28",
      },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!response.ok) {
      return { url, http_status: response.status, status: "unexpected_response" };
    }
    const payload = await response.json() as {
      state?: string;
      merged_at?: string | null;
      draft?: boolean;
      mergeable?: boolean | null;
    };
    return {
      url,
      http_status: response.status,
      status: payload.merged_at ? "merged" : payload.state || "unknown",
      merged_at: payload.merged_at || null,
      draft: payload.draft === true,
      mergeable: payload.mergeable,
    };
  } catch (error) {
    return {
      url,
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
      attempted_at: new Date().toISOString(),
      http_status: response.status,
      listed,
      status: listed ? "accepted" : "upstream_blocked",
      summary,
    };
  } catch (error) {
    return {
      url: "https://agentskill.sh/submit",
      attempted_at: new Date().toISOString(),
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

const [skills, agenttool, securityDirectoryPr, x402DirectoryPr] = await Promise.all([
  skillsShStatus(),
  agentToolStatus(),
  githubPrStatus("LLMSecurity", "awesome-agent-skills-security", 38, securityDirectoryPrUrl),
  githubPrStatus("xpaysh", "awesome-x402", 934, x402DirectoryPrUrl),
]);
const previousAttempt = Date.parse(String(previous.agentskill?.attempted_at || previous.checked_at || ""));
const agentSkillRetryDue = !Number.isFinite(previousAttempt) || Date.now() - previousAttempt >= agentSkillRetryMs;
const agentskill = previous.agentskill?.listed === true
  ? previous.agentskill
  : agentSkillRetryDue
    ? await submitAgentSkill()
    : {
        ...previous.agentskill,
        retry_deferred: true,
        retry_after: new Date(previousAttempt + agentSkillRetryMs).toISOString(),
      };
const state = {
  checked_at: new Date().toISOString(),
  repository,
  skills_sh: skills,
  agenttool,
  agentskill,
  security_directory_pr: securityDirectoryPr,
  x402_directory_pr: x402DirectoryPr,
  x402scan: {
    url: "https://www.x402scan.com/resources/register",
    listed: false,
    status: "wallet_authenticated_registration_unavailable_to_automation",
  },
};
await atomicWrite(stateFile, `${JSON.stringify(state, null, 2)}\n`);
console.log(JSON.stringify(state, null, 2));

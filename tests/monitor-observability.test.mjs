import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const distributionUrl = new URL("../agent/scripts/distribution-monitor.ts", import.meta.url);
const auditedRunnerUrl = new URL("../agent/scripts/run-audited-monitor.ts", import.meta.url);
const directoryMonitorUrl = new URL("../agent/scripts/directory-monitor.ts", import.meta.url);
const acquisitionUrl = new URL("../agent/src/acquisition.ts", import.meta.url);

test("frequent reporting samples merchant activity without semantic retrieval while full audits establish a drain", async () => {
  const distribution = await readFile(distributionUrl, "utf8");
  const auditedRunner = await readFile(auditedRunnerUrl, "utf8");
  assert.match(distribution, /const reportOnly = process\.env\.REPORT_ONLY === "YES"/);
  assert.match(distribution, /if \(reportOnly\) \{[\s\S]+merchantDiscoveryStatus\(previousReport\.discovery \|\| \{\}, checkedAt\)[\s\S]+\} else \{\s+try \{\s+discovery = await discoveryStatus/);
  assert.match(distribution, /marketplace_search: previousReport\.acquisition\?\.marketplace_search/);
  assert.match(distribution, /agenticMarket = previousReport\.marketplaces\?\.agentic_market/);
  assert.match(auditedRunner, /FUNNEL_ROTATION_ID: rotationId/);
  assert.match(auditedRunner, /if \(monitor === "directory"\).*directory-monitor/s);
  assert.match(auditedRunner, /else await import\("\.\/distribution-monitor\.ts"\)/);
});

test("directory monitoring retains public AgentSkill and GitHub Skill conversion signals", async () => {
  const [directory, acquisition] = await Promise.all([
    readFile(directoryMonitorUrl, "utf8"),
    readFile(acquisitionUrl, "utf8"),
  ]);
  assert.match(directory, /parseAgentSkillSearchPayload/);
  assert.match(directory, /metric_history: mergeAgentSkillHistory/);
  assert.match(directory, /total_installs/);
  assert.match(acquisition, /security_score/);
  assert.match(acquisition, /content_quality_score/);
  assert.match(directory, /execFileAsync\("gh", \[\s*"skill", "search"/s);
  assert.match(directory, /one_rotating_owner_run_exact_github_code_search_per_hour/);
  assert.match(directory, /github_skill: githubSkill/);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const distributionUrl = new URL("../agent/scripts/distribution-monitor.ts", import.meta.url);
const auditedRunnerUrl = new URL("../agent/scripts/run-audited-monitor.ts", import.meta.url);

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

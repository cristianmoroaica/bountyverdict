import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const expectedCopilotSkills = [
  "./skills/preflight-github-bounties/",
  "./skills/audit-agent-harness/",
  "./skills/diagnose-github-actions/",
  "./skills/classify-github-flakes/",
  "./skills/check-mcp-tool-drift/",
];

test("plugin manifests expose the existing engineering gates without changing SkillVerdict's experiment", async () => {
  const codex = JSON.parse(await readFile(new URL("../.codex-plugin/plugin.json", import.meta.url), "utf8"));
  const copilot = JSON.parse(await readFile(new URL("../.github/plugin/plugin.json", import.meta.url), "utf8"));

  assert.equal(codex.name, "bountyverdict");
  assert.equal(copilot.name, codex.name);
  assert.equal(copilot.version, codex.version);
  assert.equal(copilot.license, "MIT");
  assert.deepEqual(copilot.skills, expectedCopilotSkills);
  assert.ok(copilot.description.includes("x402"));
  assert.ok(!copilot.skills.some((path) => path.includes("preflight-agent-skills")));
  assert.ok(!copilot.skills.some((path) => path.includes("route-github-agent-checks")));

  for (const path of copilot.skills) {
    const source = await readFile(new URL(`../${path}SKILL.md`, import.meta.url), "utf8");
    assert.match(source, /^---\nname: [a-z0-9-]+\ndescription: /);
    assert.match(source, /x402/i);
  }
});

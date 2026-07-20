import assert from "node:assert/strict";
import test from "node:test";
import { parseSkillsShInstallCounts, PUBLISHED_SKILLS } from "../src/acquisition.ts";

test("skills.sh acquisition parser requires and totals every published skill", () => {
  const html = PUBLISHED_SKILLS.map((skill, index) =>
    `<a href="/cristianmoroaica/bountyverdict/${skill}"><h3>${skill}</h3><span class="count">${index === 0 ? "2" : "1"}</span></a>`
  ).join("");
  const parsed = parseSkillsShInstallCounts(html);
  assert.equal(parsed.total, 8);
  assert.equal(parsed.by_skill["route-github-agent-checks"], 2);
  assert.equal(parsed.by_skill["preflight-agent-skills"], 1);
});

test("skills.sh acquisition parser fails closed on partial or malformed telemetry", () => {
  assert.throws(() => parseSkillsShInstallCounts("<html></html>"), /route-github-agent-checks/);
  const html = PUBLISHED_SKILLS.map((skill) =>
    `<a href="/cristianmoroaica/bountyverdict/${skill}"><span>1</span></a>`
  ).join("").replace(">1</span>", ">not-a-number</span>");
  assert.throws(() => parseSkillsShInstallCounts(html), /route-github-agent-checks/);
});

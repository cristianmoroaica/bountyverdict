import assert from "node:assert/strict";
import test from "node:test";
import {
  parseSkillsMdSearchPayload,
  SKILLS_MD_ENTRY_ID,
  SKILLS_MD_REPOSITORY,
  SKILLS_MD_SKILL_NAME,
} from "../src/skillsmd.ts";

const exactEntry = {
  id: SKILLS_MD_ENTRY_ID,
  name: SKILLS_MD_SKILL_NAME,
  repo: SKILLS_MD_REPOSITORY,
  desc: "Route public GitHub decisions to six paid read-only x402 MCP tools.",
  installs: 0,
  stars: 0,
  forks: 0,
  language: null,
  tags: ["agent-skills", "mcp", "x402"],
  updated: "2026-07-21",
  trending: false,
  hot: false,
  change: 0,
};

test("recognizes only the exact SkillsMD adapter contract", () => {
  assert.deepEqual(parseSkillsMdSearchPayload({
    query: SKILLS_MD_SKILL_NAME,
    results: [exactEntry],
    total: 1,
  }), {
    listed: true,
    listed_skills: 1,
    expected_skills: 1,
    catalog_total: 1,
    installs: 0,
    stars: 0,
    forks: 0,
    tags: ["agent-skills", "mcp", "x402"],
    updated: "2026-07-21",
    status: "listed",
  });
  assert.equal(parseSkillsMdSearchPayload({
    query: SKILLS_MD_SKILL_NAME,
    results: [],
    total: 0,
  }).status, "pending_review");
  assert.equal(parseSkillsMdSearchPayload({
    query: SKILLS_MD_SKILL_NAME,
    results: [{ ...exactEntry, name: "wrong-name" }],
    total: 1,
  }).status, "contract_drift");
});

test("rejects duplicate, malformed, mismatched, and unbounded SkillsMD telemetry", () => {
  assert.throws(() => parseSkillsMdSearchPayload({
    query: SKILLS_MD_SKILL_NAME,
    results: [exactEntry, exactEntry],
    total: 2,
  }), /duplicated/);
  assert.throws(() => parseSkillsMdSearchPayload({
    query: "different-query",
    results: [],
    total: 0,
  }), /mismatched/);
  assert.throws(() => parseSkillsMdSearchPayload({
    query: SKILLS_MD_SKILL_NAME,
    results: [{ ...exactEntry, installs: -1 }],
    total: 1,
  }), /installs/);
  assert.throws(() => parseSkillsMdSearchPayload({
    query: SKILLS_MD_SKILL_NAME,
    results: "private",
    total: 0,
  }), /malformed/);
});

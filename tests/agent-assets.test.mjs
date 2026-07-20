import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const readJson = async (path) => JSON.parse(await readFile(new URL(path, import.meta.url), "utf8"));

test("agent manifest is honest and links inspectable products", async () => {
  const manifest = await readJson("../agent-manifest.json");
  assert.ok(["awaiting_production", "active"].includes(manifest.status));
  if (manifest.status === "awaiting_production") assert.equal(manifest.production_api, null);
  if (manifest.status === "active") assert.match(manifest.production_api, /^https:\/\//);
  assert.deepEqual(manifest.products.map((product) => product.price_usdc), ["0.05", "0.40"]);
  assert.match(manifest.skill, /\/SKILL\.md$/);
});

test("public samples remain valid JSON with the declared product contracts", async () => {
  const verdict = await readJson("../samples/verdict.json");
  const portfolio = await readJson("../samples/portfolio.json");
  assert.equal(verdict.product, "BountyVerdict");
  assert.ok(["AVOID", "CAUTION", "VIABLE"].includes(verdict.verdict));
  assert.equal(portfolio.product, "BountyVerdict Portfolio");
  assert.equal(portfolio.counts.checked, portfolio.ranked.length);
  assert.equal(portfolio.counts.failed, portfolio.failures.length);
});

test("hosted agent skill has valid minimal frontmatter and safety gates", async () => {
  const skill = await readFile(
    new URL("../skills/preflight-github-bounties/SKILL.md", import.meta.url),
    "utf8",
  );
  assert.match(skill, /^---\nname: preflight-github-bounties\ndescription: .+\n---/);
  assert.match(skill, /awaiting_production/);
  assert.match(skill, /50000/);
  assert.match(skill, /400000/);
  assert.match(skill, /Never reveal wallet secrets/);
});

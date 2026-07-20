import test from "node:test";
import assert from "node:assert/strict";
import { createLlmsText, createOpenApi } from "../src/openapi.ts";

test("free self-evaluation surfaces advertise the paid contract", () => {
  const spec = createOpenApi("https://agent.example", "eip155:8453", {
    single: "$0.05",
    portfolio: "$0.40",
  });
  const operation = spec.paths["/api/verdict"].get;
  assert.equal(operation["x-x402"].price, "$0.05");
  assert.equal(operation["x-x402"].network, "eip155:8453");
  assert.ok(operation.parameters.some((parameter) => parameter.name === "issue_url"));
  assert.equal(spec.paths["/api/portfolio"].post["x-x402"].price, "$0.40");
  assert.equal(spec.paths["/api/portfolio"].post.requestBody.content["application/json"].schema.properties.issue_urls.maxItems, 10);
  assert.match(spec.externalDocs.url, /agent-manifest\.json$/);

  const llms = createLlmsText("https://agent.example");
  assert.match(llms, /\/api\/sample/);
  assert.match(llms, /\$0\.05 USDC/);
  assert.match(llms, /\$0\.40 USDC/);
  assert.match(llms, /preflight-github-bounties\/SKILL\.md/);
  assert.match(llms, /AI-work bans/);
});

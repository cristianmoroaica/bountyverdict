import test from "node:test";
import assert from "node:assert/strict";
import { createLlmsText, createOpenApi } from "../src/openapi.ts";

test("free self-evaluation surfaces advertise the paid contract", () => {
  const spec = createOpenApi("https://agent.example", "eip155:8453", "$0.05");
  const operation = spec.paths["/api/verdict"].get;
  assert.equal(operation["x-x402"].price, "$0.05");
  assert.equal(operation["x-x402"].network, "eip155:8453");
  assert.ok(operation.parameters.some((parameter) => parameter.name === "issue_url"));

  const llms = createLlmsText("https://agent.example");
  assert.match(llms, /\/api\/sample/);
  assert.match(llms, /\$0\.05 USDC/);
  assert.match(llms, /AI-work bans/);
});

import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { createLlmsText } from "../src/openapi.ts";

const productionApi = "https://bountyverdict-agent-production.mimirslab.workers.dev";
const publicFile = fileURLToPath(new URL("../../llms.txt", import.meta.url));
const expected = createLlmsText(productionApi);
const mode = process.argv[2] || "--check";

if (mode === "--write") {
  await writeFile(publicFile, expected, "utf8");
  console.log(`Updated ${publicFile}`);
} else if (mode === "--check") {
  const current = await readFile(publicFile, "utf8");
  if (current !== expected) {
    throw new Error("Public llms.txt differs from the Worker-generated contract. Run npm run sync:llms.");
  }
  console.log("Public and Worker llms.txt contracts match.");
} else {
  throw new Error("Use --check or --write.");
}

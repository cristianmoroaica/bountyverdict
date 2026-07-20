const api = "https://api.the402.ai/v1";
const apiKey = process.env.THE402_API_KEY;
const enabled = process.env.THE402_SUBSCRIBE === "YES";

if (!enabled) throw new Error("Set THE402_SUBSCRIBE=YES to enable request notifications.");
if (!apiKey || !/^sk_[A-Za-z0-9_-]{8,}$/.test(apiKey)) {
  throw new Error("THE402_API_KEY is missing or invalid.");
}

const response = await fetch(`${api}/postings/notifications`, {
  method: "PUT",
  redirect: "error",
  headers: { "X-API-Key": apiKey, "Content-Type": "application/json" },
  body: "{}",
  signal: AbortSignal.timeout(30_000),
});
if (!response.ok) throw new Error(`the402 notification subscription returned HTTP ${response.status}.`);
const result = await response.json() as Record<string, unknown>;
if (result.enabled !== true) throw new Error("the402 did not enable request notifications.");
console.log(JSON.stringify({ enabled: true, subscription: "request.created", filters: result.filters || null }, null, 2));

export {};

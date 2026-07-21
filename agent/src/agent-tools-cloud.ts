import { PRODUCT_CATALOG, type ProductKey } from "./product-catalog.ts";

export class AgentToolsCloudContractDrift extends Error {
  override readonly name = "AgentToolsCloudContractDrift";
}

type ExpectedResource = Readonly<{
  product: ProductKey;
  url: string;
}>;

type ParseOptions = Readonly<{
  productionOrigin: string;
  slug: string;
  revenueWallet: string;
  expectedResources: readonly ExpectedResource[];
}>;

function contractDrift(message: string): never {
  throw new AgentToolsCloudContractDrift(message);
}

export function parseAgentToolsCloudListing(
  search: Record<string, any>,
  detail: Record<string, any>,
  options: ParseOptions,
): Record<string, unknown> {
  const { productionOrigin, slug, revenueWallet, expectedResources } = options;
  if (!Number.isSafeInteger(search.count) || !Array.isArray(search.services) || search.count !== search.services.length ||
    search.services.some((service: unknown) => !service || typeof service !== "object" || Array.isArray(service))) {
    contractDrift("Agent Tools Cloud search telemetry is malformed.");
  }
  const matches = search.services.filter((service: Record<string, unknown>) => service.slug === slug);
  if (matches.length !== 1 || detail.slug !== slug || detail.url !== productionOrigin ||
    detail.name !== new URL(productionOrigin).host || detail.well_known_url !== `${productionOrigin}/.well-known/x402`) {
    contractDrift("Agent Tools Cloud identity telemetry drifted.");
  }

  if (!Array.isArray(detail.resource_samples) ||
    detail.resource_samples.some((sample: unknown) => !sample || typeof sample !== "object" || Array.isArray(sample))) {
    contractDrift("Agent Tools Cloud resource telemetry is malformed or contains an unknown route.");
  }
  const sampleValues = detail.resource_samples as Array<Record<string, unknown>>;
  const sampleUrls = sampleValues.map((sample: Record<string, unknown>) => sample.url);
  const expectedByUrl = new Map(expectedResources.map((resource) => [resource.url, resource]));
  if (!Number.isSafeInteger(detail.resource_count) || detail.resource_count !== sampleUrls.length ||
    new Set(sampleUrls).size !== sampleUrls.length || sampleUrls.some((url: unknown) => !expectedByUrl.has(String(url))) ||
    sampleValues.some((sample: Record<string, unknown>) => sample.kind !== "http")) {
    contractDrift("Agent Tools Cloud resource telemetry is malformed or contains an unknown route.");
  }

  const listedProducts = sampleUrls.map((url: unknown) => expectedByUrl.get(String(url))!);
  const listedPrices = listedProducts.map(({ product }) => Number(PRODUCT_CATALOG[product].priceUsd.slice(1)));
  const payment = detail.payment;
  if (!payment || typeof payment !== "object" || Array.isArray(payment) || payment.currency !== "USDC" ||
    typeof payment.pay_to !== "string" || payment.pay_to.toLowerCase() !== revenueWallet.toLowerCase() ||
    !Array.isArray(payment.chains) || payment.chains.length !== 1 || payment.chains[0] !== "eip155:8453" ||
    !listedPrices.length || Number(payment.price_min_usd) !== Math.min(...listedPrices) ||
    Number(payment.price_max_usd) !== Math.max(...listedPrices) ||
    detail.health !== "ok" || detail.http_status !== 200 || ![0, 1].includes(detail.x402_ok)) {
    contractDrift("Agent Tools Cloud health or payment telemetry drifted.");
  }

  const missing = expectedResources
    .filter(({ url }) => !sampleUrls.includes(url))
    .map(({ product }) => product);
  const probeOk = detail.x402_ok === 1;
  const description = String(detail.description || "");
  const descriptionCoverage = /bounty/i.test(description) && /instruction/i.test(description) &&
    /actions|workflow|CI/i.test(description) && /MCP/i.test(description)
    ? "suite_wide"
    : "narrow_or_incomplete";
  const status = probeOk
    ? (missing.length ? "listed_partial" : "listed")
    : (missing.length ? "listed_partial_probe_failed" : "listed_probe_failed");

  return {
    listed: true,
    status,
    health: detail.health,
    latency_ms: Number.isFinite(detail.latency_ms) ? detail.latency_ms : null,
    http_status: detail.http_status,
    expected_resources: expectedResources.length,
    listed_resources: sampleUrls.length,
    listed_resource_urls: sampleUrls,
    missing_products: missing,
    x402_probe_ok: probeOk,
    x402_probe_status: probeOk ? "passed" : "failed",
    description_coverage: descriptionCoverage,
    payment: {
      currency: payment.currency,
      chains: payment.chains,
      pay_to: payment.pay_to,
      price_min_usd: payment.price_min_usd,
      price_max_usd: payment.price_max_usd,
    },
    checked_at_unix: detail.health_checked,
    last_seen_unix: detail.last_seen,
    measurement: "organic_catalog_health_and_resource_presence_not_impressions_purchases_or_revenue",
  };
}

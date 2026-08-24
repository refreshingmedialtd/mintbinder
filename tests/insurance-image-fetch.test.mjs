import assert from "node:assert/strict";
import test from "node:test";
import { fetchInsuranceReportImage } from "../src/lib/reports/insurance-pdf.ts";

test("insurance images never follow an allowlisted redirect to a private address", async () => {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    requests.push({ input: String(input), redirect: init?.redirect });
    return new Response(null, {
      status: 302,
      headers: { location: "http://127.0.0.1/latest/meta-data" },
    });
  };

  try {
    const response = await fetchInsuranceReportImage("https://images.pokemontcg.io/base1/4_hires.png");
    assert.equal(response, null);
    assert.deepEqual(requests, [{
      input: "https://images.pokemontcg.io/base1/4_hires.png",
      redirect: "manual",
    }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

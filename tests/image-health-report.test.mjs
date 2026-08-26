import assert from "node:assert/strict";
import test from "node:test";
import {
  buildImageHealthReport,
  probeImageUrl,
} from "../scripts/report-image-health.mjs";

test("separates catalogue URL presence from bounded reachability verification", () => {
  const report = buildImageHealthReport({
    counts: [
      { kind: "card", total: 100, urlPresent: 80 },
      { kind: "sealed", total: 10, urlPresent: 10 },
    ],
    generatedAt: new Date("2026-08-26T12:00:00Z"),
    probes: [
      { id: "card-1", imageResponse: true, kind: "card", reachable: true, url: "https://images.example/1.png" },
      { id: "card-2", imageResponse: false, kind: "card", reachable: false, reason: "http_error", status: 404, url: "https://images.example/2.png" },
      { id: "sealed-1", imageResponse: true, kind: "sealed", reachable: true, url: "https://images.example/3.png" },
    ],
  });

  assert.equal(report.ok, false);
  assert.equal(report.kinds[0].urlPresentPercent, 80);
  assert.equal(report.kinds[0].verifiedReachableSamplePercent, 50);
  assert.equal(report.verification.scope, "sample");
  assert.match(report.verification.explanation, /must not be read as full-catalogue/);
});

test("probes a byte-range response and verifies image content type", async () => {
  let requested;
  const result = await probeImageUrl({
    fetchImpl: async (url, options) => {
      requested = { options, url };
      return {
        body: { cancel: async () => undefined },
        headers: { get: () => "image/png" },
        ok: true,
        status: 206,
      };
    },
    id: "card-1",
    kind: "card",
    url: "https://images.pokemontcg.io/card.png",
  });

  assert.equal(requested.options.headers.range, "bytes=0-0");
  assert.equal(requested.options.redirect, "manual");
  assert.equal(result.reachable, true);
  assert.equal(result.imageResponse, true);
});

test("rejects invalid URLs without making a request", async () => {
  const result = await probeImageUrl({
    fetchImpl: async () => assert.fail("unexpected fetch"),
    id: "card-1",
    kind: "card",
    url: "not a URL",
  });

  assert.equal(result.reachable, false);
  assert.equal(result.reason, "invalid_url");
});

test("rejects unreviewed and internal image hosts without making a request", async () => {
  for (const url of [
    "https://example.com/card.png",
    "http://127.0.0.1/private.png",
    "https://169.254.169.254/latest/meta-data",
  ]) {
    const result = await probeImageUrl({
      fetchImpl: async () => assert.fail("unexpected fetch"),
      id: "card-1",
      kind: "card",
      url,
    });

    assert.equal(result.reachable, false);
    assert.ok(["unapproved_host", "unsupported_protocol"].includes(result.reason));
  }
});

test("does not follow redirects from an approved image host", async () => {
  let options;
  const result = await probeImageUrl({
    fetchImpl: async (_url, requestOptions) => {
      options = requestOptions;
      return {
        body: { cancel: async () => undefined },
        headers: { get: () => "" },
        ok: false,
        status: 302,
      };
    },
    id: "card-1",
    kind: "card",
    url: "https://images.pokemontcg.io/redirect.png",
  });

  assert.equal(options.redirect, "manual");
  assert.equal(result.reachable, false);
  assert.equal(result.reason, "redirect_not_allowed");
});

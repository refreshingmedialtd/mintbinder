import assert from "node:assert/strict";
import test from "node:test";
import { fetchWithPolicy, ProviderRequestError } from "../src/lib/http/fetch-with-policy.ts";

test("provider timeout remains active while a response body is stalled", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (_input, init) => {
    const body = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode('{"partial":'));
        init?.signal?.addEventListener("abort", () => controller.error(new Error("aborted")), { once: true });
      },
    });
    return new Response(body, { status: 200, headers: { "content-type": "application/json" } });
  };

  try {
    const started = Date.now();
    await assert.rejects(
      fetchWithPolicy("https://provider.example/data", { method: "GET" }, {
        provider: "Test provider",
        retryAttempts: 0,
        timeoutMs: 25,
      }),
      ProviderRequestError,
    );
    assert.ok(Date.now() - started < 1_000);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider body buffering enforces a hard byte ceiling", async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response("123456", { status: 200 });

  try {
    await assert.rejects(
      fetchWithPolicy("https://provider.example/data", { method: "GET" }, {
        maxResponseBytes: 5,
        provider: "Test provider",
        retryAttempts: 0,
      }),
      ProviderRequestError,
    );
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("provider buffering rejects an oversized declared body before reading it", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() { cancelled = true; },
    start() {},
  });

  await assert.rejects(
    fetchWithPolicy("https://provider.example/data", { method: "GET" }, {
      fetchImpl: async () => new Response(body, {
        headers: { "content-length": "5000" },
        status: 200,
      }),
      maxResponseBytes: 5,
      provider: "Test provider",
      retryAttempts: 0,
    }),
    ProviderRequestError,
  );
  assert.equal(cancelled, true);
});

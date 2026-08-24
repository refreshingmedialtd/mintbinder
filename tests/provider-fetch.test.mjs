import assert from "node:assert/strict";
import test from "node:test";
import {
  fetchJsonWithRetry,
  ProviderFetchError,
  retryAfterMilliseconds,
  retryDelayMilliseconds,
} from "../scripts/provider-fetch.mjs";

test("retries transient provider failures and validates the eventual JSON payload", async () => {
  let calls = 0;
  const result = await fetchJsonWithRetry({
    fetchImpl: async () => {
      calls += 1;

      return jsonResponse(calls === 1 ? { success: false } : { success: true }, calls === 1 ? 502 : 200);
    },
    provider: "Example",
    random: () => 0,
    retryAttempts: 3,
    retryWaitMs: 0,
    url: "https://example.com/data",
    validate: (body) => body?.success === true,
  });

  assert.equal(calls, 2);
  assert.equal(result.attempts, 2);
  assert.deepEqual(result.body, { success: true });
});

test("does not retry a non-transient client error", async () => {
  let calls = 0;

  await assert.rejects(
    fetchJsonWithRetry({
      fetchImpl: async () => {
        calls += 1;
        return jsonResponse({ error: "bad request" }, 400);
      },
      retryAttempts: 3,
      url: "https://example.com/data",
    }),
    (error) => error instanceof ProviderFetchError && error.status === 400,
  );
  assert.equal(calls, 1);
});

test("rejects a response whose declared Content-Length exceeds the byte limit", async () => {
  let calls = 0;

  await assert.rejects(
    fetchJsonWithRetry({
      fetchImpl: async () => {
        calls += 1;
        return new Response("{}", {
          headers: {
            "content-length": "1025",
            "content-type": "application/json",
          },
          status: 200,
        });
      },
      maxResponseBytes: 1_024,
      provider: "Declared-size provider",
      retryAttempts: 3,
      url: "https://example.com/data",
    }),
    (error) => error instanceof ProviderFetchError &&
      error.status === 200 &&
      error.message === "Declared-size provider response exceeded the 1024-byte limit.",
  );

  assert.equal(calls, 1);
});

test("rejects a chunked response as soon as its streamed body exceeds the byte limit", async () => {
  let cancelled = false;
  const encoder = new TextEncoder();
  const chunks = [encoder.encode('{"payload":"'), encoder.encode("0123456789"), encoder.encode('"}')];
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
    pull(controller) {
      const chunk = chunks.shift();

      if (chunk) {
        controller.enqueue(chunk);
      } else {
        controller.close();
      }
    },
  });

  await assert.rejects(
    fetchJsonWithRetry({
      fetchImpl: async () => new Response(body, {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
      maxResponseBytes: 16,
      provider: "Chunked provider",
      retryAttempts: 1,
      url: "https://example.com/data",
    }),
    (error) => error instanceof ProviderFetchError &&
      error.message === "Chunked provider response exceeded the 16-byte limit.",
  );

  assert.equal(cancelled, true);
});

test("keeps the attempt timeout active while the response body is streaming", async () => {
  let cancelled = false;
  const body = new ReadableStream({
    cancel() {
      cancelled = true;
    },
    start(controller) {
      controller.enqueue(new TextEncoder().encode('{"waiting":'));
    },
  });

  await assert.rejects(
    fetchJsonWithRetry({
      fetchImpl: async () => new Response(body, {
        headers: { "content-type": "application/json" },
        status: 200,
      }),
      retryAttempts: 1,
      timeoutMs: 25,
      url: "https://example.com/data",
    }),
    (error) => error instanceof DOMException && error.name === "TimeoutError",
  );

  assert.equal(cancelled, true);
});

test("uses bounded jitter and respects Retry-After", () => {
  assert.equal(retryDelayMilliseconds({ attempt: 2, random: () => 0, retryWaitMs: 1_000 }), 1_500);
  assert.equal(retryDelayMilliseconds({
    attempt: 5,
    maxRetryWaitMs: 10_000,
    retryAfterMs: 30_000,
    retryWaitMs: 1_000,
  }), 10_000);
  assert.equal(retryAfterMilliseconds("2"), 2_000);
  assert.equal(
    retryAfterMilliseconds("Wed, 21 Oct 2026 07:28:00 GMT", Date.parse("2026-10-21T07:27:59.000Z")),
    1_000,
  );
});

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    headers: { "content-type": "application/json" },
    status,
  });
}

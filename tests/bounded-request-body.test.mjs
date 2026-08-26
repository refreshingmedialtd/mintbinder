import assert from "node:assert/strict";
import test from "node:test";
import {
  readBoundedTextBody,
  RequestBodyTooLargeError,
} from "../src/lib/http/bounded-request-body.ts";

test("bounded body preserves the exact UTF-8 payload used for webhook signatures", async () => {
  const payload = '{"event":"café"}';
  const request = new Request("https://example.test/webhook", { method: "POST", body: payload });
  assert.equal(await readBoundedTextBody(request, 1_024), payload);
});

test("bounded body rejects an oversized declared content length before reading", async () => {
  const request = new Request("https://example.test/webhook", {
    method: "POST",
    body: "small",
    headers: { "content-length": "2048" },
  });
  await assert.rejects(() => readBoundedTextBody(request, 1_024), RequestBodyTooLargeError);
});
test("bounded body rejects a streamed payload that crosses the limit", async () => {
  const request = new Request("https://example.test/webhook", { method: "POST", body: "x".repeat(1_025) });
  await assert.rejects(() => readBoundedTextBody(request, 1_024), RequestBodyTooLargeError);
});

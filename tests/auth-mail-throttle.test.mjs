import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("reset and verification mail use conservative hourly and daily recipient caps", async () => {
  const [limiter, resetRoute] = await Promise.all([
    readFile(new URL("../src/lib/auth/rate-limit.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/auth/password-reset/request/route.ts", import.meta.url), "utf8"),
  ]);
  assert.match(limiter, /MAIL_RECIPIENT_HOURLY_LIMIT = 3/);
  assert.match(limiter, /MAIL_RECIPIENT_DAILY_LIMIT = 6/);
  assert.match(limiter, /context\.action === "password-reset" \|\| context\.action === "verification"/);
  assert.match(resetRoute, /status: 202/);
  assert.match(resetRoute, /accepted: true/);
});

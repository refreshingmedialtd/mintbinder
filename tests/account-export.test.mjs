import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("account export requires a password-confirmed, throttled POST", async () => {
  const route = await readFile(new URL("../src/app/api/account/export/route.ts", import.meta.url), "utf8");

  assert.match(route, /export async function GET\(\)[\s\S]+status: 405/);
  assert.match(route, /export async function POST\(request: Request\)/);
  assert.match(route, /consumeAuthAttempt/);
  assert.match(route, /verifyPassword\(password, credentials\.passwordHash\)/);
  assert.match(route, /clearAuthFailures/);
  assert.match(route, /"cache-control": "no-store"/);
});

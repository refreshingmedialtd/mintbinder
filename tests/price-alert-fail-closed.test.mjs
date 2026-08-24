import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadRecipientDataFailClosed } from "../src/lib/notifications/fail-closed-recipient.ts";

test("a recipient data failure never reaches email delivery", async () => {
  let sends = 0;
  const result = await loadRecipientDataFailClosed({
    load: async () => { throw new Error("database unavailable"); },
    process: async () => { sends += 1; },
  });

  assert.equal(result.ok, false);
  assert.equal(sends, 0);
});

test("price-alert callers explicitly reject sample-data fallback", async () => {
  const [digest, route, appData] = await Promise.all([
    readFile(new URL("../src/lib/notifications/price-alerts.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/alerts/price/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/db/app-data.ts", import.meta.url), "utf8"),
  ]);

  assert.match(digest, /catalogueScope:\s*"referenced",\s*fallback:\s*"throw"/);
  assert.match(route, /catalogueScope:\s*"referenced",\s*fallback:\s*"throw"/);
  assert.match(
    appData,
    /getNotificationPreferences\(userId,\s*\{\s*fallback:\s*fallback === "throw" \? "throw" : "default"/,
  );
});

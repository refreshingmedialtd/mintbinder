import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { smtpSecurityOptions } from "../scripts/smtp-policy.mjs";

test("SMTP port 465 uses implicit TLS and port 587 requires STARTTLS", () => {
  assert.deepEqual(smtpSecurityOptions("465", "true"), {
    requireTLS: false,
    secure: true,
    tls: { minVersion: "TLSv1.2" },
  });
  assert.deepEqual(smtpSecurityOptions("587", "false"), {
    requireTLS: true,
    secure: false,
    tls: { minVersion: "TLSv1.2" },
  });
  assert.throws(() => smtpSecurityOptions("587", "typo"), /exactly true or false/);
  assert.throws(() => smtpSecurityOptions("587", "true"), /must be true on port 465/);
});

test("app, monitor, and smoke transports all apply the enforced TLS policy", async () => {
  const sources = await Promise.all([
    "../src/lib/notifications/email.ts",
    "../scripts/monitor-job-runs.mjs",
    "../scripts/smoke-email.mjs",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

  assert.equal(sources.every((source) => /smtpSecurityOptions\(/.test(source)), true);
});

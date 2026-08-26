import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import { jobErrorResultPayload } from "../src/lib/jobs/error-payload.ts";
import { jobRunHeartbeatIntervalMs } from "../src/lib/jobs/lease-policy.mjs";
import { isJobRunType } from "../src/lib/jobs/types.ts";

test("recognizes supported job run types", () => {
  assert.equal(isJobRunType("billing_checkout_retirement"), true);
  assert.equal(isJobRunType("password_reset_delivery"), true);
  assert.equal(isJobRunType("price_alerts"), true);
  assert.equal(isJobRunType("catalogue_refresh"), true);
  assert.equal(isJobRunType("pricing_refresh"), true);
  assert.equal(isJobRunType("sealed_pricing_refresh"), true);
  assert.equal(isJobRunType("unknown"), false);
  assert.equal(isJobRunType(null), false);
});

test("extracts structured result payloads from job errors", () => {
  assert.deepEqual(
    jobErrorResultPayload({
      resultPayload: {
        nextPage: 54,
        pagesProcessed: 18,
      },
    }),
    {
      nextPage: 54,
      pagesProcessed: 18,
    },
  );

  assert.deepEqual(jobErrorResultPayload(new Error("No payload")), {});
  assert.deepEqual(jobErrorResultPayload({ resultPayload: "not structured" }), {});
});

test("renews a job lease three times before it can expire", () => {
  assert.equal(jobRunHeartbeatIntervalMs(45), 15 * 60 * 1_000);
  assert.equal(jobRunHeartbeatIntervalMs(1), 20_000);
  assert.equal(jobRunHeartbeatIntervalMs(Number.NaN), 15 * 60 * 1_000);
});

test("stale repair and completion preserve an active heartbeat lease", () => {
  const repairScript = readFileSync(
    new URL("../scripts/repair-stale-job-runs.mjs", import.meta.url),
    "utf8",
  );
  const jobRuns = readFileSync(new URL("../src/lib/jobs/runs.ts", import.meta.url), "utf8");

  assert.equal(
    (repairScript.match(/result_payload->>'heartbeatEpochMs'/g) ?? []).length,
    4,
    "both stale selection and conditional repair must use the heartbeat lease",
  );
  assert.match(repairScript, /WHERE id = \$\{run\.id\}::uuid[\s\S]*?AND status = 'running'/);
  assert.equal(
    (jobRuns.match(/WHERE id = \$\{id\}::uuid\s+AND status = 'running'/g) ?? []).length,
    3,
    "heartbeat, completion, and failure updates must be restricted to RUNNING rows",
  );
});

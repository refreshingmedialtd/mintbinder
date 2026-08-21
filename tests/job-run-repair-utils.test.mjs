import assert from "node:assert/strict";
import test from "node:test";
import { boundedJobDurationMs } from "../scripts/job-run-repair-utils.mjs";

test("caps month-old job durations to PostgreSQL INT4 while preserving actual elapsed time", () => {
  const duration = boundedJobDurationMs(
    new Date("2026-07-22T10:00:00.000Z"),
    new Date("2026-08-21T10:00:00.000Z"),
  );

  assert.deepEqual(duration, {
    actualDurationMs: 2_592_000_000,
    durationMs: 2_147_483_647,
    durationWasCapped: true,
  });
});

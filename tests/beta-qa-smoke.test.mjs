import assert from "node:assert/strict";
import test from "node:test";
import {
  betaQaChecks,
  evaluateRouteResult,
} from "../scripts/beta-qa-smoke.mjs";

test("accepts protected route responses with the expected auth error", () => {
  const check = betaQaChecks.find((entry) => entry.id === "app-data-auth-required");
  const result = evaluateRouteResult(check, {
    contentType: "application/json",
    status: 401,
    text: JSON.stringify({ error: "Authentication required." }),
  });

  assert.equal(result.ok, true);
  assert.equal(result.problems.length, 0);
});

test("accepts job routes when the job secret is missing or rejected", () => {
  const check = betaQaChecks.find((entry) => entry.id === "catalogue-status-job-secret-required");

  assert.equal(
    evaluateRouteResult(check, {
      contentType: "application/json",
      status: 501,
      text: JSON.stringify({ error: "JOB_SECRET is not configured." }),
    }).ok,
    true,
  );
  assert.equal(
    evaluateRouteResult(check, {
      contentType: "application/json",
      status: 401,
      text: JSON.stringify({ error: "Job authentication failed." }),
    }).ok,
    true,
  );
});

test("reports missing shell content and unexpected statuses", () => {
  const check = betaQaChecks.find((entry) => entry.id === "app-shell");
  const result = evaluateRouteResult(check, {
    contentType: "text/html",
    status: 500,
    text: "<html></html>",
  });

  assert.equal(result.ok, false);
  assert.deepEqual(result.problems, [
    "Expected status 200, got 500.",
    'Response body did not include "Mint Binder".',
  ]);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  assertBrowserQaTargetAllowed,
  createBrowserQaIdentity,
  isBrowserQaFixtureIdentity,
  isLoopbackBrowserQaUrl,
  normalizeBrowserQaBaseUrl,
  parseBrowserQaBoolean,
} from "../scripts/authenticated-browser-qa-policy.mjs";

test("normalizes absolute HTTP base URLs without widening their target", () => {
  assert.equal(normalizeBrowserQaBaseUrl(" HTTP://LOCALHOST:3000/// "), "http://localhost:3000");
  assert.throws(() => normalizeBrowserQaBaseUrl("https://example.com/qa/"), /root path/);
  assert.throws(() => normalizeBrowserQaBaseUrl("localhost:3000"), /valid absolute URL/);
  assert.throws(() => normalizeBrowserQaBaseUrl("file:///tmp/app"), /HTTP or HTTPS/);
  assert.throws(() => normalizeBrowserQaBaseUrl("https://user:pass@example.com"), /credentials/);
  assert.throws(() => normalizeBrowserQaBaseUrl("https://example.com?target=local"), /query string or fragment/);
});

test("distinguishes loopback targets from every non-loopback target", () => {
  for (const value of [
    "http://localhost:3000",
    "http://app.localhost:3000",
    "http://127.0.0.1",
    "http://127.255.255.254:8080",
    "http://[::1]:3000",
  ]) {
    assert.equal(isLoopbackBrowserQaUrl(value), true, value);
  }

  for (const value of ["https://mintbinder.example", "http://10.0.0.4", "http://0.0.0.0"]) {
    assert.equal(isLoopbackBrowserQaUrl(value), false, value);
  }
});

test("non-loopback QA requires an explicit production opt-in", () => {
  assert.equal(
    assertBrowserQaTargetAllowed("http://127.0.0.1:3000/"),
    "http://127.0.0.1:3000",
  );
  assert.throws(
    () => assertBrowserQaTargetAllowed("https://mintbinder.example"),
    /AUTHENTICATED_QA_ALLOW_PRODUCTION=true/,
  );
  assert.throws(
    () => assertBrowserQaTargetAllowed("https://mintbinder.example", "yes"),
    /exactly true or false/,
  );
  assert.throws(
    () => assertBrowserQaTargetAllowed("http://mintbinder.example", true),
    /requires HTTPS/,
  );
  assert.equal(
    assertBrowserQaTargetAllowed("https://mintbinder.example/", true),
    "https://mintbinder.example",
  );
});

test("boolean parsing is explicit and rejects truthy configuration typos", () => {
  assert.equal(parseBrowserQaBoolean(undefined), false);
  assert.equal(parseBrowserQaBoolean(undefined, true), true);
  assert.equal(parseBrowserQaBoolean(true), true);
  assert.equal(parseBrowserQaBoolean(" TRUE "), true);
  assert.equal(parseBrowserQaBoolean("false"), false);
  for (const value of ["1", "yes", "on", 1, {}]) {
    assert.throws(() => parseBrowserQaBoolean(value), /exactly true or false/);
  }
});

test("fixture identity requires both the run-scoped email and display-name marker", () => {
  const identity = createBrowserQaIdentity(" 2026-09-06-a1b2 ");
  const { displayName, email, runId } = identity;

  assert.equal(runId, "2026-09-06-a1b2");
  assert.equal(email, "browser-qa-2026-09-06-a1b2@mintbinder.invalid");
  assert.match(displayName, /\[browser-qa-run:2026-09-06-a1b2\]/);
  assert.equal(isBrowserQaFixtureIdentity({ ...identity, email: email.toUpperCase() }), true);
  assert.equal(isBrowserQaFixtureIdentity({ email, displayName }), true);
  assert.equal(isBrowserQaFixtureIdentity({ email, displayName: "Mint Binder browser QA" }), false);
  assert.equal(isBrowserQaFixtureIdentity({ email, displayName: `${displayName} copied` }), false);
  assert.equal(
    isBrowserQaFixtureIdentity({
      email: "browser-qa-another-run@mintbinder.invalid",
      displayName,
      runId,
    }),
    false,
  );
  assert.equal(
    isBrowserQaFixtureIdentity({
      email,
      displayName,
      runId: "2026-09-06-a1b23",
    }),
    false,
  );
});

test("run IDs cannot create ambiguous fixture addresses or markers", () => {
  for (const value of ["", "-run", "run-", "run_id", "run@example.com", "x".repeat(54)]) {
    assert.throws(() => createBrowserQaIdentity(value), /run ID/);
  }
});

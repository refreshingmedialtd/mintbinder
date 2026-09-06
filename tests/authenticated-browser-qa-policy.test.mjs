import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertBrowserQaTargetAllowed,
  browserQaRuntimeAttestation,
  createBrowserQaIdentity,
  filteredBrowserConsoleError,
  firstPartyRequestFailure,
  isBrowserQaFixtureIdentity,
  isExpectedBrowserRequestCancellation,
  isLoopbackBrowserQaUrl,
  normalizeBrowserQaBaseUrl,
  parseBrowserQaBoolean,
  runWithPrearmedWaiters,
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

test("remote QA requires authenticated attestation of an exact deployment commit", () => {
  const commit = "A".repeat(40);
  assert.deepEqual(
    browserQaRuntimeAttestation({
      baseUrl: "https://mintbinder.example",
      expectedCommit: commit,
      jobSecret: " job-secret ",
    }),
    { expectedCommit: commit.toLowerCase(), jobSecret: "job-secret" },
  );
  assert.throws(
    () => browserQaRuntimeAttestation({ baseUrl: "https://mintbinder.example", jobSecret: "secret" }),
    /AUTHENTICATED_QA_EXPECTED_COMMIT/,
  );
  assert.throws(
    () => browserQaRuntimeAttestation({ baseUrl: "https://mintbinder.example", expectedCommit: "a".repeat(40) }),
    /JOB_SECRET/,
  );
  assert.throws(
    () => browserQaRuntimeAttestation({
      baseUrl: "https://mintbinder.example",
      expectedCommit: "main",
      jobSecret: "secret",
    }),
    /40-character Git commit SHA/,
  );
});

test("loopback QA permits no attestation and rejects a commit without its secret", () => {
  assert.equal(
    browserQaRuntimeAttestation({ baseUrl: "http://127.0.0.1:3000" }),
    null,
  );
  assert.equal(
    browserQaRuntimeAttestation({ baseUrl: "http://localhost:3000", jobSecret: "secret" }),
    null,
  );
  assert.throws(
    () => browserQaRuntimeAttestation({
      baseUrl: "http://localhost:3000",
      expectedCommit: "b".repeat(40),
    }),
    /JOB_SECRET/,
  );
});

test("browser console diagnostics retain first-party and source-less errors only", () => {
  const baseUrl = "https://mintbinder.example";
  assert.deepEqual(
    filteredBrowserConsoleError({
      baseUrl,
      locationUrl: "https://mintbinder.example/_next/static/chunks/app.js",
      text: " App render failed ",
      type: "error",
    }),
    {
      message: "App render failed",
      source: "https://mintbinder.example/_next/static/chunks/app.js",
      type: "console:error",
    },
  );
  assert.deepEqual(
    filteredBrowserConsoleError({ baseUrl, locationUrl: "", text: "Unhandled client error", type: "error" }),
    { message: "Unhandled client error", type: "console:error" },
  );
  assert.equal(
    filteredBrowserConsoleError({
      baseUrl,
      locationUrl: "https://images.example/card.jpg",
      text: "Failed to load resource",
      type: "error",
    }),
    null,
  );
  assert.equal(
    filteredBrowserConsoleError({ baseUrl, locationUrl: "", text: "FYI", type: "warning" }),
    null,
  );
});

test("request-failure diagnostics retain first-party transport errors only", () => {
  const baseUrl = "https://mintbinder.example";
  assert.deepEqual(
    firstPartyRequestFailure({
      baseUrl,
      errorText: " net::ERR_CONNECTION_RESET ",
      method: "get",
      resourceType: "fetch",
      url: "https://mintbinder.example/api/app-data",
    }),
    {
      error: "net::ERR_CONNECTION_RESET",
      method: "GET",
      resourceType: "fetch",
      type: "requestfailed",
      url: "https://mintbinder.example/api/app-data",
    },
  );
  assert.equal(
    firstPartyRequestFailure({
      baseUrl,
      errorText: "net::ERR_ABORTED",
      method: "GET",
      resourceType: "image",
      url: "https://images.example/card.jpg",
    }),
    null,
  );
  assert.equal(
    firstPartyRequestFailure({ baseUrl, url: "not a URL" }),
    null,
  );
});

test("only idempotent browser-cancelled requests are non-actionable transport diagnostics", () => {
  assert.equal(isExpectedBrowserRequestCancellation({ error: "net::ERR_ABORTED", method: "GET" }), true);
  assert.equal(isExpectedBrowserRequestCancellation({ error: "net::ERR_ABORTED", method: "HEAD" }), true);
  assert.equal(isExpectedBrowserRequestCancellation({ error: "net::ERR_ABORTED", method: "POST" }), false);
  assert.equal(isExpectedBrowserRequestCancellation({ error: "net::ERR_CONNECTION_RESET", method: "GET" }), false);
});

test("pre-armed waiters are cancelled and settled when their trigger fails", async () => {
  const cancellations = [];
  const waiter = (name) => () => {
    let rejectWaiter;
    let settled = false;
    const promise = new Promise((_, reject) => {
      rejectWaiter = reject;
    });
    return {
      cancel() {
        if (settled) return;
        settled = true;
        cancellations.push(name);
        rejectWaiter(new Error(`${name} cancelled`));
      },
      promise,
    };
  };

  await assert.rejects(
    runWithPrearmedWaiters([waiter("response"), waiter("download")], async () => {
      throw new Error("button detached");
    }),
    /button detached/,
  );
  assert.deepEqual(cancellations, ["response", "download"]);
});

test("pre-armed waiters return every result after the trigger succeeds", async () => {
  const completedWaiter = (value) => () => ({ cancel() {}, promise: Promise.resolve(value) });
  assert.deepEqual(
    await runWithPrearmedWaiters([completedWaiter("response"), completedWaiter("download")], () => "clicked"),
    ["response", "download"],
  );
});

test("the browser journey fails fast on server faults and safely exercises a 360px viewport", async () => {
  const source = await readFile(new URL("../scripts/authenticated-browser-qa.mjs", import.meta.url), "utf8");

  assert.match(source, /response\.status\(\) >= 500/);
  assert.match(source, /page\.on\("requestfailed"/);
  assert.match(source, /firstPartyRequestFailures/);
  assert.doesNotMatch(source, /response\.status\(\) >= 400/);
  assert.match(source, /Promise\.race\(\[actionResult, diagnosticFailure\]\)/);
  assert.match(source, /dialog\.dismiss\(\)/);
  assert.doesNotMatch(source, /dialog\.accept\(\)/);
  assert.match(source, /viewport: \{ width: 360, height: 800 \}/);
});

test("the browser journey authenticates health attestation and uses cancellable event waiters", async () => {
  const source = await readFile(new URL("../scripts/authenticated-browser-qa.mjs", import.meta.url), "utf8");

  assert.match(source, /authorization: `Bearer \$\{runtimeAttestation\.jobSecret\}`/);
  assert.match(source, /health\.body\?\.build\?\.commit/);
  assert.match(source, /runWithPrearmedWaiters/);
  assert.doesNotMatch(source, /page\.waitFor(?:Event|Response)\(/);
});

test("the browser journey adds independent card and sealed fixtures after one-row exports", async () => {
  const source = await readFile(new URL("../scripts/authenticated-browser-qa.mjs", import.meta.url), "utf8");
  const csvAt = source.indexOf('step("Download and validate the collection CSV"');
  const archiveAt = source.indexOf('step("Download and inspect the secure account archive"');
  const directAddAt = source.indexOf('step("Add a second card directly without Wishlist conversion"');
  const sealedAddAt = source.indexOf('step("Add a priced sealed product and verify API persistence"');

  assert.ok(csvAt >= 0 && archiveAt > csvAt);
  assert.ok(directAddAt > archiveAt, "direct card mutation must not invalidate one-row export assertions");
  assert.ok(sealedAddAt > directAddAt, "sealed mutation must remain independent of the direct card add");
  assert.match(source, /addCatalogueSetFilter\(page\)/);
  assert.doesNotMatch(source, /getByLabel\("Set", \{ exact: true \}\)/);
  assert.match(source, /visibility: CatalogueVisibility\.GLOBAL/);
  assert.match(source, /condition, "Sealed"/);
  assert.match(source, /variant, "Factory sealed"/);
});

test("the browser journey verifies a manual custom-binder move through the server", async () => {
  const source = await readFile(new URL("../scripts/authenticated-browser-qa.mjs", import.meta.url), "utf8");

  assert.match(source, /Place lifted card into slot 2/);
  assert.match(source, /assertBinderItemAtSlot\(await serverBinderByName\(page, binderName\), collectionItemId, 1\)/);
  assert.match(source, /The custom binder did not retain its intentionally blank first pocket/);
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

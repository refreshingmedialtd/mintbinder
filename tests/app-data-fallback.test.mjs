import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  assertAppDataDatabaseConfigured,
  developmentSampleFallbackEnabled,
  resolveAppDataFallbackMode,
  shouldThrowAppDataReadError,
} from "../src/lib/db/app-data-fallback.ts";
import { databaseReadUnavailableResult } from "../src/lib/http/private-read-policy.ts";

test("strict app-data reads never substitute sample account data", async () => {
  assert.throws(
    () => assertAppDataDatabaseConfigured(undefined, "throw"),
    /DATABASE_URL is not configured/,
  );
  assert.doesNotThrow(() => assertAppDataDatabaseConfigured(undefined, "sample"));
  assert.equal(shouldThrowAppDataReadError("throw"), true);
  assert.equal(shouldThrowAppDataReadError("sample"), false);
});

test("sample fallback requires both local development and the explicit opt-in", () => {
  const enabled = {
    NEXT_PUBLIC_MINTBINDER_ENABLE_DEV_SAMPLE_FALLBACK: "true",
    NODE_ENV: "development",
  };

  assert.equal(developmentSampleFallbackEnabled(enabled), true);
  assert.equal(resolveAppDataFallbackMode("sample", enabled), "sample");
  assert.equal(resolveAppDataFallbackMode("throw", enabled), "throw");

  for (const environment of [
    { ...enabled, NODE_ENV: "production" },
    { ...enabled, NODE_ENV: "test" },
    { ...enabled, NEXT_PUBLIC_MINTBINDER_ENABLE_DEV_SAMPLE_FALLBACK: "false" },
    { NODE_ENV: "development" },
  ]) {
    const mode = resolveAppDataFallbackMode("sample", environment);
    assert.equal(mode, "throw");
    assert.throws(
      () => assertAppDataDatabaseConfigured(undefined, mode),
      /DATABASE_URL is not configured/,
    );
  }
});

test("failed private database reads are represented as uncached 503 responses", async () => {
  const response = databaseReadUnavailableResult("Dashboard data is temporarily unavailable.");

  assert.equal(response.status, 503);
  assert.equal(response.headers["cache-control"], "no-store");
  assert.deepEqual(response.body, {
    error: "Dashboard data is temporarily unavailable.",
  });
});

test("production read routes use fail-closed 503 responses and never expose samples", async () => {
  const routeUrls = [
    "../src/app/api/app-data/route.ts",
    "../src/app/api/dashboard/route.ts",
    "../src/app/api/catalogue/search/route.ts",
    "../src/app/api/catalogue/set/route.ts",
  ];
  const sources = await Promise.all(routeUrls.map((url) => readFile(new URL(url, import.meta.url), "utf8")));

  for (const source of sources) {
    assert.match(source, /databaseReadUnavailableResponse/);
    assert.match(source, /privateReadJson/);
    assert.doesNotMatch(source, /sampleAppData/);
  }

  const pageSource = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  assert.match(pageSource, /developmentSamplePreviewEnabled/);
  assert.match(pageSource, /NODE_ENV === "development"/);
  assert.match(pageSource, /NEXT_PUBLIC_MINTBINDER_ENABLE_DEV_SAMPLE_FALLBACK === "true"/);
});

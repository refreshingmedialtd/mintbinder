import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";
import manifest from "../src/app/manifest.ts";
import {
  detailedHealthPayload,
  publicHealthPayload,
} from "../src/lib/health-response.ts";

test("manifest exposes scoped raster and dedicated maskable install icons", async () => {
  const value = manifest();

  assert.equal(value.id, "/");
  assert.equal(value.lang, "en-GB");
  assert.equal(value.dir, "ltr");
  assert.equal(value.scope, "/");
  assert.equal(value.start_url, "/");
  assert.equal(value.display, "standalone");
  assert.deepEqual(
    value.icons?.map(({ purpose, sizes, src, type }) => ({ purpose, sizes, src, type })),
    [
      { purpose: "any", sizes: "192x192", src: "/icons/icon-192.png", type: "image/png" },
      { purpose: "any", sizes: "512x512", src: "/icons/icon-512.png", type: "image/png" },
      { purpose: "maskable", sizes: "192x192", src: "/icons/icon-maskable-192.png", type: "image/png" },
      { purpose: "maskable", sizes: "512x512", src: "/icons/icon-maskable-512.png", type: "image/png" },
    ],
  );

  const expectedImages = [
    ["apple-touch-icon.png", 180, 180, false],
    ["icon-192.png", 192, 192, true],
    ["icon-512.png", 512, 512, true],
    ["icon-maskable-192.png", 192, 192, false],
    ["icon-maskable-512.png", 512, 512, false],
  ];

  for (const [name, expectedWidth, expectedHeight, expectedAlpha] of expectedImages) {
    const path = new URL(`../public/icons/${name}`, import.meta.url);
    await access(path);
    const png = await readFile(path);

    assert.equal(png.subarray(1, 4).toString("ascii"), "PNG", `${name} must be a PNG`);
    assert.equal(png.readUInt32BE(16), expectedWidth, `${name} width`);
    assert.equal(png.readUInt32BE(20), expectedHeight, `${name} height`);
    assert.equal([4, 6].includes(png[25]), expectedAlpha, `${name} alpha channel`);
  }
});

test("service worker never caches API or account navigation responses", async () => {
  const worker = await readFile(new URL("../public/sw.js", import.meta.url), "utf8");

  assert.match(worker, /url\.pathname\.startsWith\("\/api\/"\)/);
  assert.match(worker, /request\.mode === "navigate"/);
  assert.match(worker, /networkNavigationOrOffline/);
  assert.match(worker, /MAX_CACHE_ENTRIES = 96/);
  assert.match(worker, /key\.startsWith\(CACHE_PREFIX\)/);
  assert.match(worker, /LEGACY_CACHE_NAMES\.has\(key\)/);
  assert.doesNotMatch(worker, /skipWaiting/);
  assert.doesNotMatch(worker, /caches\.match\(request\)[\s\S]*request\.mode === "navigate"/);
});

test("offline fallback makes the private-data boundary explicit", async () => {
  const offline = await readFile(new URL("../public/offline.html", import.meta.url), "utf8");

  assert.match(offline, /Your account data has not been cached on this device/);
  assert.match(offline, /Content-Security-Policy/);
  assert.doesNotMatch(offline, /localStorage|indexedDB|\/api\//);
});

test("public health payload omits runtime and environment diagnostics", () => {
  const healthy = {
    checkedAt: "2026-08-26T12:00:00.000Z",
    database: "ok",
    durationMs: 18,
    ok: true,
  };
  const publicPayload = publicHealthPayload(healthy);
  const detailedPayload = detailedHealthPayload(healthy, {
    AUTH_SECRET: "configured",
    AUTH_TRUST_HOST: "true",
    AUTH_URL: "https://mintbinder.co.uk",
    MINTBINDER_RUNTIME_COMMIT: "a".repeat(40),
    MINTBINDER_RUNTIME_DIST_DIR: `.next-releases/${"a".repeat(40)}`,
    NEXT_PUBLIC_APP_URL: "https://mintbinder.co.uk",
  });

  assert.deepEqual(publicPayload, {
    checkedAt: healthy.checkedAt,
    ok: true,
    service: "mintbinder",
    status: "ok",
  });
  assert.equal("build" in publicPayload, false);
  assert.equal("checks" in publicPayload, false);
  assert.equal(detailedPayload.build.commit, "a".repeat(40));
  assert.equal(detailedPayload.checks.database, "ok");
  assert.equal(detailedPayload.checks.auth.authSecretConfigured, true);
});

test("robots policy is a static public asset for host compatibility", async () => {
  const robots = await readFile(new URL("../public/robots.txt", import.meta.url), "utf8");

  assert.match(robots, /^User-agent: \*$/m);
  assert.match(robots, /^Disallow: \/api\/$/m);
  assert.match(robots, /^Disallow: \/auth\/$/m);
  assert.match(robots, /^Sitemap: https:\/\/mintbinder\.co\.uk\/sitemap\.xml$/m);
  await assert.rejects(access(new URL("../src/app/robots.ts", import.meta.url)));
});

test("CI actions are immutable and checkout credentials are not persisted", async () => {
  const workflow = await readFile(new URL("../.github/workflows/ci.yml", import.meta.url), "utf8");

  assert.match(workflow, /actions\/checkout@[0-9a-f]{40} # v4\.2\.2/);
  assert.match(workflow, /persist-credentials: false/);
  assert.match(workflow, /actions\/setup-node@[0-9a-f]{40} # v4\.4\.0/);
  assert.doesNotMatch(workflow, /uses: actions\/(?:checkout|setup-node)@v\d/);
});

test("runtime attestation authenticates diagnostics and rejects plaintext remote health URLs", async () => {
  const verifier = await readFile(new URL("../scripts/verify-runtime-build.mjs", import.meta.url), "utf8");

  assert.match(verifier, /authorization: `Bearer \$\{jobSecret\}`/);
  assert.match(verifier, /must use HTTPS outside local loopback/);
});

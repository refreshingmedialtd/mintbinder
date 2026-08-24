import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const require = createRequire(import.meta.url);
const {
  readRuntimeBuildInfo,
  requireStandaloneServerPath,
  resolveNextDistDir,
  resolveStandaloneServerPath,
  serveNextStaticAsset,
  validateRuntimeBuildInfo,
} = require("../app.js");

test("cold start selects the immutable build recorded in deployment metadata", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mintbinder-build-"));
  const metadataPath = join(directory, ".mintbinder-build.json");
  const distDir = `.next-releases/${"a".repeat(40)}-20260824143000-1234`;

  try {
    await writeFile(metadataPath, JSON.stringify({
      commit: "a".repeat(40),
      distDir,
    }));
    const metadata = readRuntimeBuildInfo(metadataPath);

    assert.equal(
      resolveNextDistDir({ environmentValue: undefined, metadataDistDir: metadata.distDir }),
      distDir,
    );
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("cold start rejects metadata paths outside the immutable release area", () => {
  assert.throws(
    () => resolveNextDistDir({ metadataDistDir: "../shared/.next" }),
    /outside the immutable/,
  );
});

test("startup rejects stale PM2 build environment and self-referential root metadata", () => {
  const oldDist = `.next-releases/${"a".repeat(40)}-20260824140000-100`;
  const newDist = `.next-releases/${"b".repeat(40)}-20260824150000-101`;

  assert.throws(
    () => resolveNextDistDir({ environmentValue: oldDist, metadataDistDir: newDist }),
    /does not match deployment metadata/,
  );
  assert.throws(
    () => validateRuntimeBuildInfo({
      rootBuildInfo: { commit: "b".repeat(40), distDir: newDist },
      runtimeBuildInfo: { commit: "a".repeat(40), distDir: oldDist },
      selectedDistDir: oldDist,
    }),
    /root and immutable release metadata do not match/,
  );
});

test("production startup rejects missing root attestation for legacy and immutable builds", () => {
  const distDir = `.next-releases/${"e".repeat(40)}-20260824154500-202`;

  assert.throws(
    () => validateRuntimeBuildInfo({
      rootBuildInfo: null,
      runtimeBuildInfo: null,
      selectedDistDir: ".next",
    }),
    /production build metadata is missing/,
  );
  assert.doesNotThrow(() => validateRuntimeBuildInfo({
    allowUnattestedLegacy: true,
    rootBuildInfo: null,
    runtimeBuildInfo: null,
    selectedDistDir: ".next",
  }));
  assert.throws(
    () => validateRuntimeBuildInfo({
      rootBuildInfo: null,
      runtimeBuildInfo: { commit: "e".repeat(40), distDir },
      selectedDistDir: distDir,
    }),
    /root release pointer is missing/,
  );
});

test("first immutable deploy can still start and roll back the legacy .next build", () => {
  assert.doesNotThrow(() => validateRuntimeBuildInfo({
    rootBuildInfo: { commit: "a".repeat(40), generatedAt: "2026-08-24T11:45:52.000Z" },
    runtimeBuildInfo: { commit: "a".repeat(40), generatedAt: "2026-08-24T11:45:52.000Z" },
    selectedDistDir: ".next",
  }));
  assert.equal(resolveNextDistDir({ environmentValue: ".next" }), ".next");
});

test("standalone startup resolves only the selected release-local runtime", async () => {
  const directory = await mkdtemp(join(tmpdir(), "mintbinder-standalone-"));
  const distDir = `.next-releases/${"c".repeat(40)}-20260824153000-200`;
  const runtimeServer = join(directory, distDir, "runtime", "server.js");

  try {
    await mkdir(join(directory, distDir, "runtime"), { recursive: true });
    await writeFile(runtimeServer, "// standalone fixture\n");
    assert.equal(resolveStandaloneServerPath(directory, distDir), runtimeServer);
    assert.equal(resolveStandaloneServerPath(directory, ".next"), null);
    assert.equal(resolveStandaloneServerPath(directory, `.next-releases/${"d".repeat(40)}-20260824153000-201`), null);
    assert.throws(
      () => requireStandaloneServerPath(directory, `.next-releases/${"d".repeat(40)}-20260824153000-201`),
      /immutable release runtime is missing/,
    );
    assert.equal(requireStandaloneServerPath(directory, ".next"), null);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

test("rejects malformed encoded static paths without throwing", () => {
  const response = responseRecorder();

  assert.doesNotThrow(() => {
    assert.equal(
      serveNextStaticAsset(
        { method: "GET" },
        response,
        "/_next/static/%",
      ),
      true,
    );
  });
  assert.equal(response.status, 400);
  assert.equal(response.body, "Invalid static asset path.");
});

test("rejects encoded traversal outside the Next static directory", () => {
  const response = responseRecorder();

  assert.equal(
    serveNextStaticAsset(
      { method: "GET" },
      response,
      "/_next/static/%2e%2e%2fBUILD_ID",
    ),
    true,
  );
  assert.equal(response.status, 400);
  assert.equal(response.body, "Invalid static asset path.");
});

function responseRecorder() {
  return {
    body: "",
    destroyed: false,
    headers: {},
    headersSent: false,
    status: 0,
    destroy() {
      this.destroyed = true;
    },
    end(value = "") {
      this.body += value;
      this.headersSent = true;
    },
    writeHead(status, headers) {
      this.status = status;
      this.headers = headers;
      this.headersSent = true;
      return this;
    },
  };
}

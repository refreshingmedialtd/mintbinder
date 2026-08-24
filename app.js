/* eslint-disable @typescript-eslint/no-require-imports */

const { createServer } = require("node:http");
const { createReadStream, existsSync, readFileSync, statSync } = require("node:fs");
const { extname, join, normalize, relative } = require("node:path");
const { parse } = require("node:url");

loadRootEnvironment();

const appDir = __dirname;
const port = Number(cliArg("port") || process.env.PORT || process.env.NODE_PORT || 3000);
const hostname = cliArg("hostname") || process.env.APP_HOST || process.env.HOST || "127.0.0.1";
const dev = process.env.NODE_ENV === "development";
const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

function startServer() {
  const rootRuntimeBuildInfo = readRuntimeBuildInfo();
  const nextDistDir = resolveNextDistDir({
    environmentValue: process.env.MINTBINDER_NEXT_DIST_DIR,
    metadataDistDir: rootRuntimeBuildInfo?.distDir,
  });
  const runtimeBuildInfo = nextDistDir === ".next"
    ? rootRuntimeBuildInfo
    : readRuntimeBuildInfo(join(appDir, nextDistDir, ".mintbinder-build.json"), true);

  validateRuntimeBuildInfo({
    allowUnattestedLegacy: dev,
    rootBuildInfo: rootRuntimeBuildInfo,
    runtimeBuildInfo,
    selectedDistDir: nextDistDir,
  });
  applyRuntimeBuildInfo(runtimeBuildInfo, nextDistDir);

  const standaloneServer = requireStandaloneServerPath(appDir, nextDistDir);

  if (standaloneServer) {
    // The standalone server and its traced dependencies live inside the
    // selected immutable release. Replacing root node_modules during a later
    // deploy therefore cannot make rollback run against the wrong dependency
    // tree.
    process.env.HOSTNAME = hostname;
    process.env.PORT = String(port);
    console.log(`Mint Binder starting immutable runtime: ${standaloneServer}`);
    process.chdir(join(appDir, nextDistDir, "runtime"));
    require(standaloneServer);
    return Promise.resolve();
  }

  return startLegacyServer({ nextDistDir });
}

function startLegacyServer({ nextDistDir }) {
  // Compatibility path for local development and the one release that may
  // predate standalone packaging. New production releases always take the
  // immutable path above.
  const next = require("next");
  const nextStaticDir = join(appDir, nextDistDir, "static");
  const app = next({ dev, dir: appDir, hostname, port });
  const handle = app.getRequestHandler();

  return app.prepare().then(() => {
    createServer((request, response) => {
      const parsedUrl = parse(request.url || "/", true);
      const pathname = parsedUrl.pathname || "/";

      if (serveNextStaticAsset(request, response, pathname, nextStaticDir)) {
        return;
      }

      applyNoStoreHeaders(response, pathname);
      handle(request, response, parsedUrl);
    }).listen(port, hostname, () => {
      console.log(`Mint Binder listening on http://${hostname}:${port}`);
      console.log(`Mint Binder app directory: ${appDir}`);
      console.log(`Mint Binder build directory: ${nextDistDir}`);
      console.log(`Mint Binder static directory: ${nextStaticDir}`);
      console.log(`Mint Binder working directory: ${process.cwd()}`);
      console.log(`Mint Binder mode: ${dev ? "development" : "production"}`);
    });
  });
}

function loadRootEnvironment() {
  if (typeof process.loadEnvFile !== "function") {
    // Node 22 is required in production. This guard keeps unit imports clear on
    // older developer runtimes without introducing a mutable root dependency.
    return;
  }

  try {
    process.loadEnvFile(join(__dirname, ".env"));
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function resolveStandaloneServerPath(rootDir, selectedDistDir) {
  if (selectedDistDir === ".next") {
    return null;
  }

  const candidate = join(rootDir, selectedDistDir, "runtime", "server.js");
  return existsSync(candidate) ? candidate : null;
}

function requireStandaloneServerPath(rootDir, selectedDistDir) {
  const candidate = resolveStandaloneServerPath(rootDir, selectedDistDir);

  if (selectedDistDir !== ".next" && !candidate) {
    throw new Error("Mint Binder immutable release runtime is missing; refusing to serve mutable root build output.");
  }

  return candidate;
}

function readRuntimeBuildInfo(metadataPath = join(appDir, ".mintbinder-build.json"), required = false) {
  try {
    return JSON.parse(readFileSync(metadataPath, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT" && !required) {
      // Local development and the first build do not have deployment metadata.
      return null;
    }

    throw new Error(`Mint Binder build metadata is invalid: ${error instanceof Error ? error.message : "unknown error"}`);
  }
}

function applyRuntimeBuildInfo(build = runtimeBuildInfo, actualDistDir = nextDistDir) {
  if (!build || typeof build !== "object") {
    return;
  }

  const values = {
    MINTBINDER_RUNTIME_BRANCH: build.branch,
    MINTBINDER_RUNTIME_COMMIT: build.commit,
    MINTBINDER_RUNTIME_DEPLOY_SCRIPT_VERSION: build.deployScriptVersion,
    MINTBINDER_RUNTIME_DIST_DIR: actualDistDir,
    MINTBINDER_RUNTIME_GENERATED_AT: build.generatedAt,
    MINTBINDER_RUNTIME_NODE_VERSION: build.nodeVersion,
  };

  for (const [key, value] of Object.entries(values)) {
    if (typeof value === "string" && value.trim()) {
      process.env[key] = value.trim();
    }
  }
}

function resolveNextDistDir({ environmentValue, metadataDistDir } = {}) {
  const environmentDir = environmentValue?.trim();
  const metadataDir = typeof metadataDistDir === "string" ? metadataDistDir.trim() : "";

  if (environmentDir && metadataDir && environmentDir !== metadataDir) {
    throw new Error("Mint Binder runtime build directory does not match deployment metadata.");
  }

  const selected = environmentDir || metadataDir || ".next";

  if (selected === ".next") {
    return selected;
  }

  if (!/^\.next-releases\/[0-9a-f]{40}(?:-[0-9]{14}-[0-9]+)?$/.test(selected)) {
    throw new Error("Mint Binder build directory is outside the immutable .next-releases area.");
  }

  return selected;
}

function validateRuntimeBuildInfo({
  allowUnattestedLegacy = false,
  rootBuildInfo,
  runtimeBuildInfo: releaseBuildInfo,
  selectedDistDir,
}) {
  if (selectedDistDir === ".next") {
    if (!rootBuildInfo) {
      if (allowUnattestedLegacy) return;
      throw new Error("Mint Binder production build metadata is missing; refusing an unattested mutable root build.");
    }
    if (rootBuildInfo.distDir && rootBuildInfo.distDir !== ".next") {
      throw new Error("Mint Binder legacy build metadata does not describe .next.");
    }
    if (rootBuildInfo.commit && !/^[0-9a-f]{40}$/.test(rootBuildInfo.commit)) {
      throw new Error("Mint Binder legacy build metadata has an invalid commit.");
    }
    return;
  }
  if (!releaseBuildInfo || typeof releaseBuildInfo !== "object") {
    throw new Error("Mint Binder immutable release metadata is missing.");
  }
  if (!rootBuildInfo || typeof rootBuildInfo !== "object") {
    throw new Error("Mint Binder root release pointer is missing; refusing a stale saved runtime selection.");
  }
  if (releaseBuildInfo.distDir !== selectedDistDir) {
    throw new Error("Mint Binder immutable release metadata does not describe the selected build directory.");
  }
  if (!/^[0-9a-f]{40}$/.test(releaseBuildInfo.commit ?? "")) {
    throw new Error("Mint Binder immutable release metadata has an invalid commit.");
  }
  if (
    rootBuildInfo.commit !== releaseBuildInfo.commit ||
    rootBuildInfo.distDir !== releaseBuildInfo.distDir
  ) {
    throw new Error("Mint Binder root and immutable release metadata do not match.");
  }
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error("Mint Binder failed to start.", error);
    process.exit(1);
  });
}

function cliArg(name) {
  const prefix = `--${name}=`;
  const inlineValue = process.argv.find((argument) => argument.startsWith(prefix));

  if (inlineValue) {
    return inlineValue.slice(prefix.length);
  }

  const index = process.argv.indexOf(`--${name}`);

  if (index !== -1) {
    return process.argv[index + 1];
  }

  return undefined;
}

function applyNoStoreHeaders(response, pathname) {
  if (isCacheableNextAsset(pathname)) {
    return;
  }

  setNoStoreHeaders(response);

  const writeHead = response.writeHead.bind(response);

  response.writeHead = (...args) => {
    setNoStoreHeaders(response);
    return writeHead(...args);
  };
}

function setNoStoreHeaders(response) {
  Object.entries(noStoreHeaders).forEach(([key, value]) => {
    response.setHeader(key, value);
  });
}

function isCacheableNextAsset(pathname) {
  return pathname.startsWith("/_next/static/");
}

function serveNextStaticAsset(request, response, pathname, staticDirectory = join(appDir, ".next", "static")) {
  if (!isCacheableNextAsset(pathname) || request.method !== "GET") {
    return false;
  }

  let relativeAssetPath;

  try {
    relativeAssetPath = decodeURIComponent(pathname.replace(/^\/_next\/static\//, ""));
  } catch {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Invalid static asset path.");
    return true;
  }

  const assetPath = normalize(join(staticDirectory, relativeAssetPath));
  const relativeToStatic = relative(staticDirectory, assetPath);

  if (relativeToStatic.startsWith("..") || relativeToStatic === "" || relativeToStatic.startsWith("/") || relativeToStatic.startsWith("\\")) {
    response.writeHead(400, { "content-type": "text/plain; charset=utf-8" });
    response.end("Invalid static asset path.");
    return true;
  }

  try {
    const stats = statSync(assetPath);

    if (!stats.isFile()) {
      response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
      response.end("Static asset not found.");
      return true;
    }

    const stream = createReadStream(assetPath);

    stream.on("error", (error) => {
      if (!response.headersSent) {
        response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
        response.end("Static asset not found.");
        return;
      }

      response.destroy(error);
    });
    response.writeHead(200, {
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": stats.size,
      "content-type": contentTypeFor(assetPath),
    });
    stream.pipe(response);
    return true;
  } catch {
    response.writeHead(404, { "content-type": "text/plain; charset=utf-8" });
    response.end("Static asset not found.");
    return true;
  }
}

function contentTypeFor(filePath) {
  const type = {
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".map": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".png": "image/png",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".gif": "image/gif",
    ".webp": "image/webp",
    ".woff": "font/woff",
    ".woff2": "font/woff2",
  }[extname(filePath).toLowerCase()];

  return type ?? "application/octet-stream";
}

module.exports = {
  applyRuntimeBuildInfo,
  readRuntimeBuildInfo,
  requireStandaloneServerPath,
  resolveNextDistDir,
  resolveStandaloneServerPath,
  serveNextStaticAsset,
  startServer,
  validateRuntimeBuildInfo,
};

/* eslint-disable @typescript-eslint/no-require-imports */

require("dotenv/config");

const { createServer } = require("node:http");
const { createReadStream, statSync } = require("node:fs");
const { extname, join, normalize, relative } = require("node:path");
const { parse } = require("node:url");
const next = require("next");

const appDir = __dirname;
const nextStaticDir = join(appDir, ".next", "static");
const port = Number(cliArg("port") || process.env.PORT || process.env.NODE_PORT || 3000);
const hostname = cliArg("hostname") || process.env.APP_HOST || process.env.HOST || "127.0.0.1";
const dev = process.env.NODE_ENV === "development";
const noStoreHeaders = {
  "Cache-Control": "no-store, no-cache, must-revalidate, proxy-revalidate",
  Pragma: "no-cache",
  Expires: "0",
};

const app = next({ dev, dir: appDir, hostname, port });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  createServer((request, response) => {
    const parsedUrl = parse(request.url || "/", true);
    const pathname = parsedUrl.pathname || "/";

    if (serveNextStaticAsset(request, response, pathname)) {
      return;
    }

    applyNoStoreHeaders(response, pathname);
    handle(request, response, parsedUrl);
  }).listen(port, hostname, () => {
    console.log(`Mint Binder listening on http://${hostname}:${port}`);
    console.log(`Mint Binder app directory: ${appDir}`);
    console.log(`Mint Binder static directory: ${nextStaticDir}`);
    console.log(`Mint Binder working directory: ${process.cwd()}`);
    console.log(`Mint Binder mode: ${dev ? "development" : "production"}`);
  });
}).catch((error) => {
  console.error("Mint Binder failed to start.", error);
  process.exit(1);
});

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

function serveNextStaticAsset(request, response, pathname) {
  if (!isCacheableNextAsset(pathname) || request.method !== "GET") {
    return false;
  }

  const relativeAssetPath = decodeURIComponent(pathname.replace(/^\/_next\/static\//, ""));
  const assetPath = normalize(join(nextStaticDir, relativeAssetPath));
  const relativeToStatic = relative(nextStaticDir, assetPath);

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

    response.writeHead(200, {
      "cache-control": "public, max-age=31536000, immutable",
      "content-length": stats.size,
      "content-type": contentTypeFor(assetPath),
    });
    createReadStream(assetPath).pipe(response);
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

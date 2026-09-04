const CACHE_PREFIX = "mintbinder-public-";
const CACHE_NAME = `${CACHE_PREFIX}v2`;
const LEGACY_CACHE_NAMES = new Set(["mintbinder-static-v1"]);
const OFFLINE_URL = "/offline.html";
const MAX_CACHE_ENTRIES = 96;
const ACTIVATE_UPDATE_MESSAGE = "mintbinder:activate-update";
const PUBLIC_SHELL_PATHS = [
  OFFLINE_URL,
  "/icon.svg",
  "/icons/apple-touch-icon.png",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/icon-maskable-192.png",
  "/icons/icon-maskable-512.png",
  "/manifest.webmanifest",
];
const STATIC_PATHS = new Set(PUBLIC_SHELL_PATHS.filter((path) => path !== OFFLINE_URL));

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(PUBLIC_SHELL_PATHS)));
});

self.addEventListener("message", (event) => {
  if (event.data?.type !== ACTIVATE_UPDATE_MESSAGE) {
    return;
  }

  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys
          .filter((key) => (key.startsWith(CACHE_PREFIX) || LEGACY_CACHE_NAMES.has(key)) && key !== CACHE_NAME)
          .map((key) => caches.delete(key)),
      ))
      .then(() => self.clients.claim()),
  );
});

self.addEventListener("fetch", (event) => {
  const request = event.request;

  if (request.method !== "GET" || request.headers.has("range")) {
    return;
  }

  const url = new URL(request.url);

  if (url.origin !== self.location.origin || url.pathname.startsWith("/api/")) {
    return;
  }

  if (request.mode === "navigate") {
    event.respondWith(networkNavigationOrOffline(request));
    return;
  }

  const isStaticAsset = url.pathname.startsWith("/_next/static/") || STATIC_PATHS.has(url.pathname);

  if (isStaticAsset) {
    event.respondWith(cacheFirstPublicAsset(request));
  }
});

async function networkNavigationOrOffline(request) {
  try {
    const response = await fetch(request);

    if (response.status < 500) {
      return response;
    }

    return (await caches.match(OFFLINE_URL)) ?? response;
  } catch {
    return (await caches.match(OFFLINE_URL)) ?? Response.error();
  }
}

async function cacheFirstPublicAsset(request) {
  const cache = await caches.open(CACHE_NAME);
  const cached = await cache.match(request);

  if (cached) {
    return cached;
  }

  const response = await fetch(request);

  if (response.ok && (response.type === "basic" || response.type === "default")) {
    await cache.put(request, response.clone());
    await trimCache(cache, MAX_CACHE_ENTRIES);
  }

  return response;
}

async function trimCache(cache, maximumEntries) {
  const requests = await cache.keys();
  const excess = requests.length - maximumEntries;

  if (excess <= 0) {
    return;
  }

  await Promise.all(requests.slice(0, excess).map((request) => cache.delete(request)));
}

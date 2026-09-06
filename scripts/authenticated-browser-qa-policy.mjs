const PRODUCTION_OPT_IN = "AUTHENTICATED_QA_ALLOW_PRODUCTION";
const FIXTURE_EMAIL_DOMAIN = "mintbinder.invalid";
const FIXTURE_EMAIL_PREFIX = "browser-qa-";
const MAX_RUN_ID_LENGTH = 64 - FIXTURE_EMAIL_PREFIX.length;

export function parseBrowserQaBoolean(value, fallback = false) {
  const name = "Browser QA boolean";

  if (value === undefined || value === null || value === "") {
    if (typeof fallback !== "boolean") {
      throw new TypeError(`${name} default must be a boolean.`);
    }
    return fallback;
  }

  if (typeof value === "boolean") return value;
  if (typeof value !== "string") {
    throw new Error(`${name} must be exactly true or false.`);
  }

  const normalized = value.trim().toLowerCase();
  if (normalized === "true") return true;
  if (normalized === "false") return false;
  throw new Error(`${name} must be exactly true or false.`);
}

export function normalizeBrowserQaBaseUrl(value) {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error("Authenticated browser QA base URL is required.");
  }

  if (!/^[a-z][a-z\d+.-]*:\/\//i.test(value.trim())) {
    throw new Error("Authenticated browser QA base URL must be a valid absolute URL.");
  }

  let url;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("Authenticated browser QA base URL must be a valid absolute URL.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("Authenticated browser QA base URL must use HTTP or HTTPS.");
  }
  if (url.username || url.password) {
    throw new Error("Authenticated browser QA base URL must not contain credentials.");
  }
  if (url.search || url.hash) {
    throw new Error("Authenticated browser QA base URL must not contain a query string or fragment.");
  }
  if (!/^\/+$/u.test(url.pathname)) {
    throw new Error("Authenticated browser QA base URL must target the application root path.");
  }

  return url.origin;
}

export function isLoopbackBrowserQaUrl(value) {
  const hostname = new URL(normalizeBrowserQaBaseUrl(value)).hostname.toLowerCase();

  if (hostname === "localhost" || hostname.endsWith(".localhost")) return true;
  if (hostname === "::1" || hostname === "[::1]") return true;

  const ipv4 = hostname.split(".");
  return ipv4.length === 4 &&
    ipv4[0] === "127" &&
    ipv4.every((part) => /^\d{1,3}$/.test(part) && Number(part) <= 255);
}

export function assertBrowserQaTargetAllowed(value, allowProduction = false) {
  const baseUrl = normalizeBrowserQaBaseUrl(value);
  const loopback = isLoopbackBrowserQaUrl(baseUrl);

  if (!loopback && new URL(baseUrl).protocol !== "https:") {
    throw new Error("Authenticated browser QA requires HTTPS for non-loopback targets.");
  }

  if (
    !loopback &&
    !parseBrowserQaBoolean(allowProduction)
  ) {
    throw new Error(
      `Authenticated browser QA against a non-loopback target requires ${PRODUCTION_OPT_IN}=true.`,
    );
  }

  return baseUrl;
}

function normalizeAuthenticatedQaRunId(value) {
  if (typeof value !== "string") {
    throw new Error("Authenticated browser QA run ID is required.");
  }

  const runId = value.trim().toLowerCase();
  if (
    !runId ||
    runId.length > MAX_RUN_ID_LENGTH ||
    !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(runId)
  ) {
    throw new Error(
      `Authenticated browser QA run ID must be 1-${MAX_RUN_ID_LENGTH} lowercase letters, numbers, or internal hyphens.`,
    );
  }

  return runId;
}

function authenticatedQaFixtureEmail(runId) {
  return `${FIXTURE_EMAIL_PREFIX}${normalizeAuthenticatedQaRunId(runId)}@${FIXTURE_EMAIL_DOMAIN}`;
}

function authenticatedQaRunMarker(runId) {
  return `[browser-qa-run:${normalizeAuthenticatedQaRunId(runId)}]`;
}

function authenticatedQaFixtureDisplayName(runId) {
  return `Mint Binder browser QA ${authenticatedQaRunMarker(runId)}`;
}

export function createBrowserQaIdentity(runId) {
  const normalizedRunId = normalizeAuthenticatedQaRunId(runId);

  return {
    runId: normalizedRunId,
    email: authenticatedQaFixtureEmail(normalizedRunId),
    displayName: authenticatedQaFixtureDisplayName(normalizedRunId),
  };
}

export function isBrowserQaFixtureIdentity(identity) {
  if (!identity || typeof identity !== "object") return false;

  const email = typeof identity.email === "string" ? identity.email.trim().toLowerCase() : "";
  const displayName = typeof identity.displayName === "string" ? identity.displayName : "";
  const emailPrefix = FIXTURE_EMAIL_PREFIX;
  const emailSuffix = `@${FIXTURE_EMAIL_DOMAIN}`;

  if (!email.startsWith(emailPrefix) || !email.endsWith(emailSuffix)) return false;

  const emailRunId = email.slice(emailPrefix.length, -emailSuffix.length);
  let expectedRunId;
  try {
    expectedRunId = identity.runId === undefined
      ? normalizeAuthenticatedQaRunId(emailRunId)
      : normalizeAuthenticatedQaRunId(identity.runId);
  } catch {
    return false;
  }

  return emailRunId === expectedRunId &&
    email === authenticatedQaFixtureEmail(expectedRunId) &&
    displayName === authenticatedQaFixtureDisplayName(expectedRunId);
}

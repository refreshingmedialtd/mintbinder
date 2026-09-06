const PRODUCTION_OPT_IN = "AUTHENTICATED_QA_ALLOW_PRODUCTION";
const EXPECTED_COMMIT_SETTING = "AUTHENTICATED_QA_EXPECTED_COMMIT";
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

export function browserQaRuntimeAttestation({ baseUrl, expectedCommit, jobSecret }) {
  const remote = !isLoopbackBrowserQaUrl(baseUrl);
  const commit = typeof expectedCommit === "string" ? expectedCommit.trim().toLowerCase() : "";
  const secret = typeof jobSecret === "string" ? jobSecret.trim() : "";

  if (commit && !/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error(`${EXPECTED_COMMIT_SETTING} must be a full 40-character Git commit SHA.`);
  }

  if (remote && !commit) {
    throw new Error(`Authenticated browser QA against a non-loopback target requires ${EXPECTED_COMMIT_SETTING}.`);
  }
  if (remote && !secret) {
    throw new Error("Authenticated browser QA against a non-loopback target requires JOB_SECRET for runtime attestation.");
  }
  if (commit && !secret) {
    throw new Error(`JOB_SECRET is required when ${EXPECTED_COMMIT_SETTING} is configured.`);
  }
  return commit ? { expectedCommit: commit, jobSecret: secret } : null;
}

export function filteredBrowserConsoleError({ baseUrl, locationUrl, text, type }) {
  if (type !== "error") return null;

  const message = typeof text === "string" ? text.trim() : "";
  if (!message) return null;

  const source = typeof locationUrl === "string" ? locationUrl.trim() : "";
  if (source) {
    try {
      if (new URL(source).origin !== new URL(normalizeBrowserQaBaseUrl(baseUrl)).origin) {
        return null;
      }
    } catch {
      // An unparseable source cannot be proven third-party, so keep the error.
    }
  }

  return {
    message,
    ...(source ? { source } : {}),
    type: "console:error",
  };
}

export async function runWithPrearmedWaiters(waiterFactories, trigger) {
  if (!Array.isArray(waiterFactories) || waiterFactories.length === 0) {
    throw new Error("At least one waiter factory is required.");
  }
  if (typeof trigger !== "function") {
    throw new TypeError("The pre-armed waiter trigger must be a function.");
  }

  const waiters = [];
  try {
    for (const factory of waiterFactories) {
      if (typeof factory !== "function") {
        throw new TypeError("Each pre-armed waiter must be created by a function.");
      }
      const waiter = factory();
      if (!waiter || typeof waiter.cancel !== "function" || !waiter.promise || typeof waiter.promise.then !== "function") {
        throw new TypeError("Each pre-armed waiter must expose a promise and cancel function.");
      }
      waiters.push(waiter);
    }
  } catch (error) {
    for (const waiter of waiters) waiter.cancel();
    await Promise.allSettled(waiters.map((waiter) => waiter.promise));
    throw error;
  }
  const waiterResults = Promise.all(waiters.map((waiter) => waiter.promise));
  const triggerResult = Promise.resolve().then(trigger);

  // Both promises have handlers before either operation can fail. This prevents
  // a click failure from leaving a response/download listener to reject later.
  waiterResults.catch(() => undefined);
  triggerResult.catch(() => undefined);

  try {
    const [, results] = await Promise.all([triggerResult, waiterResults]);
    return results;
  } catch (error) {
    for (const waiter of waiters) waiter.cancel();
    await Promise.allSettled(waiters.map((waiter) => waiter.promise));
    throw error;
  }
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

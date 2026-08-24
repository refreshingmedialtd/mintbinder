export class ProviderFetchError extends Error {
  constructor(message, { retryAfterMs, status } = {}) {
    super(message);
    this.name = "ProviderFetchError";
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

export async function fetchJsonWithRetry({
  fetchImpl = fetch,
  init = {},
  maxResponseBytes = 8 * 1024 * 1024,
  maxRetryWaitMs = 10_000,
  onAttempt,
  provider = "Provider",
  random = Math.random,
  retryAttempts = 3,
  retryInvalidResponse = false,
  retryWaitMs = 500,
  timeoutMs = 10_000,
  url,
  validate,
}) {
  const attempts = positiveInteger(retryAttempts, 3);
  const responseByteLimit = positiveInteger(maxResponseBytes, 8 * 1024 * 1024);
  let lastError;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    onAttempt?.(attempt);

    const request = requestDeadline(init.signal, timeoutMs);

    try {
      const response = await fetchImpl(url, {
        ...init,
        signal: request.signal,
      });
      const body = await readBoundedJson(response, {
        maxResponseBytes: responseByteLimit,
        provider,
        signal: request.signal,
      });
      const valid = body !== undefined &&
        (typeof validate !== "function" || validate(body, response));

      if (!response.ok || body === undefined || !valid) {
        const invalidReason = body === undefined
          ? "invalid JSON"
          : !valid
            ? "an invalid payload"
            : `HTTP ${response.status}`;
        throw new ProviderFetchError(
          `${provider} request failed with ${invalidReason}.`,
          {
            retryAfterMs: retryAfterMilliseconds(response.headers?.get?.("retry-after")),
            status: response.status,
          },
        );
      }

      return { attempts: attempt, body, response };
    } catch (error) {
      lastError = error;

      if (attempt >= attempts || !retryableProviderError(error, { retryInvalidResponse })) {
        throw error;
      }

      request.cleanup();
      await wait(retryDelayMilliseconds({
        attempt,
        maxRetryWaitMs,
        random,
        retryAfterMs: error instanceof ProviderFetchError ? error.retryAfterMs : undefined,
        retryWaitMs,
      }));
    } finally {
      request.cleanup();
    }
  }

  throw lastError instanceof Error ? lastError : new Error(`${provider} request failed.`);
}

async function readBoundedJson(response, { maxResponseBytes, provider, signal }) {
  const declaredBytes = contentLengthBytes(response.headers?.get?.("content-length"));

  if (declaredBytes !== undefined && declaredBytes > maxResponseBytes) {
    await response.body?.cancel?.().catch(() => undefined);
    throw oversizedResponseError(provider, response, maxResponseBytes);
  }

  const reader = response.body?.getReader?.();

  if (!reader) {
    return readJsonFallback(response, { maxResponseBytes, provider, signal });
  }

  const chunks = [];
  let receivedBytes = 0;

  try {
    while (true) {
      const { done, value } = await readWithSignal(reader, signal);

      if (done) {
        break;
      }

      const chunk = value instanceof Uint8Array ? value : new Uint8Array(value);

      receivedBytes += chunk.byteLength;

      if (receivedBytes > maxResponseBytes) {
        await reader.cancel().catch(() => undefined);
        throw oversizedResponseError(provider, response, maxResponseBytes);
      }

      chunks.push(chunk);
    }
  } catch (error) {
    if (error instanceof ProviderFetchError) {
      throw error;
    }

    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("The request was aborted.", "AbortError");
    }

    return undefined;
  } finally {
    reader.releaseLock?.();
  }

  const bytes = new Uint8Array(receivedBytes);
  let offset = 0;

  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }

  try {
    return JSON.parse(new TextDecoder().decode(bytes));
  } catch {
    return undefined;
  }
}

async function readJsonFallback(response, { maxResponseBytes, provider, signal }) {
  if (typeof response.json !== "function") {
    return undefined;
  }

  try {
    const body = await settleWithSignal(Promise.resolve().then(() => response.json()), signal);
    const serialized = JSON.stringify(body);

    if (serialized !== undefined && new TextEncoder().encode(serialized).byteLength > maxResponseBytes) {
      throw oversizedResponseError(provider, response, maxResponseBytes);
    }

    return body;
  } catch (error) {
    if (error instanceof ProviderFetchError) {
      throw error;
    }

    if (signal?.aborted) {
      throw signal.reason ?? new DOMException("The request was aborted.", "AbortError");
    }

    return undefined;
  }
}

function settleWithSignal(promise, signal) {
  if (!signal) {
    return promise;
  }

  signal.throwIfAborted?.();

  return new Promise((resolve, reject) => {
    const abort = () => {
      reject(signal.reason ?? new DOMException("The request was aborted.", "AbortError"));
    };

    signal.addEventListener("abort", abort, { once: true });
    promise.then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function readWithSignal(reader, signal) {
  if (!signal) {
    return reader.read();
  }

  signal.throwIfAborted?.();

  return new Promise((resolve, reject) => {
    const abort = () => {
      void reader.cancel(signal.reason).catch(() => undefined);
      reject(signal.reason ?? new DOMException("The request was aborted.", "AbortError"));
    };

    signal.addEventListener("abort", abort, { once: true });
    reader.read().then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function contentLengthBytes(value) {
  const text = String(value ?? "").trim();

  if (!/^\d+$/.test(text)) {
    return undefined;
  }

  const bytes = Number(text);

  return Number.isFinite(bytes) ? bytes : Number.POSITIVE_INFINITY;
}

function oversizedResponseError(provider, response, maxResponseBytes) {
  return new ProviderFetchError(
    `${provider} response exceeded the ${maxResponseBytes}-byte limit.`,
    {
      retryAfterMs: retryAfterMilliseconds(response.headers?.get?.("retry-after")),
      status: response.status,
    },
  );
}

export function retryDelayMilliseconds({
  attempt,
  maxRetryWaitMs = 10_000,
  random = Math.random,
  retryAfterMs,
  retryWaitMs = 500,
}) {
  if (Number.isFinite(retryAfterMs) && retryAfterMs >= 0) {
    return Math.min(maxRetryWaitMs, Math.floor(retryAfterMs));
  }

  const exponential = Math.max(0, retryWaitMs) * (2 ** Math.max(0, attempt - 1));
  const jitter = 0.75 + Math.max(0, Math.min(1, Number(random()) || 0)) * 0.5;

  return Math.min(maxRetryWaitMs, Math.round(exponential * jitter));
}

export function retryAfterMilliseconds(value, now = Date.now()) {
  const text = String(value ?? "").trim();

  if (!text) {
    return undefined;
  }

  const seconds = Number(text);

  if (Number.isFinite(seconds) && seconds >= 0) {
    return Math.round(seconds * 1_000);
  }

  const dateMs = Date.parse(text);

  return Number.isFinite(dateMs) ? Math.max(0, dateMs - now) : undefined;
}

function retryableProviderError(error, { retryInvalidResponse }) {
  if (error instanceof ProviderFetchError) {
    if (error.status === 429 || Number(error.status) >= 500) {
      return true;
    }

    return retryInvalidResponse && Number(error.status) >= 200 && Number(error.status) < 300;
  }

  if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) {
    return true;
  }

  return error instanceof TypeError && /fetch|network|socket|timeout/i.test(error.message);
}

function requestDeadline(existingSignal, timeoutMs) {
  const controller = new AbortController();
  const abortFromExisting = () => {
    controller.abort(existingSignal.reason ?? new DOMException("The request was aborted.", "AbortError"));
  };

  if (existingSignal?.aborted) {
    abortFromExisting();
  } else {
    existingSignal?.addEventListener("abort", abortFromExisting, { once: true });
  }

  const duration = Number(timeoutMs);
  const timer = Number.isFinite(duration) && duration > 0
    ? setTimeout(() => {
        controller.abort(new DOMException("The provider request timed out.", "TimeoutError"));
      }, Math.floor(duration))
    : undefined;

  return {
    cleanup() {
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      existingSignal?.removeEventListener("abort", abortFromExisting);
    },
    signal: controller.signal,
  };
}

function positiveInteger(value, fallback) {
  const number = Number(value);

  return Number.isFinite(number) && number > 0 ? Math.floor(number) : fallback;
}

function wait(ms) {
  return ms > 0 ? new Promise((resolve) => setTimeout(resolve, ms)) : Promise.resolve();
}

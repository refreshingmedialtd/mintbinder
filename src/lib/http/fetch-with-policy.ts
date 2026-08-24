type FetchPolicy = {
  fetchImpl?: typeof fetch;
  maxResponseBytes?: number;
  provider: string;
  retryAttempts?: number;
  retryWaitMs?: number;
  timeoutMs?: number;
};

export class ProviderRequestError extends Error {
  provider: string;

  constructor(provider: string, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = "ProviderRequestError";
    this.provider = provider;
  }
}

export async function fetchWithPolicy(
  input: RequestInfo | URL,
  init: RequestInit,
  {
    provider,
    fetchImpl = fetch,
    maxResponseBytes = 8 * 1024 * 1024,
    retryAttempts = 2,
    retryWaitMs = 350,
    timeoutMs = 10_000,
  }: FetchPolicy,
) {
  const attempts = Math.max(1, Math.min(5, Math.floor(retryAttempts) + 1));
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(new Error(`${provider} request timed out.`)), timeoutMs);
    const abortFromCaller = () => controller.abort(init.signal?.reason);
    init.signal?.addEventListener("abort", abortFromCaller, { once: true });

    try {
      const response = await fetchImpl(input, { ...init, signal: controller.signal });

      if (!isRetryableStatus(response.status) || attempt === attempts) {
        return await bufferResponse(response, controller.signal, maxResponseBytes);
      }

      await response.body?.cancel().catch(() => undefined);
      await wait(retryDelay(response.headers.get("retry-after"), attempt, retryWaitMs));
    } catch (error) {
      lastError = error;

      if (init.signal?.aborted || attempt === attempts) {
        throw new ProviderRequestError(
          provider,
          `${provider} request failed after ${attempt} attempt${attempt === 1 ? "" : "s"}.`,
          { cause: error },
        );
      }

      await wait(retryDelay(null, attempt, retryWaitMs));
    } finally {
      clearTimeout(timeout);
      init.signal?.removeEventListener("abort", abortFromCaller);
    }
  }

  throw new ProviderRequestError(provider, `${provider} request failed.`, { cause: lastError });
}

async function bufferResponse(response: Response, signal: AbortSignal, maximumBytes: number) {
  const boundedMaximum = Math.max(1, Math.min(64 * 1024 * 1024, Math.floor(maximumBytes)));
  const declaredLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > boundedMaximum) {
    await response.body?.cancel().catch(() => undefined);
    throw new Error(`Response body exceeded ${boundedMaximum} bytes.`);
  }
  if (!response.body) return response;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  try {
    while (true) {
      const { done, value } = await readWithAbort(reader, signal);
      if (done) break;
      total += value.byteLength;
      if (total > boundedMaximum) {
        throw new Error(`Response body exceeded ${boundedMaximum} bytes.`);
      }
      chunks.push(value);
    }
  } catch (error) {
    await reader.cancel(error).catch(() => undefined);
    throw error;
  }

  const body = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }

  return new Response(body, {
    headers: response.headers,
    status: response.status,
    statusText: response.statusText,
  });
}

function readWithAbort(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  signal: AbortSignal,
) {
  if (signal.aborted) return Promise.reject(signal.reason ?? new Error("Request aborted."));

  return new Promise<ReadableStreamReadResult<Uint8Array>>((resolve, reject) => {
    const abort = () => reject(signal.reason ?? new Error("Request aborted."));
    signal.addEventListener("abort", abort, { once: true });
    reader.read().then(resolve, reject).finally(() => {
      signal.removeEventListener("abort", abort);
    });
  });
}

function isRetryableStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

function retryDelay(retryAfter: string | null, attempt: number, baseMs: number) {
  const fromHeader = retryAfterMilliseconds(retryAfter);

  if (fromHeader !== null) {
    return Math.min(15_000, Math.max(0, fromHeader));
  }

  const exponential = Math.max(50, baseMs) * 2 ** (attempt - 1);
  const jitter = Math.floor(Math.random() * Math.max(25, exponential * 0.25));
  return Math.min(5_000, exponential + jitter);
}

function retryAfterMilliseconds(value: string | null) {
  if (!value) return null;

  const seconds = Number(value);
  if (Number.isFinite(seconds)) return seconds * 1000;

  const date = Date.parse(value);
  return Number.isNaN(date) ? null : Math.max(0, date - Date.now());
}

function wait(milliseconds: number) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

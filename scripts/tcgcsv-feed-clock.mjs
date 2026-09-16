// Price files have no per-row timestamp. Use TCGCSV's published build clock,
// not the time we downloaded a file or a product's catalogue modifiedOn date.
let nextRequestAt = 0;
export async function tcgcsvFetch(url, init, fetchImpl = fetch) {
  // Provider guidelines require a pause between request starts, including
  // concurrently requested products/prices and the lightweight build clock.
  const waitMs = Math.max(0, nextRequestAt - Date.now());
  nextRequestAt = Date.now() + waitMs + 110;
  if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs));
  init?.signal?.throwIfAborted?.();
  return fetchImpl(url, init);
}
export function validatedTcgcsvFeedDate(value, now = new Date()) {
  const text = value instanceof Date ? value.toISOString() : String(value ?? "").trim();
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:?\d{2})$/.test(text)) {
    throw new Error("TCGCSV feed clock is missing or invalid; refusing to invent an observation date.");
  }
  const date = new Date(text);
  if (!Number.isFinite(date.getTime()) || date.getTime() > now.getTime() + 5 * 60_000) {
    throw new Error("TCGCSV feed clock is invalid or in the future.");
  }
  // An old clock is valid evidence, but must remain old and be flagged stale.
  return date;
}

export async function fetchTcgcsvFeedDate({ fetchImpl = fetch, timeoutMs = 10_000,
  retryAttempts = 3, retryWaitMs = 500 } = {}) {
  let lastError;
  for (let attempt = 0; attempt < retryAttempts; attempt += 1) {
    const controller = new AbortController();
    let timer;
    const deadline = new Promise((_, reject) => {
      timer = setTimeout(() => {
        controller.abort();
        reject(new Error("TCGCSV feed clock request timed out."));
      }, timeoutMs);
    });
    try {
      return await Promise.race([deadline, (async () => {
        const response = await tcgcsvFetch("https://tcgcsv.com/last-updated.txt", {
          headers: { accept: "text/plain", "user-agent": "MintBinderLocalImporter/0.1" },
          signal: controller.signal,
        }, fetchImpl);
        if (!response.ok) throw new Error(`TCGCSV feed clock request failed: HTTP ${response.status}.`);
        const reader = response.body?.getReader?.();
        let body = "";
        if (reader) {
          let bytes = 0;
          const decoder = new TextDecoder();
          try {
            while (true) {
              const { done, value } = await reader.read();
              if (done) break;
              bytes += value.byteLength;
              if (bytes > 256) {
                await reader.cancel();
                throw new Error("TCGCSV feed clock response is oversized.");
              }
              body += decoder.decode(value, { stream: true });
            }
            body += decoder.decode();
          } finally { reader.releaseLock(); }
        } else {
          body = await response.text();
          if (Buffer.byteLength(body) > 256) throw new Error("TCGCSV feed clock response is oversized.");
        }
        return validatedTcgcsvFeedDate(body);
      })()]);
    } catch (error) {
      lastError = error;
      if (attempt + 1 < retryAttempts) await new Promise((resolve) => setTimeout(resolve, retryWaitMs));
    } finally {
      clearTimeout(timer);
      controller.abort();
    }
  }
  throw lastError;
}

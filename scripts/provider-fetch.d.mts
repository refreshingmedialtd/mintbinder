export class ProviderFetchError extends Error {
  retryAfterMs?: number;
  status?: number;
}

export function fetchJsonWithRetry(options: {
  fetchImpl?: typeof fetch;
  init?: RequestInit;
  maxResponseBytes?: number;
  maxRetryWaitMs?: number;
  onAttempt?: (attempt: number) => void;
  provider?: string;
  random?: () => number;
  retryAttempts?: number;
  retryInvalidResponse?: boolean;
  retryWaitMs?: number;
  timeoutMs?: number;
  url: URL | string;
  validate?: (body: unknown, response: Response) => boolean;
}): Promise<{ attempts: number; body: unknown; response: Response }>;

export function retryDelayMilliseconds(options: {
  attempt: number;
  maxRetryWaitMs?: number;
  random?: () => number;
  retryAfterMs?: number;
  retryWaitMs?: number;
}): number;

export function retryAfterMilliseconds(value: unknown, now?: number): number | undefined;

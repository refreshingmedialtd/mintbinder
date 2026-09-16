export function validatedTcgcsvFeedDate(value: Date | string, now?: Date): Date;
export function tcgcsvFetch(url: string, init?: RequestInit, fetchImpl?: typeof fetch): Promise<Response>;
export function fetchTcgcsvFeedDate(options?: { fetchImpl?: typeof fetch; timeoutMs?: number;
  retryAttempts?: number; retryWaitMs?: number }): Promise<Date>;

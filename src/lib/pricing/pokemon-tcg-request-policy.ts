export class PokemonTcgApiRequestError extends Error {
  retryAfterMs?: number;
  status: number;

  constructor(message: string, status: number, retryAfterMs?: number, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = "PokemonTcgApiRequestError";
    this.retryAfterMs = retryAfterMs;
    this.status = status;
  }
}

export const pokemonTcgDefaultRetryAttempts = 2;
export const pokemonTcgMaxRetryAttempts = 2;
export const pokemonTcgMaxRetryWaitMs = 2_000;
export const pokemonTcgMaxTimeoutMs = 22_000;
export const pokemonTcgRetryTimeoutMs = 2_000;
export const pokemonTcgMaxRequestBudgetMs =
  pokemonTcgMaxTimeoutMs +
  (pokemonTcgMaxRetryAttempts - 1) * pokemonTcgRetryTimeoutMs +
  (pokemonTcgMaxRetryAttempts - 1) * pokemonTcgMaxRetryWaitMs;
export const pokemonTcgSetRetryBaseMs = 30 * 60 * 1_000;
export const pokemonTcgSetRetryMaxMs = 6 * 60 * 60 * 1_000;

export function exhaustedPokemonTcgRequestError(
  error: unknown,
  attempts: number,
  resource: "cards" | "sets",
) {
  if (error instanceof PokemonTcgApiRequestError) {
    const originalMessage = error.message.replace(/[.\s]+$/, "");

    return new PokemonTcgApiRequestError(
      `${originalMessage} after ${attempts} attempts.`,
      error.status,
      error.retryAfterMs,
      error,
    );
  }

  const detail = deepestErrorMessage(error);
  const suffix = detail ? `: ${detail}` : ".";

  return new PokemonTcgApiRequestError(
    `Pokemon TCG ${resource} request failed after ${attempts} attempts${suffix}`,
    0,
    undefined,
    error,
  );
}

export function isSkippablePokemonTcgSetPricingError(error: unknown) {
  if (error instanceof PokemonTcgApiRequestError) {
    return error.status === 0 ||
      error.status === 404 ||
      isRetryablePokemonTcgStatus(error.status);
  }

  if (error instanceof DOMException && ["AbortError", "TimeoutError"].includes(error.name)) {
    return true;
  }

  return error instanceof TypeError && /fetch|network|socket|timeout/i.test(error.message);
}

export function isRetryablePokemonTcgStatus(status: number) {
  return status === 408 || status === 425 || status === 429 || status >= 500;
}

export function pokemonTcgApiRetryAttempts(env: Record<string, string | undefined> = process.env) {
  return Math.min(
    pokemonTcgMaxRetryAttempts,
    optionalPositiveInteger(env.POKEMON_TCG_API_RETRY_ATTEMPTS) ?? pokemonTcgDefaultRetryAttempts,
  );
}

export function pokemonTcgApiRetryWaitMs(env: Record<string, string | undefined> = process.env) {
  return Math.min(
    pokemonTcgMaxRetryWaitMs,
    optionalNonNegativeInteger(env.POKEMON_TCG_API_RETRY_WAIT_MS) ?? 1_500,
  );
}

export function pokemonTcgApiTimeoutMs(env: Record<string, string | undefined> = process.env) {
  return Math.min(
    pokemonTcgMaxTimeoutMs,
    optionalPositiveInteger(env.POKEMON_TCG_API_TIMEOUT_MS) ?? pokemonTcgMaxTimeoutMs,
  );
}

export function pokemonTcgApiAttemptTimeoutMs(
  attempt: number,
  env: Record<string, string | undefined> = process.env,
) {
  const primaryTimeoutMs = pokemonTcgApiTimeoutMs(env);

  return Math.max(1, Math.floor(attempt) || 1) === 1
    ? primaryTimeoutMs
    : Math.min(primaryTimeoutMs, pokemonTcgRetryTimeoutMs);
}

export function pokemonTcgSetRetryAfter({
  attemptedAt,
  consecutiveFailures,
  retryAfterMs,
  status,
}: {
  attemptedAt: string;
  consecutiveFailures: number;
  retryAfterMs?: number;
  status: number | null;
}) {
  const attemptedAtMs = Date.parse(attemptedAt);

  if (!Number.isFinite(attemptedAtMs)) {
    return null;
  }

  if (status === 404) {
    return new Date(attemptedAtMs + 7 * 24 * 60 * 60 * 1_000).toISOString();
  }

  if (status !== null && status !== 0 && !isRetryablePokemonTcgStatus(status)) {
    return null;
  }

  const failureCount = Math.max(1, Math.min(10, Math.floor(consecutiveFailures) || 1));
  const exponentialDelay = Math.min(
    pokemonTcgSetRetryMaxMs,
    pokemonTcgSetRetryBaseMs * (2 ** (failureCount - 1)),
  );
  const providerDelay = Number.isFinite(retryAfterMs) && Number(retryAfterMs) > 0
    ? Math.min(24 * 60 * 60 * 1_000, Math.floor(Number(retryAfterMs)))
    : 0;

  return new Date(attemptedAtMs + Math.max(exponentialDelay, providerDelay)).toISOString();
}

function deepestErrorMessage(error: unknown) {
  let current = error;
  let message = "";

  for (let depth = 0; depth < 5 && current && typeof current === "object"; depth += 1) {
    if (current instanceof Error && current.message.trim()) {
      message = current.message.trim();
    }

    current = "cause" in current ? current.cause : undefined;
  }

  return message;
}

function optionalPositiveInteger(value: unknown) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return undefined;
  }

  return Math.floor(number);
}

function optionalNonNegativeInteger(value: unknown) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return undefined;
  }

  return Math.floor(number);
}

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

export const pokemonTcgMaxRetryWaitMs = 5_000;

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

export function pokemonTcgApiTimeoutMs(env: Record<string, string | undefined> = process.env) {
  return optionalPositiveInteger(env.POKEMON_TCG_API_TIMEOUT_MS) ?? 15_000;
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

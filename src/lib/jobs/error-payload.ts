export function jobErrorResultPayload(error: unknown) {
  if (!error || typeof error !== "object" || !("resultPayload" in error)) {
    return {};
  }

  const payload = (error as { resultPayload?: unknown }).resultPayload;

  return payload && typeof payload === "object" ? payload : {};
}

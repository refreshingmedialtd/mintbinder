export const privateReadHeaders = {
  "cache-control": "no-store",
};

export function databaseReadUnavailableResult(message = "Data is temporarily unavailable.") {
  return {
    body: { error: message },
    headers: privateReadHeaders,
    status: 503,
  } as const;
}

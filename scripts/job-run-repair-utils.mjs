const maxPostgresInt = 2_147_483_647;

export function boundedJobDurationMs(startedAt, finishedAt) {
  const actualDurationMs = Math.max(0, finishedAt.getTime() - startedAt.getTime());

  return {
    actualDurationMs,
    durationMs: Math.min(actualDurationMs, maxPostgresInt),
    durationWasCapped: actualDurationMs > maxPostgresInt,
  };
}

export function jobRunHeartbeatIntervalMs(leaseMinutes) {
  const number = Number(leaseMinutes);
  const safeLeaseMinutes = Number.isFinite(number) && number > 0 ? Math.floor(number) : 45;

  return Math.max(10_000, Math.floor((safeLeaseMinutes * 60 * 1_000) / 3));
}

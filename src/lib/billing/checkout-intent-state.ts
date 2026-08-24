export function checkoutPreparationCanBeReclaimed({
  leaseMs,
  now,
  status,
  updatedAt,
}: {
  leaseMs: number;
  now: Date;
  status: string;
  updatedAt: Date;
}) {
  return status === "recoverable" ||
    (status === "creating" && updatedAt.getTime() <= now.getTime() - leaseMs);
}

export type AuthThrottleKey = {
  action: string;
  blockMs?: number;
  hash: string;
  limit: number;
  windowMs?: number;
};

export type AuthThrottleRecord = {
  action: string;
  attempts: number;
  blockedUntil: Date | null;
  keyHash: string;
  updatedAt: Date;
  windowStartedAt: Date;
};

export type AuthThrottleRepository = {
  deleteMatching(records: readonly AuthThrottleReservationRecord[]): Promise<void>;
  findMany(keyHashes: readonly string[]): Promise<AuthThrottleRecord[]>;
  save(records: readonly AuthThrottleRecord[]): Promise<void>;
};

/**
 * The store must hold exclusive locks for every supplied key until the callback
 * completes. Implementations must acquire the keys in lexical order so that
 * requests which share only some throttle keys cannot deadlock.
 */
export type AtomicAuthThrottleStore = {
  withLockedKeys<T>(
    keyHashes: readonly string[],
    operation: (repository: AuthThrottleRepository) => Promise<T>,
  ): Promise<T>;
};

export type AuthThrottleConsumption = {
  allowed: boolean;
  keyHashes: string[];
  reservation: AuthThrottleReservation;
  retryAfterSeconds: number;
};

export type AuthThrottleReservationRecord = Pick<
  AuthThrottleRecord,
  "attempts" | "keyHash" | "updatedAt" | "windowStartedAt"
>;

export type AuthThrottleReservation = {
  records: AuthThrottleReservationRecord[];
};

type ConsumeOptions = {
  blockMs: number;
  now: Date;
  windowMs: number;
};

/**
 * Atomically reserves one authentication attempt before any expensive password
 * or token work begins. The final allowed attempt starts the block immediately,
 * but is itself allowed to continue; a successful caller subsequently clears
 * its throttle keys.
 */
export async function consumeAuthThrottleAttempt(
  store: AtomicAuthThrottleStore,
  keys: readonly AuthThrottleKey[],
  options: ConsumeOptions,
): Promise<AuthThrottleConsumption> {
  const sortedKeys = uniqueSortedKeys(keys);
  const keyHashes = sortedKeys.map((key) => key.hash);

  if (!sortedKeys.length) {
    return { allowed: true, keyHashes, reservation: { records: [] }, retryAfterSeconds: 0 };
  }

  return store.withLockedKeys(keyHashes, async (repository) => {
    const records = await repository.findMany(keyHashes);
    const recordsByHash = new Map(records.map((record) => [record.keyHash, record]));
    const nowMs = options.now.getTime();
    const activeBlocks = sortedKeys
      .map((key) => recordsByHash.get(key.hash)?.blockedUntil ?? null)
      .filter((blockedUntil): blockedUntil is Date => blockedUntil !== null && blockedUntil.getTime() > nowMs);

    // Match the old assert-before-record behaviour: when any scope is already
    // blocked, reject without consuming the other (potentially unblocked) scope.
    if (activeBlocks.length) {
      return {
        allowed: false,
        keyHashes,
        reservation: { records: [] },
        retryAfterSeconds: retryAfterSeconds(activeBlocks, nowMs),
      };
    }

    const mutations = sortedKeys.map((key) => {
      const windowMs = key.windowMs ?? options.windowMs;
      const blockMs = key.blockMs ?? options.blockMs;
      const windowCutoffMs = nowMs - windowMs;
      const previous = recordsByHash.get(key.hash);
      const resetWindow = !previous ||
        previous.windowStartedAt.getTime() < windowCutoffMs ||
        (previous.blockedUntil !== null && previous.blockedUntil.getTime() <= nowMs);
      const attempts = resetWindow ? 1 : previous.attempts + 1;
      const blockedUntil = attempts >= key.limit
        ? new Date(nowMs + blockMs)
        : null;

      return {
        action: key.action,
        attempts,
        blockedUntil,
        keyHash: key.hash,
        updatedAt: options.now,
        windowStartedAt: resetWindow ? options.now : previous.windowStartedAt,
      } satisfies AuthThrottleRecord;
    });

    await repository.save(mutations);

    const allowed = mutations.every((record, index) => record.attempts <= sortedKeys[index].limit);
    const newBlocks = mutations
      .map((record) => record.blockedUntil)
      .filter((blockedUntil): blockedUntil is Date => blockedUntil !== null);

    return {
      allowed,
      keyHashes,
      reservation: {
        records: mutations.map((record) => ({
          attempts: record.attempts,
          keyHash: record.keyHash,
          updatedAt: record.updatedAt,
          windowStartedAt: record.windowStartedAt,
        })),
      },
      retryAfterSeconds: allowed ? 0 : retryAfterSeconds(newBlocks, nowMs),
    };
  });
}

/**
 * Clears only the exact reservation which authenticated successfully. If a
 * concurrent request consumed the same key after this one, its newer attempt
 * remains in place instead of being erased by the successful request.
 */
export async function clearAuthThrottleReservation(
  store: AtomicAuthThrottleStore,
  reservation: AuthThrottleReservation,
) {
  const records = reservation.records
    .slice()
    .sort((left, right) => left.keyHash.localeCompare(right.keyHash));

  if (!records.length) return;

  await store.withLockedKeys(
    records.map((record) => record.keyHash),
    (repository) => repository.deleteMatching(records),
  );
}

function uniqueSortedKeys(keys: readonly AuthThrottleKey[]) {
  const unique = new Map<string, AuthThrottleKey>();

  for (const key of keys) {
    const existing = unique.get(key.hash);

    if (!existing || key.limit < existing.limit) {
      unique.set(key.hash, key);
    }
  }

  return [...unique.values()].sort((left, right) => left.hash.localeCompare(right.hash));
}

function retryAfterSeconds(blockedUntilValues: readonly Date[], nowMs: number) {
  const longestWaitMs = blockedUntilValues.reduce(
    (longest, blockedUntil) => Math.max(longest, blockedUntil.getTime() - nowMs),
    0,
  );

  return Math.max(1, Math.ceil(longestWaitMs / 1000));
}

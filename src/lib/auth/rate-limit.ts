import { createHmac } from "node:crypto";
import { Prisma } from "@prisma/client";
import {
  clearAuthThrottleReservation,
  consumeAuthThrottleAttempt,
  type AtomicAuthThrottleStore,
  type AuthThrottleReservation,
} from "@/lib/auth/rate-limit-core";
import { requiredAuthSecret } from "@/lib/auth/secret";
import { prisma } from "@/lib/db/prisma";

const WINDOW_MS = 15 * 60 * 1000;
const BLOCK_MS = 15 * 60 * 1000;
const EMAIL_ATTEMPT_LIMIT = 8;
const IP_ATTEMPT_LIMIT = 30;
// The browser's bounded CSV importer legitimately performs up to 500 writes.
// Keep enough headroom for that workflow while retaining a persistent ceiling
// against unbounded request floods.
const USER_MUTATION_LIMIT = 600;
const IP_MUTATION_LIMIT = 3_000;
const MAIL_RECIPIENT_HOURLY_LIMIT = 3;
const MAIL_RECIPIENT_DAILY_LIMIT = 6;
const MAIL_IP_HOURLY_LIMIT = 20;
const MAIL_IP_DAILY_LIMIT = 120;
const HOUR_MS = 60 * 60 * 1_000;
const DAY_MS = 24 * HOUR_MS;

type RateLimitContext = {
  action:
    | "credentials"
    | "password-reset"
    | "password-reset-confirm"
    | "verification"
    | "verification-confirm"
    | "mutation";
  email?: string | null;
  request?: Request;
};

type ThrottleKey = {
  action: RateLimitContext["action"];
  blockMs?: number;
  hash: string;
  limit: number;
  windowMs?: number;
};

export class AuthRateLimitError extends Error {
  retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super("Too many attempts. Please wait and try again.");
    this.name = "AuthRateLimitError";
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

export async function consumeAuthAttempt(context: RateLimitContext) {
  const consumption = await consumeAuthThrottleAttempt(
    authThrottleStore,
    throttleKeys(context),
    {
      blockMs: BLOCK_MS,
      now: new Date(),
      windowMs: WINDOW_MS,
    },
  );

  if (!consumption.allowed) {
    throw new AuthRateLimitError(consumption.retryAfterSeconds);
  }

  return consumption.reservation;
}

export async function consumeUserMutationAttempt({
  request,
  userId,
}: {
  request: Request;
  userId: string;
}) {
  const action = "mutation" as const;
  const consumption = await consumeAuthThrottleAttempt(
    authThrottleStore,
    [
      {
        action,
        hash: throttleHash(action, "user", userId),
        limit: USER_MUTATION_LIMIT,
      },
      {
        action,
        hash: throttleHash(action, "ip", requestIp(request)),
        limit: IP_MUTATION_LIMIT,
      },
    ],
    {
      blockMs: BLOCK_MS,
      now: new Date(),
      windowMs: WINDOW_MS,
    },
  );

  if (!consumption.allowed) throw new AuthRateLimitError(consumption.retryAfterSeconds);
}

export async function clearAuthFailures(reservation: AuthThrottleReservation) {
  await clearAuthThrottleReservation(authThrottleStore, reservation);
}

export function requestIp(request?: Request) {
  if (!request) return "unknown";

  const realIp = request.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp.slice(0, 80);

  const forwarded = request.headers.get("x-forwarded-for")
    ?.split(",")
    .map((value) => value.trim())
    .filter(Boolean);

  return forwarded?.at(-1)?.slice(0, 80) || "unknown";
}

function throttleKeys(context: RateLimitContext): ThrottleKey[] {
  const keys: ThrottleKey[] = [];
  const email = context.email?.trim().toLowerCase();
  const ip = requestIp(context.request);
  const sendsEmail = context.action === "password-reset" || context.action === "verification";

  if (sendsEmail) {
    if (email) {
      keys.push(
        mailThrottleKey(context.action, "email-hour", email, MAIL_RECIPIENT_HOURLY_LIMIT, HOUR_MS),
        mailThrottleKey(context.action, "email-day", email, MAIL_RECIPIENT_DAILY_LIMIT, DAY_MS),
      );
    }
    keys.push(
      mailThrottleKey(context.action, "ip-hour", ip, MAIL_IP_HOURLY_LIMIT, HOUR_MS),
      mailThrottleKey(context.action, "ip-day", ip, MAIL_IP_DAILY_LIMIT, DAY_MS),
    );
    return keys;
  }

  if (email) {
    keys.push({
      action: context.action,
      hash: throttleHash(context.action, "email", email),
      limit: EMAIL_ATTEMPT_LIMIT,
    });
  }

  keys.push({
    action: context.action,
    hash: throttleHash(context.action, "ip", ip),
    limit: IP_ATTEMPT_LIMIT,
  });

  return keys;
}

function mailThrottleKey(
  action: RateLimitContext["action"],
  scope: string,
  value: string,
  limit: number,
  windowMs: number,
): ThrottleKey {
  return {
    action,
    blockMs: windowMs,
    hash: throttleHash(action, scope, value),
    limit,
    windowMs,
  };
}

function throttleHash(action: string, scope: string, value: string) {
  return createHmac("sha256", requiredAuthSecret())
    .update(`${action}:${scope}:${value}`)
    .digest("hex");
}

const authThrottleStore: AtomicAuthThrottleStore = {
  async withLockedKeys(keyHashes, operation) {
    const sortedHashes = [...new Set(keyHashes)].sort((left, right) => left.localeCompare(right));

    return prisma.$transaction(async (transaction) => {
      // Transaction-scoped advisory locks make the read/modify/write sequence
      // atomic for both existing and not-yet-created throttle rows. Sorting is
      // required because an attempt can share an IP key but not an email key.
      for (const keyHash of sortedHashes) {
        await transaction.$queryRaw(Prisma.sql`
          SELECT pg_advisory_xact_lock(hashtextextended(${keyHash}, 0::bigint))
        `);
      }

      return operation({
        async deleteMatching(records) {
          for (const record of records) {
            await transaction.authThrottle.deleteMany({
              where: {
                attempts: record.attempts,
                keyHash: record.keyHash,
                updatedAt: record.updatedAt,
                windowStartedAt: record.windowStartedAt,
              },
            });
          }
        },
        findMany(hashes) {
          return transaction.authThrottle.findMany({
            where: { keyHash: { in: [...hashes] } },
          });
        },
        async save(records) {
          for (const record of records) {
            await transaction.authThrottle.upsert({
              where: { keyHash: record.keyHash },
              create: record,
              update: {
                action: record.action,
                attempts: record.attempts,
                blockedUntil: record.blockedUntil,
                updatedAt: record.updatedAt,
                windowStartedAt: record.windowStartedAt,
              },
            });
          }
        },
      });
    });
  },
};

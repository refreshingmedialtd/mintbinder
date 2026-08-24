import { PasswordResetOutboxStatus } from "@prisma/client";
import { sendPasswordResetEmail } from "@/lib/auth/account-tokens";
import { requiredAuthSecret } from "@/lib/auth/secret";
import {
  passwordResetRecipientKey,
  processPasswordResetOutbox,
  type PasswordResetDeliveryResult,
  type PasswordResetDeliveryStore,
} from "@/lib/auth/password-reset-outbox-core";
import { prisma } from "@/lib/db/prisma";
import { isEmailConfigured } from "@/lib/notifications/email";

const DEFAULT_BATCH_SIZE = 50;
const MAXIMUM_BATCH_SIZE = 100;
const DEFAULT_STALE_AFTER_MS = 15 * 60 * 1_000;
const INVALID_EMAIL_LOOKUP = "<invalid-password-reset-recipient>";

export class PasswordResetDeliveryError extends Error {
  resultPayload: PasswordResetDeliveryResult;

  constructor(result: PasswordResetDeliveryResult) {
    super(
      `${result.unresolved} password-reset delivery claim${result.unresolved === 1 ? "" : "s"} require reconciliation.`,
    );
    this.name = "PasswordResetDeliveryError";
    this.resultPayload = result;
  }
}

export async function enqueuePasswordResetRequest(email: string | null) {
  const secret = requiredAuthSecret();
  const recipientKey = passwordResetRecipientKey(email, secret);

  return prisma.$transaction(async (transaction) => {
    // Valid known and unknown recipients take the same durable query/create
    // path. Unknown raw addresses are used for this indexed lookup only and
    // never copied into the outbox or logs.
    const user = await transaction.user.findUnique({
      where: { email: email ?? INVALID_EMAIL_LOOKUP },
      select: { id: true },
    });

    // A nullable unique key makes coalescing atomic across Node processes.
    // Terminal rows clear this key so they remain available for audit while a
    // later genuine request can create a fresh row. The same upsert path is
    // used for known recipients and privacy-preserving decoys.
    return transaction.passwordResetOutbox.upsert({
      where: { coalesceKey: recipientKey },
      create: {
        coalesceKey: recipientKey,
        recipientKey,
        userId: user?.id ?? null,
      },
      update: {
        userId: user?.id ?? null,
      },
      select: { id: true },
    });
  });
}

export async function runPasswordResetDelivery({
  batchSize = DEFAULT_BATCH_SIZE,
  now = new Date(),
  staleAfterMs = DEFAULT_STALE_AFTER_MS,
}: {
  batchSize?: number;
  now?: Date;
  staleAfterMs?: number;
} = {}) {
  if (!isEmailConfigured()) {
    throw new Error("Email delivery is not configured.");
  }

  const secret = requiredAuthSecret();
  const result = await processPasswordResetOutbox({
    batchSize: boundedBatchSize(batchSize),
    deliver: sendPasswordResetEmail,
    now,
    recipientMatches(recipientKey, recipient) {
      return recipientKey === passwordResetRecipientKey(recipient.email, secret);
    },
    staleAfterMs: boundedStaleAfterMs(staleAfterMs),
    store: passwordResetDeliveryStore,
  });

  if (result.unresolved > 0) {
    throw new PasswordResetDeliveryError(result);
  }

  return result;
}

const passwordResetDeliveryStore: PasswordResetDeliveryStore = {
  async claim(id, now) {
    const claim = await prisma.passwordResetOutbox.updateMany({
      where: { id, status: PasswordResetOutboxStatus.QUEUED },
      data: { claimedAt: now, status: PasswordResetOutboxStatus.CLAIMED },
    });
    return claim.count === 1;
  },
  async discard(id, now) {
    const discarded = await prisma.passwordResetOutbox.updateMany({
      where: { id, status: PasswordResetOutboxStatus.CLAIMED },
      data: {
        coalesceKey: null,
        discardedAt: now,
        status: PasswordResetOutboxStatus.DISCARDED,
      },
    });
    if (discarded.count !== 1) throw new Error("Password-reset decoy could not be discarded safely.");
  },
  findQueued(limit, now) {
    return prisma.passwordResetOutbox.findMany({
      where: { createdAt: { lte: now }, status: PasswordResetOutboxStatus.QUEUED },
      orderBy: [{ createdAt: "asc" }, { id: "asc" }],
      select: { id: true, recipientKey: true, userId: true },
      take: limit,
    });
  },
  loadRecipient(userId) {
    return prisma.user.findUnique({
      where: { id: userId },
      select: { displayName: true, email: true, id: true },
    });
  },
  async markAttempted(id, now) {
    const attempted = await prisma.passwordResetOutbox.updateMany({
      where: {
        deliveryAttemptedAt: null,
        id,
        status: PasswordResetOutboxStatus.CLAIMED,
      },
      data: { deliveryAttemptedAt: now },
    });
    if (attempted.count !== 1) throw new Error("Password-reset delivery could not cross its attempt boundary safely.");
  },
  async markSent(id, providerMessageId, now) {
    const sent = await prisma.passwordResetOutbox.updateMany({
      where: {
        deliveryAttemptedAt: { not: null },
        id,
        status: PasswordResetOutboxStatus.CLAIMED,
      },
      data: {
        coalesceKey: null,
        providerMessageId: providerMessageId?.trim().slice(0, 255) || null,
        sentAt: now,
        status: PasswordResetOutboxStatus.SENT,
      },
    });
    if (sent.count !== 1) throw new Error("Password-reset delivery could not be completed safely.");
  },
  async markStaleClaimsUnresolved(staleBefore, now) {
    const unresolved = await prisma.passwordResetOutbox.updateMany({
      where: {
        claimedAt: { lte: staleBefore },
        status: PasswordResetOutboxStatus.CLAIMED,
      },
      data: {
        coalesceKey: null,
        errorCode: "StaleWorkerClaim",
        status: PasswordResetOutboxStatus.UNRESOLVED,
        unresolvedAt: now,
      },
    });
    return unresolved.count;
  },
  async markUnresolved(id, error, now) {
    await prisma.passwordResetOutbox.updateMany({
      where: { id, status: PasswordResetOutboxStatus.CLAIMED },
      data: {
        coalesceKey: null,
        errorCode: errorCode(error),
        status: PasswordResetOutboxStatus.UNRESOLVED,
        unresolvedAt: now,
      },
    });
  },
};

function boundedBatchSize(value: number) {
  if (!Number.isFinite(value) || value <= 0) return DEFAULT_BATCH_SIZE;
  return Math.min(MAXIMUM_BATCH_SIZE, Math.floor(value));
}

function boundedStaleAfterMs(value: number) {
  if (!Number.isFinite(value) || value < 60_000) return DEFAULT_STALE_AFTER_MS;
  return Math.min(24 * 60 * 60 * 1_000, Math.floor(value));
}

function errorCode(error: unknown) {
  const value = error instanceof Error ? error.name : "UnknownError";
  return value.replace(/[^A-Za-z0-9_.-]/g, "").slice(0, 80) || "UnknownError";
}

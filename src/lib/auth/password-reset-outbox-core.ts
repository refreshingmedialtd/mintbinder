import { createHmac } from "node:crypto";

export type PasswordResetOutboxRow = {
  id: string;
  recipientKey: string;
  userId: string | null;
};

export type PasswordResetRecipient = {
  displayName: string | null;
  email: string;
  id: string;
};

export type PasswordResetDeliveryStore = {
  claim(id: string, now: Date): Promise<boolean>;
  discard(id: string, now: Date): Promise<void>;
  findQueued(limit: number, now: Date): Promise<PasswordResetOutboxRow[]>;
  loadRecipient(userId: string): Promise<PasswordResetRecipient | null>;
  markAttempted(id: string, now: Date): Promise<void>;
  markSent(id: string, providerMessageId: string | undefined, now: Date): Promise<void>;
  markStaleClaimsUnresolved(staleBefore: Date, now: Date): Promise<number>;
  markUnresolved(id: string, error: unknown, now: Date): Promise<void>;
};

export type PasswordResetDeliveryResult = {
  claimed: number;
  discarded: number;
  queued: number;
  sent: number;
  skippedClaims: number;
  staleClaimsMarkedUnresolved: number;
  unresolved: number;
};

export function passwordResetRecipientKey(email: string | null, secret: string) {
  const recipient = email ?? "<invalid-password-reset-recipient>";

  return createHmac("sha256", secret)
    .update(`password-reset\0${recipient}`)
    .digest("hex");
}

export async function processPasswordResetOutbox({
  batchSize,
  deliver,
  now = new Date(),
  recipientMatches,
  staleAfterMs,
  store,
}: {
  batchSize: number;
  deliver: (recipient: PasswordResetRecipient) => Promise<{ id?: string }>;
  now?: Date;
  recipientMatches: (recipientKey: string, recipient: PasswordResetRecipient) => boolean;
  staleAfterMs: number;
  store: PasswordResetDeliveryStore;
}): Promise<PasswordResetDeliveryResult> {
  const staleBefore = new Date(now.getTime() - staleAfterMs);
  const staleClaimsMarkedUnresolved = await store.markStaleClaimsUnresolved(staleBefore, now);
  const rows = await store.findQueued(batchSize, now);
  const result: PasswordResetDeliveryResult = {
    claimed: 0,
    discarded: 0,
    queued: rows.length,
    sent: 0,
    skippedClaims: 0,
    staleClaimsMarkedUnresolved,
    unresolved: staleClaimsMarkedUnresolved,
  };

  for (const row of rows) {
    if (!(await store.claim(row.id, now))) {
      result.skippedClaims += 1;
      continue;
    }

    result.claimed += 1;
    const recipient = row.userId ? await store.loadRecipient(row.userId) : null;

    // A null user is the deliberately indistinguishable unknown-recipient path.
    // A changed address is also discarded: the reset must never be rerouted to
    // an address that was not present when the public request was accepted.
    if (!recipient || !recipientMatches(row.recipientKey, recipient)) {
      await store.discard(row.id, now);
      result.discarded += 1;
      continue;
    }

    try {
      // Once this durable boundary is crossed, any error or process loss may
      // have happened after the provider accepted the message. Claims are
      // therefore never reclaimed automatically.
      await store.markAttempted(row.id, now);
      const delivery = await deliver(recipient);
      await store.markSent(row.id, delivery.id, now);
      result.sent += 1;
    } catch (error) {
      await store.markUnresolved(row.id, error, now).catch((markError) => {
        console.error("Unable to mark a password-reset delivery as unresolved.", markError);
      });
      result.unresolved += 1;
    }
  }

  return result;
}

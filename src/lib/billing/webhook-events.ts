import { BillingWebhookStatus, Prisma } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";

const PROCESSING_LEASE_MS = 10 * 60 * 1000;

export async function processBillingWebhookEvent<T>({
  eventId,
  eventType,
  fulfill,
  occurredAt,
  provider,
}: {
  eventId: string;
  eventType: string;
  fulfill: () => Promise<T>;
  occurredAt?: Date;
  provider: string;
}): Promise<{ duplicate: boolean; inProgress?: boolean; result?: T }> {
  const normalizedEventId = eventId.trim();

  if (!normalizedEventId || normalizedEventId.length > 255) {
    throw new Error("Billing webhook event ID is missing or invalid.");
  }

  const claim = await claimWebhookEvent({
    eventId: normalizedEventId,
    eventType,
    occurredAt,
    provider,
  });

  if (claim !== "claimed") {
    return { duplicate: true, inProgress: claim === "processing" };
  }

  try {
    const result = await fulfill();

    await prisma.billingWebhookEvent.update({
      where: { provider_providerEventId: { provider, providerEventId: normalizedEventId } },
      data: {
        status: BillingWebhookStatus.SUCCEEDED,
        processedAt: new Date(),
        errorMessage: null,
      },
    });

    return { duplicate: false, result };
  } catch (error) {
    await prisma.billingWebhookEvent.update({
      where: { provider_providerEventId: { provider, providerEventId: normalizedEventId } },
      data: {
        status: BillingWebhookStatus.FAILED,
        processedAt: new Date(),
        errorMessage: safeErrorMessage(error),
      },
    }).catch((updateError) => {
      console.error("Unable to record failed billing webhook.", updateError);
    });

    throw error;
  }
}

async function claimWebhookEvent({
  eventId,
  eventType,
  occurredAt,
  provider,
}: {
  eventId: string;
  eventType: string;
  occurredAt?: Date;
  provider: string;
}) {
  const existing = await prisma.billingWebhookEvent.findUnique({
    where: { provider_providerEventId: { provider, providerEventId: eventId } },
  });

  if (existing) {
    const processingIsFresh =
      existing.status === BillingWebhookStatus.PROCESSING &&
      Date.now() - existing.updatedAt.getTime() < PROCESSING_LEASE_MS;

    if (existing.status === BillingWebhookStatus.SUCCEEDED) {
      return "succeeded" as const;
    }

    if (processingIsFresh) {
      return "processing" as const;
    }

    // Claim retries atomically. A read-then-update here allows two concurrent
    // deliveries of the same failed (or lease-expired) event to both run the
    // fulfilment side effect.
    const reclaimed = await prisma.billingWebhookEvent.updateMany({
      where: {
        id: existing.id,
        OR: [
          { status: BillingWebhookStatus.FAILED },
          {
            status: BillingWebhookStatus.PROCESSING,
            updatedAt: { lt: new Date(Date.now() - PROCESSING_LEASE_MS) },
          },
        ],
      },
      data: {
        status: BillingWebhookStatus.PROCESSING,
        eventType: boundedEventType(eventType),
        occurredAt,
        processedAt: null,
        errorMessage: null,
      },
    });
    return reclaimed.count === 1 ? "claimed" as const : "processing" as const;
  }

  try {
    await prisma.billingWebhookEvent.create({
      data: {
        provider,
        providerEventId: eventId,
        eventType: boundedEventType(eventType),
        occurredAt,
      },
    });
    return "claimed" as const;
  } catch (error) {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002") {
      return "processing" as const;
    }

    throw error;
  }
}

function boundedEventType(value: string) {
  return value.trim().slice(0, 160) || "unknown";
}

function safeErrorMessage(error: unknown) {
  const message = error instanceof Error ? error.message : "Webhook processing failed.";
  return message.replace(/[\r\n]+/g, " ").slice(0, 500);
}

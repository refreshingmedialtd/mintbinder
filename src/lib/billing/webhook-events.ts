import { BillingWebhookStatus, Prisma } from "@prisma/client";
import { prisma } from "../db/prisma.ts";
import { boundedBillingWebhookResourceId } from "./webhook-resource.ts";

const PROCESSING_LEASE_MS = 10 * 60 * 1000;
type BillingWebhookEventClient = Pick<typeof prisma, "billingWebhookEvent">;

export async function processBillingWebhookEvent<T>({
  eventId,
  eventType,
  fulfill,
  occurredAt,
  provider,
  resourceId,
}: {
  eventId: string;
  eventType: string;
  fulfill: () => Promise<T>;
  occurredAt?: Date;
  provider: string;
  resourceId?: string | null;
}, client: BillingWebhookEventClient = prisma): Promise<{ duplicate: boolean; inProgress?: boolean; result?: T }> {
  const normalizedEventId = eventId.trim();

  if (!normalizedEventId || normalizedEventId.length > 255) {
    throw new Error("Billing webhook event ID is missing or invalid.");
  }

  const claim = await claimWebhookEvent({
    eventId: normalizedEventId,
    eventType,
    occurredAt,
    provider,
    resourceId,
  }, client);

  if (claim !== "claimed") {
    return { duplicate: true, inProgress: claim === "processing" };
  }

  try {
    const result = await fulfill();

    await client.billingWebhookEvent.update({
      where: { provider_providerEventId: { provider, providerEventId: normalizedEventId } },
      data: {
        status: BillingWebhookStatus.SUCCEEDED,
        processedAt: new Date(),
        errorMessage: null,
      },
    });

    return { duplicate: false, result };
  } catch (error) {
    await client.billingWebhookEvent.update({
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
  resourceId,
}: {
  eventId: string;
  eventType: string;
  occurredAt?: Date;
  provider: string;
  resourceId?: string | null;
}, client: BillingWebhookEventClient) {
  const normalizedResourceId = boundedBillingWebhookResourceId(resourceId);
  const existing = await client.billingWebhookEvent.findUnique({
    where: { provider_providerEventId: { provider, providerEventId: eventId } },
  });

  if (existing) {
    if (
      existing.resourceId &&
      normalizedResourceId &&
      existing.resourceId !== normalizedResourceId
    ) {
      throw new Error("Billing webhook event resource ID does not match its original claim.");
    }

    const processingIsFresh =
      existing.status === BillingWebhookStatus.PROCESSING &&
      Date.now() - existing.updatedAt.getTime() < PROCESSING_LEASE_MS;

    if (existing.status === BillingWebhookStatus.SUCCEEDED) {
      if (!existing.resourceId && normalizedResourceId) {
        await client.billingWebhookEvent.updateMany({
          where: { id: existing.id, resourceId: null },
          data: { resourceId: normalizedResourceId },
        });
      }
      return "succeeded" as const;
    }

    if (processingIsFresh) {
      return "processing" as const;
    }

    // Claim retries atomically. A read-then-update here allows two concurrent
    // deliveries of the same failed (or lease-expired) event to both run the
    // fulfilment side effect.
    const reclaimed = await client.billingWebhookEvent.updateMany({
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
        ...(normalizedResourceId ? { resourceId: normalizedResourceId } : {}),
        processedAt: null,
        errorMessage: null,
      },
    });
    return reclaimed.count === 1 ? "claimed" as const : "processing" as const;
  }

  try {
    await client.billingWebhookEvent.create({
      data: {
        provider,
        providerEventId: eventId,
        resourceId: normalizedResourceId,
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

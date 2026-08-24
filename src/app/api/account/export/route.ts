import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { prisma } from "@/lib/db/prisma";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    const account = await prisma.user.findUnique({
      where: { id: session.user.id },
      select: {
        id: true,
        email: true,
        displayName: true,
        preferredCurrency: true,
        preferredRegion: true,
        role: true,
        createdAt: true,
        updatedAt: true,
        subscriptions: true,
        billingCheckoutIntents: {
          select: {
            id: true,
            provider: true,
            plan: true,
            status: true,
            expectedAmountMinor: true,
            expectedCurrency: true,
            providerPlanVariationId: true,
            expiresAt: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        billingCustomers: {
          select: {
            id: true,
            provider: true,
            providerCustomerId: true,
            provenance: true,
            createdAt: true,
            updatedAt: true,
          },
        },
        notificationPreference: true,
        notificationDeliveries: {
          select: {
            id: true,
            kind: true,
            periodKey: true,
            status: true,
            providerMessageId: true,
            errorCode: true,
            sentAt: true,
            ambiguousAt: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
        passwordResetOutbox: {
          select: {
            id: true,
            status: true,
            claimedAt: true,
            deliveryAttemptedAt: true,
            sentAt: true,
            discardedAt: true,
            unresolvedAt: true,
            providerMessageId: true,
            errorCode: true,
            createdAt: true,
            updatedAt: true,
          },
          orderBy: { createdAt: "asc" },
        },
        activeSetGoal: {
          include: {
            cardSet: {
              select: {
                id: true,
                name: true,
                language: true,
                region: true,
                series: true,
                releaseDate: true,
                printedTotal: true,
                total: true,
              },
            },
          },
        },
        storageLocations: true,
        collectionItems: {
          include: {
            events: { orderBy: { occurredAt: "asc" } },
            cardPrinting: {
              select: {
                id: true,
                name: true,
                number: true,
                language: true,
                cardSet: { select: { id: true, name: true } },
              },
            },
            sealedProduct: {
              select: {
                id: true,
                name: true,
                productType: true,
                relatedCardSet: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        wishlistItems: {
          include: {
            cardPrinting: {
              select: {
                id: true,
                name: true,
                number: true,
                cardSet: { select: { id: true, name: true } },
              },
            },
            sealedProduct: {
              select: {
                id: true,
                name: true,
                productType: true,
                relatedCardSet: { select: { id: true, name: true } },
              },
            },
          },
          orderBy: { createdAt: "asc" },
        },
        createdSealed: true,
        binders: {
          include: {
            pages: {
              include: { slots: { orderBy: { position: "asc" } } },
              orderBy: { position: "asc" },
            },
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });

    if (!account) {
      return NextResponse.json({ error: "Account not found." }, { status: 404 });
    }

    const exportDocument = {
      format: "mintbinder-account-export",
      schemaVersion: 3,
      exportedAt: new Date().toISOString(),
      account,
    };

    return new Response(`${JSON.stringify(exportDocument, null, 2)}\n`, {
      headers: {
        "cache-control": "no-store",
        "content-disposition": `attachment; filename="mintbinder-account-${dateStamp()}.json"`,
        "content-type": "application/json; charset=utf-8",
      },
    });
  } catch (error) {
    console.error("Unable to export account data.", error);
    return NextResponse.json({ error: "Unable to export account data." }, { status: 500 });
  }
}

function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

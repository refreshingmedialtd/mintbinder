import { NextResponse } from "next/server";
import { auth } from "@/auth";
import { entitlementStatus, requireEntitlement } from "@/lib/entitlements";
import { getAppData } from "@/lib/db/app-data";
import { buildCollectionIntelligence } from "@/lib/insights";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const session = await auth();

    if (!session?.user?.id) {
      return NextResponse.json({ error: "Authentication required." }, { status: 401 });
    }

    await requireEntitlement(session.user.id, "pricing.alerts");

    const data = await getAppData(session.user.id, {
      catalogueScope: "referenced",
      fallback: "throw",
    });
    const intelligence = buildCollectionIntelligence({
      catalogueById: new Map(data.catalogue.map((item) => [item.id, item])),
      collection: data.collection,
      events: data.events,
      sets: data.sets,
      storageLocations: data.storageLocations,
      wishlist: data.wishlist,
    });

    return NextResponse.json({ alerts: intelligence.priceAlerts });
  } catch (error) {
    const status = entitlementStatus(error);

    if (status === 500) {
      console.error("Unable to load price alerts.", error);
    }

    return NextResponse.json(
      { error: status === 403 ? "Plus subscription required." : "Unable to load price alerts." },
      { status },
    );
  }
}

import { NextResponse } from "next/server";
import { getSharedBinder } from "@/lib/db/binders";

export const dynamic = "force-dynamic";

type RouteContext = { params: Promise<{ slug: string }> };

export async function GET(_request: Request, context: RouteContext) {
  try {
    const { slug } = await context.params;
    const binder = await getSharedBinder(slug);

    if (!binder) {
      return NextResponse.json({ error: "Shared binder not found." }, { status: 404 });
    }

    // The public link needs display data, not tenant or database identifiers.
    // Keep the JSON endpoint aligned with the deliberately minimal shared page.
    return NextResponse.json(
      {
        binder: {
          name: binder.name,
          description: binder.description,
          coverStyle: binder.coverStyle,
          updatedAt: binder.updatedAt,
          pages: binder.pages.map((page) => ({
            position: page.position,
            slots: page.slots.map((slot) => ({
              position: slot.position,
              item: sharedItem(slot.collectionItem),
            })),
          })),
        },
      },
      {
        headers: {
          "cache-control": "no-store",
          "x-robots-tag": "noindex, nofollow",
        },
      },
    );
  } catch (error) {
    console.error("Unable to load shared binder.", error);
    return NextResponse.json({ error: "Unable to load shared binder." }, { status: 500 });
  }
}

function sharedItem(
  item: NonNullable<Awaited<ReturnType<typeof getSharedBinder>>>["pages"][number]["slots"][number]["collectionItem"],
) {
  if (!item) return null;

  if (item.cardPrinting) {
    return {
      type: "card" as const,
      name: item.cardPrinting.name,
      number: item.cardPrinting.number,
      imageUrl: item.cardPrinting.imageSmallUrl,
      setName: item.cardPrinting.cardSet.name,
    };
  }

  if (item.sealedProduct) {
    return {
      type: "sealed" as const,
      name: item.sealedProduct.name,
      productType: item.sealedProduct.productType,
      imageUrl: item.sealedProduct.imageUrl,
      setName: item.sealedProduct.relatedCardSet?.name ?? null,
    };
  }

  return null;
}

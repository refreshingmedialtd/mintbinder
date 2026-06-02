import { prisma } from "../db/prisma";
import {
  buildSealedImageRepairPlan,
  sealedImageRepairTargets,
  type TcgcsvProductImage,
} from "../catalogue/sealed-image-repair";

export type SealedImageRepairOptions = {
  dryRun?: boolean;
  fetchImpl?: typeof fetch;
  limit?: number;
  waitMs?: number;
};

const DEFAULT_REPAIR_LIMIT = 500;
const DEFAULT_WAIT_MS = 120;
const MAX_REPAIR_LIMIT = 5000;
const MAX_WAIT_MS = 5000;
const TCGCSV_POKEMON_CATEGORY_ID = 3;

export async function repairMissingTcgcsvSealedImages({
  dryRun = false,
  fetchImpl = fetch,
  limit = DEFAULT_REPAIR_LIMIT,
  waitMs = DEFAULT_WAIT_MS,
}: SealedImageRepairOptions = {}) {
  const safeLimit = boundedPositiveInteger(limit, DEFAULT_REPAIR_LIMIT, MAX_REPAIR_LIMIT);
  const safeWaitMs = boundedNonNegativeInteger(waitMs, DEFAULT_WAIT_MS, MAX_WAIT_MS);
  const candidates = await prisma.sealedProduct.findMany({
    orderBy: { updatedAt: "asc" },
    select: {
      id: true,
      imageUrl: true,
      metadata: true,
      providerIds: true,
    },
    take: safeLimit,
    where: {
      OR: [
        { imageUrl: null },
        { imageUrl: "" },
      ],
    },
  });
  const targets = sealedImageRepairTargets(candidates);
  const groupIds = [...new Set(targets.map((target) => target.groupId))];
  const tcgcsvProducts: TcgcsvProductImage[] = [];

  for (const groupId of groupIds) {
    tcgcsvProducts.push(...await fetchTcgcsvProductImages(groupId, fetchImpl));

    if (safeWaitMs > 0) {
      await wait(safeWaitMs);
    }
  }

  const plan = buildSealedImageRepairPlan(candidates, tcgcsvProducts);

  if (!dryRun && plan.length) {
    await prisma.$transaction(
      plan.map((item) =>
        prisma.sealedProduct.update({
          data: { imageUrl: item.imageUrl },
          where: { id: item.id },
        }),
      ),
    );
  }

  return {
    candidatesChecked: candidates.length,
    dryRun,
    groupsFetched: groupIds.length,
    job: "sealed_image_repair",
    limit: safeLimit,
    repairableProducts: plan.length,
    sample: plan.slice(0, 5).map((item) => ({
      groupId: item.groupId,
      id: item.id,
      productId: item.productId,
    })),
    sealedProductsUpdated: dryRun ? 0 : plan.length,
    skippedProducts: candidates.length - plan.length,
    tcgcsvProductsFetched: tcgcsvProducts.length,
    waitMs: safeWaitMs,
  };
}

async function fetchTcgcsvProductImages(groupId: string, fetchImpl: typeof fetch): Promise<TcgcsvProductImage[]> {
  const response = await fetchImpl(
    `https://tcgcsv.com/tcgplayer/${TCGCSV_POKEMON_CATEGORY_ID}/${groupId}/products`,
    {
      headers: {
        accept: "application/json",
        "user-agent": "PokeStopLocalImporter/0.1",
      },
    },
  );
  const body = await response.json().catch(() => ({})) as {
    results?: Array<{ imageUrl?: string | null; productId?: number | string }>;
    success?: boolean;
  };

  if (!response.ok || !body.success) {
    throw new Error(`TCGCSV products request failed for group ${groupId}.`);
  }

  return (body.results ?? [])
    .filter((product): product is { imageUrl?: string | null; productId: number | string } =>
      Boolean(product) && product.productId !== undefined && product.productId !== null,
    )
    .map((product) => ({
      groupId,
      imageUrl: product.imageUrl,
      productId: product.productId,
    }));
}

function boundedPositiveInteger(value: number | undefined, fallback: number, max: number) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.min(max, Math.floor(number));
}

function boundedNonNegativeInteger(value: number | undefined, fallback: number, max: number) {
  const number = Number(value);

  if (!Number.isFinite(number) || number < 0) {
    return fallback;
  }

  return Math.min(max, Math.floor(number));
}

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

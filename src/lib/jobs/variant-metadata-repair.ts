import type { Prisma } from "@prisma/client";
import { prisma } from "../db/prisma";
import {
  buildVariantMetadataRepairPlan,
  pokemonTcgProviderId,
  type PokemonTcgVariantMetadataSource,
  type VariantMetadataRepairCandidate,
} from "../catalogue/variant-metadata-repair";

export type VariantMetadataRepairOptions = {
  dryRun?: boolean;
  fetchTimeoutMs?: number;
  fetchImpl?: typeof fetch;
  limit?: number;
  waitMs?: number;
};

const DEFAULT_REPAIR_LIMIT = 500;
const DEFAULT_FETCH_TIMEOUT_MS = 10000;
const DEFAULT_WAIT_MS = 120;
const MAX_REPAIR_LIMIT = 5000;
const MAX_FETCH_TIMEOUT_MS = 30000;
const MAX_WAIT_MS = 5000;

export async function repairMissingPokemonTcgVariantMetadata({
  dryRun = false,
  fetchTimeoutMs = DEFAULT_FETCH_TIMEOUT_MS,
  fetchImpl = fetch,
  limit = DEFAULT_REPAIR_LIMIT,
  waitMs = DEFAULT_WAIT_MS,
}: VariantMetadataRepairOptions = {}) {
  const safeLimit = boundedPositiveInteger(limit, DEFAULT_REPAIR_LIMIT, MAX_REPAIR_LIMIT);
  const safeFetchTimeoutMs = boundedPositiveInteger(fetchTimeoutMs, DEFAULT_FETCH_TIMEOUT_MS, MAX_FETCH_TIMEOUT_MS);
  const safeWaitMs = boundedNonNegativeInteger(waitMs, DEFAULT_WAIT_MS, MAX_WAIT_MS);
  const candidates = await variantMetadataCandidates(safeLimit);
  const sources: PokemonTcgVariantMetadataSource[] = [];
  const fetchFailures: Array<{ providerId: string; message: string }> = [];

  for (const candidate of candidates) {
    const providerId = pokemonTcgProviderId(candidate.providerIds);

    if (!providerId) {
      continue;
    }

    try {
      sources.push(await fetchPokemonTcgCardVariantMetadata(providerId, fetchImpl, safeFetchTimeoutMs));
    } catch (error) {
      fetchFailures.push({
        providerId,
        message: error instanceof Error ? error.message : "Pokemon TCG API request failed.",
      });
    }

    if (safeWaitMs > 0) {
      await wait(safeWaitMs);
    }
  }

  const plan = buildVariantMetadataRepairPlan(candidates, sources);

  if (!dryRun && plan.length) {
    await prisma.$transaction(
      plan.map((item) =>
        prisma.cardPrinting.update({
          data: { variantMetadata: item.variantMetadata as Prisma.InputJsonObject },
          where: { id: item.id },
        }),
      ),
    );
  }

  return {
    candidatesChecked: candidates.length,
    cardsUpdated: dryRun ? 0 : plan.length,
    dryRun,
    fetchTimeoutMs: safeFetchTimeoutMs,
    job: "variant_metadata_repair",
    limit: safeLimit,
    pokemonTcgCardFetchFailures: fetchFailures.length,
    pokemonTcgCardsFetched: sources.length,
    repairableCards: plan.length,
    sample: plan.slice(0, 5).map((item) => ({
      id: item.id,
      providerId: item.providerId,
      variants: item.variantMetadata.availablePrices,
    })),
    sampleFetchFailures: fetchFailures.slice(0, 5),
    skippedCards: candidates.length - plan.length,
    waitMs: safeWaitMs,
  };
}

async function variantMetadataCandidates(limit: number) {
  return prisma.$queryRaw<VariantMetadataRepairCandidate[]>`
    SELECT
      id,
      provider_ids AS "providerIds",
      variant_metadata AS "variantMetadata"
    FROM card_printings
    WHERE provider_ids ? 'pokemon_tcg_api'
      AND (
        jsonb_typeof(variant_metadata->'availablePrices') IS DISTINCT FROM 'array'
        OR jsonb_array_length(
          CASE
            WHEN jsonb_typeof(variant_metadata->'availablePrices') = 'array'
              THEN variant_metadata->'availablePrices'
            ELSE '[]'::jsonb
          END
        ) = 0
      )
    ORDER BY updated_at ASC
    LIMIT ${limit}
  `;
}

async function fetchPokemonTcgCardVariantMetadata(
  providerId: string,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<PokemonTcgVariantMetadataSource> {
  const response = await fetchImpl(`https://api.pokemontcg.io/v2/cards/${encodeURIComponent(providerId)}`, {
    headers: {
      accept: "application/json",
      ...(process.env.POKEMON_TCG_API_KEY ? { "x-api-key": process.env.POKEMON_TCG_API_KEY } : {}),
    },
    signal: AbortSignal.timeout(timeoutMs),
  });
  const body = await response.json().catch(() => ({})) as {
    data?: PokemonTcgVariantMetadataSource;
    error?: { message?: string };
  };

  if (!response.ok || !body.data) {
    throw new Error(body.error?.message ?? `Pokemon TCG API request failed for ${providerId}.`);
  }

  return body.data;
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

export type PokemonTcgPagingInput = {
  maxPages?: unknown;
  page?: unknown;
  pageSize?: unknown;
};

export type PokemonTcgPageResult = {
  cardsFetched: number;
  cardsUpserted: number;
  page: number;
  pricingSnapshotsCreated: number;
  provider?: string;
  setIds: string[];
  setsUpserted: number;
  totalCount: number;
};

export const pokemonTcgCardsOrderBy = "-set.releaseDate,number,id";

export function normalizePokemonTcgPaging({
  maxPages = 1,
  page = 1,
  pageSize = 50,
}: PokemonTcgPagingInput = {}) {
  return {
    maxPages: clampPositiveInteger(maxPages, 1, 20),
    page: clampPositiveInteger(page, 1),
    pageSize: clampPositiveInteger(pageSize, 50, 250),
  };
}

export function summarizePokemonTcgPageResults({
  maxPages,
  page,
  pages,
  pageSize,
  query,
}: {
  maxPages: number;
  page: number;
  pages: PokemonTcgPageResult[];
  pageSize: number;
  query: string;
}) {
  const setIds = new Set<string>();
  const totalCount = pages.at(-1)?.totalCount ?? 0;
  const lastPage = pages.at(-1)?.page ?? page;
  const recordsSeen = lastPage * pageSize;
  const complete = totalCount > 0 ? recordsSeen >= totalCount : totalFetched(pages) === 0;

  for (const result of pages) {
    for (const setId of result.setIds) {
      setIds.add(setId);
    }
  }

  return {
    cardsFetched: totalFetched(pages),
    cardsUpserted: totalUpserted(pages),
    complete,
    maxPages,
    nextPage: complete ? null : lastPage + 1,
    page,
    pageSize,
    pages: pages.map((result) => ({
      cardsFetched: result.cardsFetched,
      cardsUpserted: result.cardsUpserted,
      page: result.page,
      pricingSnapshotsCreated: result.pricingSnapshotsCreated,
      setsUpserted: result.setsUpserted,
    })),
    pagesProcessed: pages.length,
    pricingSnapshotsCreated: totalPriceSnapshots(pages),
    provider: "pokemon-tcg-api",
    query,
    setsUpserted: setIds.size,
    totalCount,
  };
}

export function shouldContinuePokemonTcgPaging({
  page,
  pageSize,
  result,
}: {
  page: number;
  pageSize: number;
  result: Pick<PokemonTcgPageResult, "cardsFetched" | "totalCount">;
}) {
  return result.cardsFetched > 0 && page * pageSize < result.totalCount;
}

function clampPositiveInteger(value: unknown, fallback: number, max = Number.POSITIVE_INFINITY) {
  const normalized = typeof value === "string" && value.trim() === "" ? NaN : Number(value);

  if (!Number.isFinite(normalized) || normalized <= 0) {
    return fallback;
  }

  return Math.min(max, Math.max(1, Math.floor(normalized)));
}

function totalFetched(pages: PokemonTcgPageResult[]) {
  return pages.reduce((total, result) => total + result.cardsFetched, 0);
}

function totalUpserted(pages: PokemonTcgPageResult[]) {
  return pages.reduce((total, result) => total + result.cardsUpserted, 0);
}

function totalPriceSnapshots(pages: PokemonTcgPageResult[]) {
  return pages.reduce((total, result) => total + result.pricingSnapshotsCreated, 0);
}

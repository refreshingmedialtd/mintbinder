export function positiveInteger(value, fallback) {
  const number = Number(value);

  if (!Number.isFinite(number) || number <= 0) {
    return fallback;
  }

  return Math.floor(number);
}

export function pageSetting(value, fallback = 1) {
  if (typeof value === "string" && value.trim().toLowerCase() === "auto") {
    return "auto";
  }

  return positiveInteger(value, fallback);
}

export function pageFromStatus(statusResponse, query = "") {
  const status = statusResponse?.status;
  const latestQuery = status?.latestCatalogueResult?.query ?? "";
  const nextPage = status?.nextCataloguePage;

  if (latestQuery !== query) {
    throw new Error(`Auto page resume expected query "${query}" but latest catalogue job used "${latestQuery}".`);
  }

  if (!nextPage) {
    throw new Error("Auto page resume could not find a next catalogue page.");
  }

  return nextPage;
}

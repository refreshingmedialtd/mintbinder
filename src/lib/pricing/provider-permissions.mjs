const priceChartingSources = new Set([
  "pricecharting-graded-card",
  "pricecharting-sealed",
]);

export function priceChartingLicenceConfirmed(env = process.env) {
  return String(env.PRICECHARTING_LICENCE_CONFIRMED ?? "").trim().toLowerCase() === "true";
}

export function customerVisiblePriceSource(source, env = process.env) {
  const normalized = String(source ?? "").trim().toLowerCase();

  return !priceChartingSources.has(normalized) || priceChartingLicenceConfirmed(env);
}

export function assertPriceChartingWriteAllowed({ licenceConfirmed, writePrices }) {
  if (writePrices && licenceConfirmed !== true) {
    throw new Error(
      "PRICECHARTING_LICENCE_CONFIRMED=true is required before PriceCharting-derived prices can be persisted or displayed.",
    );
  }
}

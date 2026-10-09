const priceChartingSources = new Set([
  "pricecharting-graded-card",
  "pricecharting-sealed",
]);
const quarantinedPriceSources = new Set([
  "cardtrader-sealed-quarantined",
]);
const ebayUkSoldSources = new Set([
  "ebay-uk-sold",
]);

export function priceChartingLicenceConfirmed(env = process.env) {
  return String(env.PRICECHARTING_LICENCE_CONFIRMED ?? "").trim().toLowerCase() === "true";
}

export function ebayUkSoldCustomerVisible(env = process.env) {
  return String(env.EBAY_UK_SOLD_CUSTOMER_VISIBLE ?? "").trim().toLowerCase() === "true";
}

export function customerVisiblePriceSource(source, env = process.env) {
  const normalized = String(source ?? "").trim().toLowerCase();

  if (quarantinedPriceSources.has(normalized)) {
    return false;
  }

  if (ebayUkSoldSources.has(normalized) && !ebayUkSoldCustomerVisible(env)) {
    return false;
  }

  return !priceChartingSources.has(normalized) || priceChartingLicenceConfirmed(env);
}

export function restrictedCustomerPriceSources(env = process.env) {
  return [
    ...(!priceChartingLicenceConfirmed(env) ? priceChartingSources : []),
    ...(!ebayUkSoldCustomerVisible(env) ? ebayUkSoldSources : []),
    ...quarantinedPriceSources,
  ];
}

export function assertPriceChartingWriteAllowed({ licenceConfirmed, writePrices }) {
  if (writePrices && licenceConfirmed !== true) {
    throw new Error(
      "PRICECHARTING_LICENCE_CONFIRMED=true is required before PriceCharting-derived prices can be persisted or displayed.",
    );
  }
}

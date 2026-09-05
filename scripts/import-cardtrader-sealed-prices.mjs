import "dotenv/config";
import { pathToFileURL } from "node:url";
import {
  cardTraderSealedOptionsFromEnv,
  normalizeCardTraderProductIds,
  syncCardTraderSealedPrices,
} from "./cardtrader-sealed-pricing.mjs";

export async function runCardTraderSealedImport(env = process.env) {
  const options = cardTraderSealedImportOptionsFromEnv(env);

  if (!options.enabled) {
    throw new Error("CardTrader sealed pricing is disabled or CARDTRADER_API_TOKEN is not configured.");
  }

  return syncCardTraderSealedPrices(options);
}

export function cardTraderSealedImportOptionsFromEnv(env = process.env) {
  const options = cardTraderSealedOptionsFromEnv(env);
  const productIds = normalizeCardTraderProductIds(env.CARDTRADER_SEALED_PRODUCT_IDS);

  if (!productIds.length) {
    return options;
  }

  return {
    ...options,
    limit: productIds.length,
    productIds,
    setLimit: productIds.length,
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const summary = await runCardTraderSealedImport();

  console.log(JSON.stringify(summary, null, 2));
}

import "dotenv/config";
import { pathToFileURL } from "node:url";
import {
  cardTraderSealedOptionsFromEnv,
  syncCardTraderSealedPrices,
} from "./cardtrader-sealed-pricing.mjs";

export async function runCardTraderSealedImport(env = process.env) {
  const options = cardTraderSealedOptionsFromEnv(env);

  if (!options.enabled) {
    throw new Error("CardTrader sealed pricing is disabled or CARDTRADER_API_TOKEN is not configured.");
  }

  return syncCardTraderSealedPrices(options);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const summary = await runCardTraderSealedImport();

  console.log(JSON.stringify(summary, null, 2));
}

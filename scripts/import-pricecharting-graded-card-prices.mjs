import "dotenv/config";
import { pathToFileURL } from "node:url";
import {
  priceChartingGradedOptionsFromEnv,
  syncPriceChartingGradedCardPrices,
} from "./pricecharting-graded-card-pricing.mjs";

export async function main() {
  const summary = await syncPriceChartingGradedCardPrices(
    priceChartingGradedOptionsFromEnv(process.env),
  );

  console.log(JSON.stringify(summary, null, 2));
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}

import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  priceChartingSealedOptionsFromEnv,
  syncPriceChartingSealedPrices,
} from "./pricecharting-sealed-pricing.mjs";

const prisma = new PrismaClient();

try {
  const summary = await syncPriceChartingSealedPrices({
    ...priceChartingSealedOptionsFromEnv(process.env),
    prisma,
  });

  console.log(JSON.stringify(summary, null, 2));
} finally {
  await prisma.$disconnect();
}

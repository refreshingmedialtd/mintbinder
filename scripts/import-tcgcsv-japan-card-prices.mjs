import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  japanCardPricingOptionsFromEnv,
  syncTcgcsvCardPrices,
} from "./tcgcsv-card-pricing.mjs";

const prisma = new PrismaClient();

try {
  const summary = await syncTcgcsvCardPrices({
    ...japanCardPricingOptionsFromEnv(process.env),
    prisma,
  });

  console.log(JSON.stringify(summary, null, 2));
} finally {
  await prisma.$disconnect();
}

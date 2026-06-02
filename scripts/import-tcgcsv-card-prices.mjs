import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  cardPricingOptionsFromEnv,
  syncTcgcsvCardPrices,
} from "./tcgcsv-card-pricing.mjs";

const prisma = new PrismaClient();

try {
  const summary = await syncTcgcsvCardPrices({
    ...cardPricingOptionsFromEnv(process.env),
    prisma,
  });

  console.log(JSON.stringify(summary, null, 2));
} finally {
  await prisma.$disconnect();
}

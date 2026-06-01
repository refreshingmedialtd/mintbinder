import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import {
  sealedImportOptionsFromEnv,
  syncTcgcsvSealedProducts,
} from "./tcgcsv-sealed-importer.mjs";

const prisma = new PrismaClient();

try {
  const summary = await syncTcgcsvSealedProducts({
    ...sealedImportOptionsFromEnv(process.env),
    prisma,
  });

  console.log(JSON.stringify(summary, null, 2));
} finally {
  await prisma.$disconnect();
}

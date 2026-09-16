import "dotenv/config";
import { defineConfig } from "prisma/config";
import { prismaCliDatabaseUrl } from "./scripts/prisma-cli-database-url.mjs";

const cliDatabaseUrl = prismaCliDatabaseUrl(process.env);

const commonConfig = {
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "node prisma/seed.mjs",
  },
};

export default defineConfig(cliDatabaseUrl
  ? { ...commonConfig, engine: "classic", datasource: { url: cliDatabaseUrl } }
  : commonConfig);

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("sealed provider jobs never select tenant-private catalogue rows", async () => {
  const files = await Promise.all([
    "../scripts/cardtrader-sealed-pricing.mjs",
    "../scripts/pricecharting-sealed-pricing.mjs",
    "../src/lib/jobs/sealed-image-repair.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

  for (const source of files) {
    assert.match(source, /createdByUserId:\s*null/);
    assert.match(source, /visibility:\s*"GLOBAL"/);
  }
});

test("TCGCSV name fallback and writes are constrained to reviewed global rows", async () => {
  const source = await readFile(
    new URL("../scripts/tcgcsv-sealed-importer.mjs", import.meta.url),
    "utf8",
  );

  assert.match(
    source,
    /findFirst\([\s\S]*?createdByUserId:\s*null,[\s\S]*?visibility:\s*"GLOBAL"[\s\S]*?name:\s*product\.name/,
  );
  assert.match(source, /const data = \{[\s\S]*?createdByUserId:\s*null[\s\S]*?visibility:\s*"GLOBAL"/);
});

test("catalogue health SQL scopes sealed coverage and gaps to global visibility", async () => {
  const sources = await Promise.all([
    "../src/lib/jobs/catalogue-status.ts",
    "../scripts/report-pricing-health.mjs",
    "../scripts/report-catalogue-gaps.mjs",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

  assert.equal(sources.every((source) => source.includes("'global'::catalogue_visibility") || /visibility:\s*"GLOBAL"/.test(source)), true);
  assert.equal(sources.join("\n").includes("prisma.sealedProduct.count()"), false);
});

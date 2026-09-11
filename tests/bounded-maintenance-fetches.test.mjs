import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { catalogueCollectorNumberSearchTerms } from "../src/lib/catalogue/collector-number-search.ts";

test("maintenance provider reads use the bounded header-and-body policy", async () => {
  const files = await Promise.all([
    "../src/lib/pricing/tcgdex.ts",
    "../src/lib/jobs/card-image-repair.ts",
    "../src/lib/jobs/sealed-image-repair.ts",
  ].map((path) => readFile(new URL(path, import.meta.url), "utf8")));

  for (const source of files) {
    assert.match(source, /fetchWithPolicy\(/);
    assert.match(source, /timeoutMs:\s*12_000/);
    assert.match(source, /maxResponseBytes:\s*16 \* 1024 \* 1024/);
  }
});

test("Pokemon TCG catalogue and variant metadata reads have explicit byte caps", async () => {
  const [catalogue, variants] = await Promise.all([
    readFile(new URL("../src/lib/pricing/pokemon-tcg-api.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/lib/jobs/variant-metadata-repair.ts", import.meta.url), "utf8"),
  ]);

  assert.equal((catalogue.match(/fetchWithPolicy\(/g) ?? []).length, 2);
  assert.match(catalogue, /maxResponseBytes:\s*16 \* 1024 \* 1024/);
  assert.match(catalogue, /maxResponseBytes:\s*32 \* 1024 \* 1024/);
  assert.match(variants, /fetchWithPolicy\(/);
  assert.match(variants, /maxResponseBytes:\s*2 \* 1024 \* 1024/);
});

test("TCGdex catalogue ingestion indexes full collector numbers and explicit variant qualifiers", async () => {
  const source = await readFile(
    new URL("../src/lib/pricing/tcgdex.ts", import.meta.url),
    "utf8",
  );

  assert.match(source, /\.\.\.tcgdexCollectorNumberSearchTerms\(card\)/);
  assert.match(source, /catalogueCollectorNumberSearchTerms\(/);
  assert.match(source, /card\.set\?\.cardCount\?\.official/);
  assert.match(source, /card\.set\?\.cardCount\?\.total/);
  assert.match(source, /variant\.foil/);
  assert.match(source, /variant\.stamp/);
  assert.match(source, /"Pokémon Center Stamp"/);
  assert.match(source, /"Set Logo Stamp"/);
  assert.match(source, /"Poke Ball Reverse Holofoil"/);
  assert.match(source, /"Master Ball Reverse Holofoil"/);
});

test("catalogue collector references index both common zero-padding conventions", () => {
  assert.deepEqual(
    catalogueCollectorNumberSearchTerms("1", 142, 175),
    ["1", "142", "001", "1/142", "001/142", "175", "1/175", "001/175"],
  );
  assert.ok(catalogueCollectorNumberSearchTerms("061", 78, 91).includes("061/078"));
});

test("reviewed TCGCSV catalogue fetches use the accepted importer identity and bounded retries", async () => {
  const source = await readFile(
    new URL("../scripts/reviewed-tcgcsv-card-catalogue.mjs", import.meta.url),
    "utf8",
  );

  assert.match(source, /accept:\s*"application\/json"/);
  assert.match(source, /"user-agent":\s*"MintBinderLocalImporter\/0\.1"/);
  assert.match(source, /maxResponseBytes:\s*32 \* 1024 \* 1024/);
  assert.match(source, /retryInvalidResponse:\s*true/);
});

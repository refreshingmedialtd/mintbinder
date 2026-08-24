import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

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

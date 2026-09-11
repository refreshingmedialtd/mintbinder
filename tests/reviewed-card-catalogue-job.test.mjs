import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("reviewed catalogue route is protected, tracked, and forwards a bounded group request", async () => {
  const route = await readFile(
    new URL("../src/app/api/jobs/reviewed-card-catalogue-refresh/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /await requireJobAccess\(request\)/);
  assert.match(route, /const categoryId = positiveInteger\(body\.categoryId\)/);
  assert.match(route, /const groupId = String\(body\.groupId \?\? ""\)\.trim\(\)/);
  assert.match(route, /const writePrices = body\.writePrices !== false/);
  assert.match(route, /const input = \{[\s\S]*categoryId,[\s\S]*groupId,[\s\S]*scheduled: body\.scheduled === true,[\s\S]*usdToGbpRate,[\s\S]*writePrices,[\s\S]*\}/);
  assert.match(route, /runTrackedJob\(\{[\s\S]*input,[\s\S]*type: "catalogue_refresh"/);
  assert.match(
    route,
    /syncReviewedTcgcsvCardCatalogue\(\{[\s\S]*categoryId,[\s\S]*groupId,[\s\S]*prisma,[\s\S]*usdToGbpRate,[\s\S]*writePrices,[\s\S]*\}\)/,
  );
});

test("reviewed catalogue route resolves the required USD-to-GBP rate when prices are written", async () => {
  const route = await readFile(
    new URL("../src/app/api/jobs/reviewed-card-catalogue-refresh/route.ts", import.meta.url),
    "utf8",
  );

  assert.match(route, /if \(writePrices && !usdToGbpRate\) \{/);
  assert.match(route, /await resolveGbpRates\(\{/);
  assert.match(route, /requiredCurrencies: \["USD"\]/);
  assert.match(route, /TCGCSV_JAPAN_USD_TO_GBP_RATE[\s\S]*TCGCSV_USD_TO_GBP_RATE[\s\S]*POKEMON_TCG_USD_TO_GBP_RATE/);
  assert.match(route, /usdToGbpRate = rates\.USD\?\.rate/);
});

test("daily cron runs reviewed catalogue recovery before discovery and retains failures", async () => {
  const cron = await readFile(
    new URL("../scripts/cron-live-daily.sh", import.meta.url),
    "utf8",
  );
  const reviewedCommand = "npm run job:live-reviewed-card-catalogue || status=$?";
  const discoveryCommand = "npm run job:live-catalogue-discovery || status=$?";

  assert.match(cron, /^status=0$/m);
  assert.ok(cron.includes(reviewedCommand));
  assert.ok(cron.includes(discoveryCommand));
  assert.ok(
    cron.indexOf(reviewedCommand) < cron.indexOf(discoveryCommand),
    "reviewed catalogue recovery must complete before broad catalogue discovery",
  );
  assert.match(cron, /^exit "\$status"$/m);
});

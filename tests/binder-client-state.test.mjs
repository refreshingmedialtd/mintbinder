import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BINDER_SYNC_TIMEOUT_MS,
  shouldShowCollectionBinderFallback,
} from "../src/lib/binders/client-state.ts";

test("collection binder stays browsable while the server binder list is empty", () => {
  assert.equal(shouldShowCollectionBinderFallback(0, 11), true);
  assert.equal(shouldShowCollectionBinderFallback(1, 11), false);
  assert.equal(shouldShowCollectionBinderFallback(0, 0), false);
});

test("binder reads have a bounded loading state and render the local collection fallback", async () => {
  const source = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");

  assert.equal(BINDER_SYNC_TIMEOUT_MS, 30_000);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /signal:\s*controller\.signal/);
  assert.match(source, /\[defaultBinderSummary\(availableItems\)\]/);
  assert.match(source, /Your collection binder is still available/);
  assert.match(
    source,
    /return \(\) => \{\s*cancelled = true;\s*if \(binderLoadKeyRef\.current === loadKey\) \{\s*binderLoadKeyRef\.current = "";/,
  );
});

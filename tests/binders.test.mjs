import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import { BinderInputError, normalizeBinderLayout } from "../src/lib/binders/layout.ts";

function blankPage(position = 0) {
  return {
    position,
    slots: Array.from({ length: 9 }, (_entry, slotPosition) => ({ position: slotPosition })),
  };
}

test("normalizes a binder page while preserving intentional blank pockets", () => {
  const pages = normalizeBinderLayout({ pages: [blankPage()] });

  assert.equal(pages.length, 1);
  assert.equal(pages[0].slots.length, 9);
  assert.deepEqual(pages[0].slots[0], {
    position: 0,
    collectionItemId: null,
    copyIndex: null,
    note: null,
  });
});

test("accepts a concrete owned-copy allocation", () => {
  const page = blankPage();
  page.slots[3] = {
    position: 3,
    collectionItemId: "11111111-1111-4111-8111-111111111111",
    copyIndex: 2,
    note: "  centre pocket  ",
  };

  const pages = normalizeBinderLayout({ pages: [page] });

  assert.equal(pages[0].slots[3].copyIndex, 2);
  assert.equal(pages[0].slots[3].note, "centre pocket");
});

test("rejects layouts without exactly nine pockets per page", () => {
  assert.throws(
    () => normalizeBinderLayout({ pages: [{ position: 0, slots: [] }] }),
    BinderInputError,
  );
});

test("rejects non-contiguous pages and pocket positions", () => {
  assert.throws(
    () => normalizeBinderLayout({ pages: [blankPage(1)] }),
    /page positions must be contiguous/i,
  );

  const page = blankPage();
  page.slots[2].position = 4;
  assert.throws(
    () => normalizeBinderLayout({ pages: [page] }),
    /pocket positions must be contiguous/i,
  );
});

test("rejects malformed collection item identifiers", () => {
  const page = blankPage();
  page.slots[0] = { position: 0, collectionItemId: "not-a-uuid", copyIndex: 1 };

  assert.throws(() => normalizeBinderLayout({ pages: [page] }), /item ID is invalid/i);
});

test("public binder surfaces do not disclose quantity through copy indexes", async () => {
  const [route, page] = await Promise.all([
    readFile(new URL("../src/app/api/binders/shared/[slug]/route.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/shared/binders/[slug]/page.tsx", import.meta.url), "utf8"),
  ]);

  assert.doesNotMatch(route, /copyIndex:\s*slot\.copyIndex/);
  assert.doesNotMatch(page, /Copy \{slot\.copyIndex\}/);
  assert.doesNotMatch(page, /key=\{(?:page|slot)\.id\}/);
});

test("binder create, update, and delete share one per-user invariant lock", async () => {
  const source = await readFile(new URL("../src/lib/db/binders.ts", import.meta.url), "utf8");
  assert.equal(
    (source.match(/lockUserResourceQuota\(transaction, userId, "binders"\)/g) ?? []).length,
    3,
  );
  assert.match(source, /updateBinder[\s\S]*?lockUserResourceQuota[\s\S]*?transaction\.binder\.findFirst/);
  assert.match(source, /deleteBinder[\s\S]*?lockUserResourceQuota[\s\S]*?transaction\.binder\.findFirst/);
});

test("cross-binder owned-copy conflicts map to a deterministic 409", async () => {
  const route = await readFile(
    new URL("../src/app/api/binders/[id]/layout/route.ts", import.meta.url),
    "utf8",
  );
  assert.match(route, /PrismaClientKnownRequestError/);
  assert.match(route, /error\.code === "P2002"/);
  assert.match(route, /status: 409/);
  assert.match(route, /already assigned to another binder/);
});

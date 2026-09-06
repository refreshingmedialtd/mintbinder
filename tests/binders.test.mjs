import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  BinderInputError,
  MAX_MANAGED_BINDER_PAGES,
  MAX_STANDARD_BINDER_PAGES,
  normalizeBinderLayout,
} from "../src/lib/binders/layout.ts";
import { withLegacyDefaultBinderMarker } from "../src/lib/binders/migration-state.ts";
import { createBinder } from "../src/lib/db/binders.ts";

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

test("normalizer supports managed full-collection capacity but rejects larger payloads", () => {
  const maximum = Array.from(
    { length: MAX_MANAGED_BINDER_PAGES },
    (_entry, position) => blankPage(position),
  );

  assert.equal(normalizeBinderLayout({ pages: maximum }).length, MAX_MANAGED_BINDER_PAGES);
  assert.throws(
    () => normalizeBinderLayout({ pages: [...maximum, blankPage(MAX_MANAGED_BINDER_PAGES)] }),
    new RegExp(`between 1 and ${MAX_MANAGED_BINDER_PAGES}`, "i"),
  );
  assert.equal(MAX_STANDARD_BINDER_PAGES, 100);
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

test("every binder mutation shares one per-user invariant lock", async () => {
  const source = await readFile(new URL("../src/lib/db/binders.ts", import.meta.url), "utf8");
  assert.equal(
    (source.match(/lockUserResourceQuota\(transaction, userId, "binders"\)/g) ?? []).length,
    4,
  );
  assert.match(source, /updateBinder[\s\S]*?lockUserResourceQuota[\s\S]*?transaction\.binder\.findFirst/);
  assert.match(source, /replaceBinderLayout[\s\S]*?lockUserResourceQuota[\s\S]*?transaction\.binder\.findFirst/);
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

test("default binder bootstrap consumes its retry marker atomically with layout persistence", async () => {
  const [database, route] = await Promise.all([
    readFile(new URL("../src/lib/db/binders.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/binders/[id]/layout/route.ts", import.meta.url), "utf8"),
  ]);

  assert.match(route, /completeLegacyDefaultMigration: body\?\.completeLegacyDefaultMigration === true/);
  assert.match(route, /expectedUpdatedAt: body\?\.expectedUpdatedAt/);
  assert.match(database, /binder\.isDefault && options\.completeLegacyDefaultMigration/);
  assert.match(database, /consumeLegacyDefaultBinderMarker\(binder\.description\)/);
  assert.match(database, /binderUpdate\.description = migrationCompletion\.description/);
  assert.match(database, /preserveBinderDescriptionMarker\(existing\.description, description\)/);
  assert.match(database, /visibleBinderDescription\(binder\.description\)/);
});

test("stale whole-layout saves are rejected before deleting any pages", async () => {
  const [database, route] = await Promise.all([
    readFile(new URL("../src/lib/db/binders.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/binders/[id]/layout/route.ts", import.meta.url), "utf8"),
  ]);
  const replaceSource = database.slice(
    database.indexOf("export async function replaceBinderLayout"),
    database.indexOf("function validateAssignedCopies"),
  );

  assert.ok(replaceSource.indexOf("lockUserResourceQuota") < replaceSource.indexOf("binder.updatedAt.getTime()"));
  assert.ok(replaceSource.indexOf("binder.updatedAt.getTime()") < replaceSource.indexOf("binderPage.deleteMany"));
  assert.match(replaceSource, /throw new BinderVersionConflictError\(\)/);
  assert.match(replaceSource, /updatedAt: nextBinderVersion\(binder\.updatedAt\)/);
  assert.match(route, /error instanceof BinderVersionConflictError/);
  assert.match(route, /code: "BINDER_LAYOUT_STALE"/);
  assert.match(route, /status: 409/);
});

test("stale metadata and artwork patches cannot refresh an obsolete layout version", async () => {
  const [database, route] = await Promise.all([
    readFile(new URL("../src/lib/db/binders.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/binders/[id]/route.ts", import.meta.url), "utf8"),
  ]);
  const updateSource = database.slice(
    database.indexOf("export async function updateBinder"),
    database.indexOf("export async function replaceBinderLayout"),
  );

  assert.ok(updateSource.indexOf("lockUserResourceQuota") < updateSource.indexOf("existing.updatedAt.getTime()"));
  assert.ok(updateSource.indexOf("existing.updatedAt.getTime()") < updateSource.indexOf("transaction.binder.update"));
  assert.match(updateSource, /requiredBinderTimestamp\(input\.expectedUpdatedAt/);
  assert.match(updateSource, /throw new BinderVersionConflictError\(\)/);
  assert.match(updateSource, /updatedAt: nextBinderVersion\(existing\.updatedAt\)/);
  assert.match(updateSource, /previousDefaults[\s\S]*?updatedAt: nextBinderVersion\(previousDefault\.updatedAt\)/);
  assert.match(route, /error instanceof BinderVersionConflictError/);
  assert.match(route, /code: "BINDER_STALE"/);
  assert.match(route, /status: 409/);
});

test("stale binder deletes are rejected before removal", async () => {
  const [database, route] = await Promise.all([
    readFile(new URL("../src/lib/db/binders.ts", import.meta.url), "utf8"),
    readFile(new URL("../src/app/api/binders/[id]/route.ts", import.meta.url), "utf8"),
  ]);
  const deleteSource = database.slice(
    database.indexOf("export async function deleteBinder"),
    database.indexOf("function requiredText"),
  );

  assert.match(deleteSource, /requiredBinderTimestamp\(expectedVersion/);
  assert.ok(deleteSource.indexOf("lockUserResourceQuota") < deleteSource.indexOf("binder.updatedAt.getTime()"));
  assert.ok(deleteSource.indexOf("binder.updatedAt.getTime()") < deleteSource.indexOf("transaction.binder.delete"));
  assert.match(deleteSource, /throw new BinderVersionConflictError\(\)/);
  assert.match(route, /body\?\.expectedUpdatedAt/);
  assert.match(route, /error instanceof BinderVersionConflictError/);
});

test("reserved migration markers can only be created by the bounded bootstrap path", async () => {
  const database = await readFile(new URL("../src/lib/db/binders.ts", import.meta.url), "utf8");
  const createSource = database.slice(
    database.indexOf("export async function createBinder"),
    database.indexOf("export async function updateBinder"),
  );

  assert.match(createSource, /visibleBinderDescription\(optionalText\(input\.description/);
  assert.match(createSource, /managedDefaultBootstrap = input\.managedDefaultBootstrap === true/);
  assert.match(createSource, /managedDefaultBootstrap && currentDefaults\.length/);
  assert.match(createSource, /hasLegacyDefaultBinderMarker\(binder\.description\) \|\| hasManagedDefaultBinderMarker\(binder\.description\)/);
  assert.match(createSource, /existingManagedDefault[\s\S]*?transaction\.binder\.findUniqueOrThrow/);
  assert.match(createSource, /!managedDefaultBootstrap && !currentDefaults\.length/);
  assert.match(createSource, /withLegacyDefaultBinderMarker\(visibleDescription\)/);
  assert.match(createSource, /withLegacyCustomBinderMarker\(visibleDescription, legacySource\)/);
  assert.match(database, /preserveBinderDescriptionMarker\(existing\.description, description\)/);
});

test("managed default bootstrap is transactionally idempotent but rejects an unrelated default", async () => {
  const existing = {
    description: withLegacyDefaultBinderMarker("Every active card lot."),
    id: "11111111-1111-4111-8111-111111111111",
    isDefault: true,
    pages: [],
    updatedAt: new Date("2026-09-06T12:00:00.000Z"),
  };
  let createCalls = 0;

  function databaseWithDefaults(defaults) {
    const transaction = {
      async $executeRaw() {
        return 1;
      },
      binder: {
        async count() {
          return defaults.length;
        },
        async create() {
          createCalls += 1;
          throw new Error("A duplicate default binder must not be created.");
        },
        async findMany() {
          return defaults;
        },
        async findUniqueOrThrow({ where }) {
          assert.equal(where.id, existing.id);
          return existing;
        },
      },
    };
    return {
      async $transaction(callback) {
        return callback(transaction);
      },
    };
  }

  const database = databaseWithDefaults([existing]);
  const input = { managedDefaultBootstrap: true, name: "Full Card Collection" };
  assert.equal((await createBinder("user-1", input, database)).id, existing.id);
  assert.equal((await createBinder("user-1", input, database)).id, existing.id);
  assert.equal(createCalls, 0);

  await assert.rejects(
    createBinder(
      "user-1",
      input,
      databaseWithDefaults([{ ...existing, description: "An ordinary default binder." }]),
    ),
    /already been initialized/,
  );
  assert.equal(createCalls, 0);
});

test("every implicit default transition advances the affected binder version", async () => {
  const database = await readFile(new URL("../src/lib/db/binders.ts", import.meta.url), "utf8");
  const createSource = database.slice(
    database.indexOf("export async function createBinder"),
    database.indexOf("export async function updateBinder"),
  );
  const deleteSource = database.slice(
    database.indexOf("export async function deleteBinder"),
    database.indexOf("function requiredText"),
  );

  assert.match(createSource, /currentDefaults[\s\S]*?updatedAt: nextBinderVersion\(currentDefault\.updatedAt\)/);
  assert.match(deleteSource, /isDefault: true,[\s\S]*?updatedAt: nextBinderVersion\(replacement\.updatedAt\)/);
});

test("custom migration releases only exact pending-default conflicts and carries their notes", async () => {
  const database = await readFile(new URL("../src/lib/db/binders.ts", import.meta.url), "utf8");
  const replaceSource = database.slice(
    database.indexOf("export async function replaceBinderLayout"),
    database.indexOf("function validateAssignedCopies"),
  );

  assert.match(replaceSource, /hasLegacyDefaultBinderMarker\(releaseBinder\.description\)/);
  assert.match(replaceSource, /hasManagedDefaultBinderMarker\(releaseBinder\.description\)/);
  assert.match(replaceSource, /collectionItemId: slot\.collectionItemId,\s*copyIndex: slot\.copyIndex/);
  assert.match(replaceSource, /releasedNotes\.get\(`\$\{slot\.collectionItemId}:\$\{slot\.copyIndex}`\)/);
  assert.match(replaceSource, /data: \{ collectionItemId: null, copyIndex: null, note: null \}/);
  assert.ok(
    replaceSource.indexOf("if (conflictingSlots.length)") <
      replaceSource.indexOf("releaseBinder.updatedAt.getTime()"),
    "a reorder with no managed-default conflict must not fail on an unrelated default version",
  );
});

test("only a tagged default binder can persist more than the standard page limit", async () => {
  const database = await readFile(new URL("../src/lib/db/binders.ts", import.meta.url), "utf8");
  const replaceSource = database.slice(
    database.indexOf("export async function replaceBinderLayout"),
    database.indexOf("function validateAssignedCopies"),
  );

  assert.match(replaceSource, /pages\.length > MAX_STANDARD_BINDER_PAGES/);
  assert.match(replaceSource, /binder\.isDefault/);
  assert.match(replaceSource, /hasLegacyDefaultBinderMarker\(binder\.description\)/);
  assert.match(replaceSource, /hasManagedDefaultBinderMarker\(binder\.description\)/);
  assert.match(replaceSource, /Custom binders support at most/);
});

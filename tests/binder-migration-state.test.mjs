import assert from "node:assert/strict";
import test from "node:test";

import {
  consumeLegacyCustomBinderMarker,
  consumeLegacyDefaultBinderMarker,
  hasLegacyDefaultBinderMarker,
  hasManagedDefaultBinderMarker,
  LEGACY_DEFAULT_BINDER_MARKER,
  MANAGED_DEFAULT_BINDER_MARKER,
  preserveBinderDescriptionMarker,
  unassignedBinderCopyIndexes,
  unassignedBinderEntries,
  visibleBinderDescription,
  withLegacyDefaultBinderMarker,
  withManagedDefaultBinderMarker,
} from "../src/lib/binders/migration-state.ts";

test("successful default binder migration consumes its retry marker", () => {
  assert.deepEqual(
    consumeLegacyDefaultBinderMarker(`Every active card lot, migrated from this device. ${LEGACY_DEFAULT_BINDER_MARKER}`),
    {
      consumed: true,
      description: `Every active card lot, migrated from this device. ${MANAGED_DEFAULT_BINDER_MARKER}`,
    },
  );
});

test("the durable managed marker remains hidden and survives visible description edits", () => {
  const stored = withManagedDefaultBinderMarker("Every active card lot appears here automatically.");

  assert.equal(hasManagedDefaultBinderMarker(stored), true);
  assert.equal(visibleBinderDescription(stored), "Every active card lot appears here automatically.");
  assert.equal(
    withManagedDefaultBinderMarker("My full collection"),
    `My full collection ${MANAGED_DEFAULT_BINDER_MARKER}`,
  );
});

test("the pending default retry marker remains hidden and survives metadata edits", () => {
  const stored = withLegacyDefaultBinderMarker("Still recovering this binder.");

  assert.equal(hasLegacyDefaultBinderMarker(stored), true);
  assert.equal(visibleBinderDescription(stored), "Still recovering this binder.");
  assert.equal(
    withLegacyDefaultBinderMarker("Updated description"),
    `Updated description ${LEGACY_DEFAULT_BINDER_MARKER}`,
  );
});

test("a completed custom migration gets a durable idempotence marker", () => {
  const completed = consumeLegacyCustomBinderMarker(
    "Migrated from this device. [Legacy source: local-binder-1]",
  );

  assert.deepEqual(completed, {
    consumed: true,
    description: "Migrated from this device. [Legacy migrated: local-binder-1]",
  });
  assert.equal(visibleBinderDescription(completed.description), "Migrated from this device.");
  assert.equal(
    preserveBinderDescriptionMarker(completed.description, "Hand curated"),
    "Hand curated [Legacy migrated: local-binder-1]",
  );
});

test("custom migration completion never consumes the pending default marker", () => {
  assert.deepEqual(
    consumeLegacyCustomBinderMarker(`Full collection ${LEGACY_DEFAULT_BINDER_MARKER}`),
    {
      consumed: false,
      description: `Full collection ${LEGACY_DEFAULT_BINDER_MARKER}`,
    },
  );
});

test("unrelated descriptions are preserved", () => {
  assert.deepEqual(consumeLegacyDefaultBinderMarker("An intentionally empty binder."), {
    consumed: false,
    description: "An intentionally empty binder.",
  });
  assert.deepEqual(consumeLegacyDefaultBinderMarker(null), {
    consumed: false,
    description: null,
  });
});

test("ordinary metadata edits cannot introduce reserved binder markers", () => {
  assert.equal(
    preserveBinderDescriptionMarker(
      "A normal custom binder.",
      `Spoofed capacity ${MANAGED_DEFAULT_BINDER_MARKER}`,
    ),
    "Spoofed capacity",
  );
  assert.equal(
    preserveBinderDescriptionMarker(
      null,
      `Spoofed retry ${LEGACY_DEFAULT_BINDER_MARKER} ${MANAGED_DEFAULT_BINDER_MARKER}`,
    ),
    "Spoofed retry",
  );
});

test("default binder bootstrap skips copies already assigned to another binder", () => {
  const collection = [
    { id: "lot-a", quantity: 2 },
    { id: "lot-b", quantity: 1 },
    { id: "lot-c", quantity: 1 },
  ];
  const binders = [{
    id: "trade-binder",
    pages: [{
      slots: [
        { collectionItemId: "lot-a", copyIndex: 1 },
        { collectionItemId: "lot-b", copyIndex: 1 },
      ],
    }],
  }];

  assert.deepEqual(unassignedBinderEntries(collection, binders), [
    { collectionItemId: "lot-a", copyIndex: 2 },
    { collectionItemId: "lot-c", copyIndex: 1 },
  ]);
});

test("the managed collection binder represents each owned lot once", () => {
  assert.deepEqual(
    unassignedBinderEntries([{ id: "bulk-lot", quantity: 1_000_000 }], []),
    [{ collectionItemId: "bulk-lot", copyIndex: 1 }],
  );
});

test("custom allocation preserves exact duplicate indexes and can transfer a managed copy", () => {
  const item = { id: "duplicate-lot", quantity: 2 };
  const binders = [
    {
      id: "custom-a",
      pages: [{ slots: [{ collectionItemId: item.id, copyIndex: 1 }] }],
    },
    {
      id: "managed-default",
      pages: [{ slots: [{ collectionItemId: item.id, copyIndex: 2 }] }],
    },
  ];

  assert.deepEqual(unassignedBinderCopyIndexes(item, binders), []);
  assert.deepEqual(
    unassignedBinderCopyIndexes(item, binders, "managed-default"),
    [2],
  );
  assert.deepEqual(
    unassignedBinderCopyIndexes(item, binders, ["custom-a", "managed-default"]),
    [1, 2],
  );
});

test("repair ignores the empty target binder and conservatively reserves malformed assignments", () => {
  const collection = [
    { id: "lot-a", quantity: 1 },
    { id: "lot-b", quantity: 1 },
  ];
  const binders = [
    {
      id: "default-binder",
      pages: [{ slots: [{ collectionItemId: "lot-a", copyIndex: 1 }] }],
    },
    {
      id: "other-binder",
      pages: [{ slots: [{ collectionItemId: "lot-b", copyIndex: null }] }],
    },
  ];

  assert.deepEqual(unassignedBinderEntries(collection, binders, "default-binder"), [
    { collectionItemId: "lot-a", copyIndex: 1 },
  ]);
});

test("fresh migration gives an overlapping local custom binder priority over the default shell", () => {
  const collection = [{ id: "shared-lot", quantity: 1 }];
  const defaultShell = { id: "default-binder", pages: [{ slots: [] }] };
  const customEntries = unassignedBinderEntries(collection, [defaultShell], "custom-binder");
  const migratedCustom = {
    id: "custom-binder",
    pages: [{ slots: customEntries }],
  };
  const defaultEntries = unassignedBinderEntries(
    collection,
    [defaultShell, migratedCustom],
    defaultShell.id,
  );

  assert.deepEqual(customEntries, [{ collectionItemId: "shared-lot", copyIndex: 1 }]);
  assert.deepEqual(defaultEntries, []);
});

test("partial migration recovery releases pending default copies before restoring custom binders", () => {
  const collection = [{ id: "shared-lot", quantity: 1 }];
  const populatedPendingDefault = {
    id: "default-binder",
    pages: [{ slots: [{ collectionItemId: "shared-lot", copyIndex: 1 }] }],
  };
  const emptyCustomShell = { id: "custom-binder", pages: [{ slots: [] }] };
  const clearedPendingDefault = { ...populatedPendingDefault, pages: [{ slots: [] }] };
  const customEntries = unassignedBinderEntries(
    collection,
    [clearedPendingDefault, emptyCustomShell],
    [clearedPendingDefault.id, emptyCustomShell.id],
  );
  const restoredCustom = { ...emptyCustomShell, pages: [{ slots: customEntries }] };
  const rebuiltDefaultEntries = unassignedBinderEntries(
    collection,
    [clearedPendingDefault, restoredCustom],
    clearedPendingDefault.id,
  );

  assert.deepEqual(customEntries, [{ collectionItemId: "shared-lot", copyIndex: 1 }]);
  assert.deepEqual(rebuiltDefaultEntries, []);
});

import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  appendBinderEntriesToBlankSlots,
  BINDER_SYNC_TIMEOUT_MS,
  binderOccupiedCopiesValueMinor,
  shouldCompleteMigratedDefaultBinder,
  shouldShowCollectionBinderFallback,
} from "../src/lib/binders/client-state.ts";

function blankClientPage(position = 0) {
  return {
    position,
    slots: Array.from({ length: 9 }, (_entry, slotPosition) => ({
      collectionItemId: null,
      copyIndex: null,
      note: null,
      position: slotPosition,
    })),
  };
}

test("managed auto-fill preserves noted empty pockets and reports capacity", () => {
  const page = blankClientPage();
  page.slots[0].note = "Reserved for the promo";
  for (let index = 1; index < page.slots.length; index += 1) {
    page.slots[index] = {
      collectionItemId: `lot-${index}`,
      copyIndex: 1,
      note: null,
      position: index,
    };
  }

  const appended = appendBinderEntriesToBlankSlots(
    [page],
    [{ collectionItemId: "new-lot", copyIndex: 1 }],
    2,
  );
  assert.equal(appended.placedCount, 1);
  assert.equal(appended.pages[0].slots[0].collectionItemId, null);
  assert.equal(appended.pages[0].slots[0].note, "Reserved for the promo");
  assert.equal(appended.pages[1].slots[0].collectionItemId, "new-lot");

  const full = appendBinderEntriesToBlankSlots(
    [page],
    [{ collectionItemId: "overflow", copyIndex: 1 }],
    1,
  );
  assert.equal(full.placedCount, 0);
  assert.equal(full.pages[0].slots[0].note, "Reserved for the promo");
});

test("managed auto-fill can hold the full 5,000-lot account quota", () => {
  const entries = Array.from({ length: 5_000 }, (_entry, index) => ({
    collectionItemId: `lot-${index + 1}`,
    copyIndex: 1,
  }));
  const appended = appendBinderEntriesToBlankSlots(
    [blankClientPage(0), blankClientPage(1)],
    entries,
    600,
  );

  assert.equal(appended.placedCount, entries.length);
  assert.equal(appended.pages.length, 556);
  assert.equal(appended.pages[555].slots[4].collectionItemId, "lot-5000");
});

test("binder value apportions total-lot values across occupied copies without overcounting", () => {
  const lot = { id: "manual-lot", quantity: 3, totalValueMinor: 100 };
  const value = (item) => item.totalValueMinor;

  assert.equal(binderOccupiedCopiesValueMinor([lot], value), 33);
  assert.equal(binderOccupiedCopiesValueMinor([lot, lot], value), 67);
  assert.equal(binderOccupiedCopiesValueMinor([lot, lot, lot], value), 100);
  assert.equal(binderOccupiedCopiesValueMinor([lot, lot, lot, lot], value), 100);
  assert.equal(
    binderOccupiedCopiesValueMinor([{ ...lot, id: "unvalued" }], () => null),
    0,
  );
});

test("collection binder stays browsable while the server binder list is empty", () => {
  assert.equal(shouldShowCollectionBinderFallback(0, 11), true);
  assert.equal(shouldShowCollectionBinderFallback(1, 11), false);
  assert.equal(shouldShowCollectionBinderFallback(0, 0), false);
});

test("a retry-marked default binder completes whenever owned card lots exist", () => {
  const emptyMigratedDefault = {
    isDefault: true,
    legacySource: "default",
    pages: [{ slots: Array.from({ length: 9 }, () => ({ collectionItemId: null })) }],
  };

  assert.equal(shouldCompleteMigratedDefaultBinder([emptyMigratedDefault], 13), true);
  assert.equal(shouldCompleteMigratedDefaultBinder([emptyMigratedDefault], 0), false);
  assert.equal(shouldCompleteMigratedDefaultBinder([{
    ...emptyMigratedDefault,
    pages: [{ slots: [{ collectionItemId: "partially-migrated-card" }] }],
  }], 13), true);
});

test("binder completion never targets an unmarked, custom, or non-default binder", () => {
  const emptyPage = { slots: [{ collectionItemId: null }] };

  assert.equal(shouldCompleteMigratedDefaultBinder([{
    isDefault: true,
    pages: [emptyPage],
  }], 13), false);
  assert.equal(shouldCompleteMigratedDefaultBinder([{
    isDefault: false,
    legacySource: "default",
    pages: [emptyPage],
  }], 13), false);
});

test("binder reads have a bounded loading state and render the local collection fallback", async () => {
  const source = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const retrySource = source.slice(
    source.indexOf("const reloadBinders = useCallback"),
    source.indexOf("useEffect(() => {", source.indexOf("const reloadBinders = useCallback")),
  );

  assert.equal(BINDER_SYNC_TIMEOUT_MS, 30_000);
  assert.match(source, /controller\.abort\(\)/);
  assert.match(source, /signal:\s*controller\.signal/);
  assert.match(retrySource, /setBinderRetryNonce\(\(current\) => current \+ 1\)/);
  assert.doesNotMatch(retrySource, /fetchServerBinders\(/);
  assert.match(source, /const binderCardCollection = useMemo/);
  assert.match(source, /const activeCardLotSignature = useMemo/);
  assert.match(source, /const previousSyncTask = binderSyncTaskRef\.current/);
  assert.match(source, /async function loadAndMigrateBinders\(\) \{\s*setIsLoadingBinders\(true\);[\s\S]*?if \(previousSyncTask\)/);
  assert.match(source, /await previousSyncTask\.catch\(\(\) => undefined\)/);
  const binderSyncEffect = source.slice(
    source.indexOf("const previousSyncTask = binderSyncTaskRef.current"),
    source.indexOf("const applyAppData = useCallback"),
  );
  const binderSyncCleanup = binderSyncEffect.slice(binderSyncEffect.indexOf("return () => {"));
  assert.match(
    binderSyncEffect,
    /if \(binderSyncTaskRef\.current === syncTask\) \{\s*binderSyncTaskRef\.current = null;\s*setIsLoadingBinders\(false\);/,
  );
  assert.doesNotMatch(
    binderSyncCleanup,
    /setIsLoadingBinders\(false\)/,
    "an obsolete sync cleanup must not unlock a queued replacement sync",
  );
  assert.match(source, /\[activeCardLotSignature, binderRetryNonce, isLoadingData/);
  assert.doesNotMatch(source, /\[binderRetryNonce, catalogueById, collection, isLoadingData/);
  assert.match(source, /\$\{item\.id}:\$\{item\.quantity}/);
  assert.match(source, /createServerBinder[\s\S]*?fetchBinderRequest\([\s\S]*?method: "POST"/);
  assert.match(source, /replaceServerBinderLayout[\s\S]*?fetchBinderRequest\([\s\S]*?method: "PUT"/);
  assert.match(source, /expectedUpdatedAt: options\.expectedUpdatedAt/);
  assert.match(source, /Binder creation took too long/);
  assert.match(source, /Binder layout save took too long/);
  assert.match(source, /\[defaultBinderSummary\(availableItems\)\]/);
  assert.match(source, /Your collection binder is still available/);
  assert.match(source, /pendingDefaultNeedsCompletion \|\|/);
  assert.match(source, /legacyBinders: migrationPending \|\| pendingDefaultNeedsCompletion \? legacyBinders : \[\]/);
  assert.match(source, /shouldCompleteMigratedDefaultBinder\(\[pendingDefault\], cardItems\.length\)/);
  assert.match(source, /binders = await syncManagedDefaultBinder\(binders, cardCollection\)/);
  assert.equal((source.match(/completeLegacyDefaultMigration: true/g) ?? []).length, 1);
  assert.match(
    source,
    /return \(\) => \{\s*cancelled = true;\s*syncController\.abort\(\);/,
  );
  assert.match(source, /if \(binderSyncControllerRef\.current === syncController\) \{\s*binderSyncControllerRef\.current = null;/);
  assert.match(source, /if \(binderLoadKeyRef\.current === loadKey\) \{\s*binderLoadKeyRef\.current = "";/);

  const createHelper = source.slice(
    source.indexOf("async function createServerBinder"),
    source.indexOf("async function replaceServerBinderLayout"),
  );
  const layoutHelper = source.slice(
    source.indexOf("async function replaceServerBinderLayout"),
    source.indexOf("async function patchServerBinder"),
  );
  assert.doesNotMatch(createHelper, /\bsignal\b/, "dispatched binder creation must not be aborted");
  assert.doesNotMatch(layoutHelper, /\bsignal\b/, "dispatched binder layout writes must not be aborted");
});

test("only the hidden managed default appends globally unassigned new card lots", async () => {
  const source = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const syncSource = source.slice(
    source.indexOf("async function syncManagedDefaultBinder"),
    source.indexOf("function normalizeServerBinder"),
  );

  assert.match(syncSource, /binder\.isDefault && binder\.managedDefault/);
  assert.match(syncSource, /missingLots = collection\.filter\(\(item\) => !representedLotIds\.has\(item\.id\)\)/);
  assert.match(syncSource, /unassignedBinderEntries\(missingLots, binders, managedDefault\.id\)/);
  assert.match(syncSource, /appendBinderEntriesToBlankSlots\(\s*managedDefault\.pages,\s*entries,\s*MAX_MANAGED_BINDER_PAGES/);
  assert.match(syncSource, /appended\.placedCount !== entries\.length/);
});

test("fresh migration persists local custom binders before filling the default binder", async () => {
  const source = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const migration = source.slice(source.indexOf("async function migrateLegacyBinders"));
  const createDefaultShell = migration.indexOf("if (!pendingDefault && cardItems.length)");
  const migrateCustomBinders = migration.indexOf("for (const legacy of legacyBinders)");
  const populateDefault = migration.lastIndexOf("shouldCompleteMigratedDefaultBinder([pendingDefault]");

  assert.ok(createDefaultShell >= 0);
  assert.ok(createDefaultShell < migrateCustomBinders);
  assert.ok(migrateCustomBinders < populateDefault);
  assert.doesNotMatch(migration, /const cleared = await replaceServerBinderLayout/);
  assert.doesNotMatch(migration, /pendingDefault\.id, buildBinderPages\(\[\]\)/);
  assert.match(
    migration.slice(migrateCustomBinders, populateDefault),
    /\[created\.id, \.\.\.\(releasePendingDefault \? \[releasePendingDefault\.id] : \[]\)]/,
  );
  assert.match(migration, /releaseConflictsFromDefaultBinderId: releasePendingDefault\?\.id/);
  assert.match(migration, /nextBinders = releasePendingDefault\s*\? await fetchServerBinders\(signal\)/);
  assert.match(migration, /appendBinderEntriesToBlankSlots\(\s*pendingDefault\.pages,\s*entries,\s*MAX_MANAGED_BINDER_PAGES/);
  assert.match(migration, /pendingDefault\.isDefault && pendingDefault\.managedDefault/);
  assert.match(migration, /existingMigration && !existingMigration\.legacyMigrationPending/);
  assert.match(migration, /existingMigration && existingHasAssignments/);
  assert.match(migration, /replaceServerBinderLayout\(existingMigration\.id, existingMigration\.pages/);
  assert.match(migration, /completeLegacyCustomMigration: true/);
});

test("late local custom migration may transfer exact copies from a completed managed default", async () => {
  const source = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const migration = source.slice(
    source.indexOf("async function migrateLegacyBinders"),
    source.indexOf("async function syncManagedDefaultBinder"),
  );

  assert.match(
    migration,
    /shouldCompleteMigratedDefaultBinder\(\[pendingDefault\], cardItems\.length\) \|\|\s*\(pendingDefault\.isDefault && pendingDefault\.managedDefault\)/,
  );
  assert.match(migration, /releaseConflictsFromDefaultBinderId: releasePendingDefault\?\.id/);
  assert.match(
    migration,
    /\[created\.id, \.\.\.\(releasePendingDefault \? \[releasePendingDefault\.id] : \[]\)]/,
  );
  assert.doesNotMatch(migration, /pendingDefault\.managedDefault\)\s*\? null/);
});

test("late migration reserves copies held by an ordinary user-chosen default", async () => {
  const source = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const migration = source.slice(
    source.indexOf("async function migrateLegacyBinders"),
    source.indexOf("async function syncManagedDefaultBinder"),
  );

  assert.ok(
    migration.indexOf("const releasePendingDefault") < migration.indexOf("const entries = unassignedBinderEntries"),
  );
  assert.doesNotMatch(migration, /\[created\.id, \.\.\.\(pendingDefault \?/);
});

test("explicit custom-binder saves transfer only managed-default copies", async () => {
  const source = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const binderScreen = source.slice(
    source.indexOf("function BindersScreen("),
    source.indexOf("function BinderPage("),
  );
  const createFlow = binderScreen.slice(
    binderScreen.indexOf("async function createBinder"),
    binderScreen.indexOf("async function updateActiveBinderAppearance"),
  );
  const saveFlow = binderScreen.slice(
    binderScreen.indexOf("async function saveActiveBinderLayout"),
    binderScreen.indexOf("async function deleteSelectedBinder"),
  );

  assert.match(createFlow, /binder\.isDefault && binder\.managedDefault/);
  assert.match(createFlow, /unassignedBinderCopyIndexes\(owned, customBinders, managedDefault\?\.id\)/);
  assert.match(createFlow, /entries\.length !== requestedCopyCount/);
  assert.match(createFlow, /releaseConflictsFromDefaultBinderId: managedDefault\?\.id/);
  assert.match(binderScreen, /existingCopyIndexes/);
  assert.match(binderScreen, /unassignedBinderCopyIndexes\(/);
  assert.doesNotMatch(binderScreen, /slot\.copyIndex = index \+ 1/);
  assert.match(saveFlow, /!activeCustomBinder\.isDefault/);
  assert.match(saveFlow, /binder\.isDefault && binder\.managedDefault/);
  assert.match(saveFlow, /releaseConflictsFromDefaultBinderId: managedDefault\?\.id/);
  assert.match(saveFlow, /void reloadBinders\(\{ quiet: true \}\)/);
});

test("every binder PATCH carries its matching version and preserves a dirty draft on conflict", async () => {
  const source = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const patchHelper = source.slice(
    source.indexOf("async function patchServerBinder"),
    source.indexOf("async function deleteServerBinder"),
  );
  const binderScreen = source.slice(
    source.indexOf("function BindersScreen("),
    source.indexOf("function BinderPage("),
  );

  assert.equal((source.match(/await patchServerBinder\(/g) ?? []).length, 3);
  assert.doesNotMatch(source, /patchServerBinder\([^,]+\.id,/);
  assert.match(patchHelper, /Pick<CustomBinder, "id" \| "updatedAt">/);
  assert.match(patchHelper, /expectedUpdatedAt: binder\.updatedAt/);
  assert.ok((binderScreen.match(/pages: binder\.pages/g) ?? []).length >= 2);
  assert.doesNotMatch(binderScreen, /pages: binderSaveState === "dirty" \|\| binderSaveState === "error"/);
});

test("binder drafts survive navigation and can only be discarded explicitly", async () => {
  const source = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const home = source.slice(source.indexOf("export default function Home"), source.indexOf("type ScreenContext"));
  const binderScreen = source.slice(
    source.indexOf("function BindersScreen("),
    source.indexOf("function BinderPage("),
  );

  assert.match(home, /binderDraftSnapshotRef/);
  assert.match(home, /beginBinderDraft[\s\S]*?cloneBinderPages\(binder\.pages\)/);
  assert.match(home, /discardBinderDraft[\s\S]*?pagesByBinderId[\s\S]*?cloneBinderPages\(pages\)/);
  assert.match(home, /canLeaveBinderWorkspace[\s\S]*?binderMutationInFlightRef\.current/);
  assert.match(home, /canLeaveBinderWorkspace[\s\S]*?binderDraftProtectionRef\.current[\s\S]*?discardBinderDraft\(\)/);
  assert.match(home, /function navigate[\s\S]*?!canLeaveBinderWorkspace\(\)/);
  assert.match(home, /function startAdd[\s\S]*?!canLeaveBinderWorkspace\(\)/);
  assert.match(home, /canLeaveBinderWorkspaceRef\.current\(\)/);
  assert.match(home, /warnAboutPendingBinderChanges/);
  assert.match(home, /if \(binderDraftProtectionRef\.current\)[\s\S]*?Binder refresh is paused/);
  assert.match(home, /!cancelled && !binderDraftProtectionRef\.current/);
  assert.match(binderScreen, /binderDraftProtected \? "dirty" : "idle"/);
  assert.match(binderScreen, /closeBinderViewer[\s\S]*?discardBinderDraft\(\)/);
  assert.match(binderScreen, /refreshBindersSafely[\s\S]*?discardBinderDraft\(\)/);
  assert.match(binderScreen, /onOpenItem[\s\S]*?navigate\("item"\)/);
});

test("binder mutations freeze layout controls and block navigation until completion", async () => {
  const source = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const binderScreen = source.slice(
    source.indexOf("function BindersScreen("),
    source.indexOf("function BinderPage("),
  );
  const binderPage = source.slice(
    source.indexOf("function BinderPage("),
    source.indexOf("function BinderSyncControls("),
  );

  assert.match(binderScreen, /isCreatingBinder \|\| isSavingBinder \|\| isUpdatingBinderMetadata \|\| isDeletingBinder/);
  assert.match(binderScreen, /handleBinderSlotClick[\s\S]*?if \(isBinderLayoutLocked\)/);
  assert.match(binderScreen, /setSelectedBinderItemCopyCount[\s\S]*?isBinderLayoutLocked/);
  assert.match(binderScreen, /onUpdatingChange=\{\(updating\)[\s\S]*?setBinderMutationInFlight\(updating\)/);
  assert.match(binderScreen, /isLocked=\{isBinderLayoutLocked\}/);
  assert.match(binderPage, /disabled=\{isLocked \|\| \(!isFilled && !isDropTarget\)\}/);
});

test("custom binder creation waits for bootstrap and compensates an empty shell safely", async () => {
  const source = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const binderScreen = source.slice(
    source.indexOf("function BindersScreen("),
    source.indexOf("function BinderPage("),
  );
  const createFlow = binderScreen.slice(
    binderScreen.indexOf("async function createBinder"),
    binderScreen.indexOf("async function updateActiveBinderAppearance"),
  );

  assert.match(binderScreen, /isBinderSyncBlocked = isLoadingBinders \|\| Boolean\(binderNotice\)/);
  assert.match(createFlow, /if \(isCreatingBinder \|\| isBinderSyncBlocked\)/);
  assert.match(createFlow, /let created: CustomBinder \| null = null/);
  assert.match(createFlow, /await deleteServerBinder\(created\)/);
  assert.match(binderScreen, /disabled=\{isCreatingBinder \|\| isBinderSyncBlocked\}/);
});

test("binder labels and search use the catalogue-supported finish", async () => {
  const source = await readFile(new URL("../src/app/page.tsx", import.meta.url), "utf8");
  const binderSource = source.slice(
    source.indexOf("function BindersScreen("),
    source.indexOf("function AddScreen("),
  );

  assert.match(
    binderSource,
    /selectedVariantLabel\(catalogueItem, item\.variant\)/,
  );
  assert.doesNotMatch(binderSource, /<span className="tag">\{item\.variant\}<\/span>/);
  assert.doesNotMatch(binderSource, /\| \{item\.variant\} \|/);
});

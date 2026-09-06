#!/usr/bin/env node

import "dotenv/config";

import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import {
  CatalogueVisibility,
  NotificationDigestFrequency,
  PrismaClient,
  SubscriptionPlan,
  SubscriptionStatus,
} from "@prisma/client";
import { chromium } from "playwright-core";
import { hashPassword } from "../src/lib/auth/password.ts";
import {
  assertBrowserQaTargetAllowed,
  browserQaRuntimeAttestation,
  createBrowserQaIdentity,
  filteredBrowserConsoleError,
  firstPartyRequestFailure,
  isBrowserQaFixtureIdentity,
  isExpectedBrowserRequestCancellation,
  normalizeBrowserQaBaseUrl,
  parseBrowserQaBoolean,
  runWithPrearmedWaiters,
} from "./authenticated-browser-qa-policy.mjs";

const DOWNLOAD_TIMEOUT_MS = 120_000;
const RESTRICTED_PRICE_SOURCES = [
  "cardtrader-sealed-quarantined",
  "pricecharting-graded-card",
  "pricecharting-sealed",
];
const FORBIDDEN_EXPORT_KEYS = new Set([
  "passwordHash",
  "tokenHash",
  "leaseToken",
  "secret",
  "accessToken",
  "refreshToken",
]);

const settings = browserQaSettings(process.env);
assertBrowserQaTargetAllowed(settings.baseUrl, settings.allowProduction);
const runtimeAttestation = browserQaRuntimeAttestation(settings);

const prisma = new PrismaClient();
const runId = browserQaRunId();
const identity = createBrowserQaIdentity(runId);
const password = `${randomBytes(24).toString("base64url")}Qa!7`;
const report = {
  ok: false,
  runId,
  target: settings.baseUrl,
  browser: null,
  fixture: {
    created: false,
    deletedThroughUi: false,
    cleanup: "not-needed",
  },
  card: null,
  customBinder: null,
  directCard: null,
  sealedProduct: null,
  checks: [],
  diagnostics: {
    consoleErrors: [],
    firstPartyHttpErrors: [],
    firstPartyRequestCancellations: [],
    firstPartyRequestFailures: [],
    pageErrors: [],
    unexpectedDialogs: [],
  },
  failure: null,
};
const diagnosticTracker = createDiagnosticTracker(report.diagnostics);

let browser;
let context;
let fixtureUserId;
let collectionItemId;
let defaultBinderId;
let directCollectionItemId;
let sealedCollectionItemId;
let deletedThroughUi = false;
let primaryError;

try {
  const targetCard = await step("Select a priced catalogue fixture", async () => selectTargetCard(prisma));
  report.card = {
    id: targetCard.id,
    name: targetCard.name,
    number: targetCard.number,
    set: targetCard.cardSet.name,
  };
  const { directCard, sealedProduct } = await step(
    "Select independent priced card and sealed fixtures",
    async () => ({
      directCard: await selectDirectAddCard(prisma, targetCard),
      sealedProduct: await selectTargetSealedProduct(prisma),
    }),
  );
  report.directCard = {
    id: directCard.id,
    name: directCard.name,
    number: directCard.number,
    set: directCard.cardSet.name,
  };
  report.sealedProduct = {
    id: sealedProduct.id,
    name: sealedProduct.name,
    set: sealedProduct.cardSet.name,
  };

  const launch = await launchQaBrowser(settings);
  browser = launch.browser;
  report.browser = launch.description;
  context = await browser.newContext({
    acceptDownloads: true,
    colorScheme: "dark",
    locale: "en-GB",
    serviceWorkers: "block",
    timezoneId: "Europe/London",
    viewport: { width: 1440, height: 1000 },
  });
  const page = await context.newPage();
  observePage(page, settings.baseUrl, diagnosticTracker);

  await step("Verify runtime health", async () => {
    const health = await browserJson(
      page,
      new URL("/api/health", settings.baseUrl).href,
      runtimeAttestation
        ? { headers: { authorization: `Bearer ${runtimeAttestation.jobSecret}` } }
        : undefined,
    );
    assert.equal(health.status, 200, `Health endpoint returned ${health.status}.`);
    assert.equal(health.body?.ok, true, "Health endpoint did not report ok=true.");
    if (runtimeAttestation) {
      assert.equal(
        health.body?.build?.commit,
        runtimeAttestation.expectedCommit,
        `Runtime health identified commit ${health.body?.build?.commit ?? "unknown"}; expected ${runtimeAttestation.expectedCommit}.`,
      );
    }
  });

  const fixture = await step("Provision an isolated verified Plus account", async () =>
    provisionFixture(prisma, { identity, password }),
  );
  fixtureUserId = fixture.id;
  report.fixture.created = true;

  await step("Sign in through the real credentials form", async () => {
    await page.goto(settings.baseUrl, { waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor();
    await page.getByLabel("Email", { exact: true }).fill(identity.email);
    await page.getByLabel("Password", { exact: true }).fill(password);
    await page.locator("form.auth-card button[type='submit']").click();
    await page.getByRole("heading", { name: "Portfolio", exact: true }).waitFor();

    const session = await browserJson(page, new URL("/api/auth/session", settings.baseUrl).href);
    assert.equal(session.status, 200);
    assert.equal(session.body?.user?.email, identity.email);

    const appData = await browserJson(page, new URL("/api/app-data", settings.baseUrl).href);
    assert.equal(appData.status, 200, `Authenticated app-data returned ${appData.status}.`);
    assert.equal(appData.body?.source, "database");
  });

  await step("Search from Portfolio and load the exact card", async () => {
    const dashboardSearch = page.getByLabel("Search the card catalogue", { exact: true });
    await dashboardSearch.fill(targetCard.name);
    await page.getByRole("button", { name: "Search cards", exact: true }).click();
    await page.getByRole("heading", { name: "Add card", exact: true }).waitFor();

    const result = await findCatalogueResult(page, targetCard);
    const price = (await result.locator(".item-value").innerText()).trim();
    assert.match(price, /^\u00a3\d/, `Catalogue search price was not a GBP amount: ${price}`);
    await assertLoadedImage(result.locator("img").first(), `${targetCard.name} search result`);
    await result.locator(".catalogue-result-main").click();
    await page.getByRole("button", { name: "View price history", exact: true }).waitFor();
  });

  await step("Open price history from Add card", async () => {
    const [historyResponse] = await runWithPrearmedWaiters(
      [() => expectPriceHistoryResponse(page, targetCard.id)],
      () => page.getByRole("button", { name: "View price history", exact: true }).click(),
    );
    await assertPriceHistoryResponse(historyResponse, targetCard.id);
    const panel = page.locator(".price-history-panel");
    await panel.getByRole("heading", { name: "Market price", exact: true }).waitFor();
    await waitForRemoteHistory(panel);
    const estimate = (
      await panel.locator(".price-history-headline span").filter({ hasText: "Current estimate" }).locator("strong").innerText()
    ).trim();
    assert.match(estimate, /^\u00a3\d/, `Add-card price history estimate was not a GBP amount: ${estimate}`);
    assert.equal(await panel.getByText("Unable to load price history.", { exact: true }).count(), 0);
  });

  await step("Add the exact variant to Wishlist", async () => {
    await page.getByRole("button", { name: "Add to wishlist", exact: true }).click();
    await page.getByRole("status").filter({ hasText: "added to wishlist" }).waitFor();
    await clickDesktopNav(page, "Wishlist");
    await page.getByRole("heading", { name: "Wishlist", exact: true }).waitFor();
    const wishlistCard = await uniqueVisible(
      page.getByRole("button", { name: `View ${targetCard.name}`, exact: true }),
      `${targetCard.name} wishlist card`,
    );
    await assertLoadedImage(
      wishlistCard.locator("img").first(),
      `${targetCard.name} wishlist item`,
    );
  });

  await step("Convert the Wishlist target into a collection lot", async () => {
    const addOwnedCopy = await uniqueVisible(
      page.getByRole("button", { name: "Add owned-copy details", exact: true }),
      "wishlist owned-copy action",
    );
    await addOwnedCopy.click();
    await page.getByRole("heading", { name: "Add card", exact: true }).waitFor();
    const [historyResponse] = await runWithPrearmedWaiters(
      [() => expectPriceHistoryResponse(page, targetCard.id)],
      () => page.getByRole("button", { name: "Save to collection", exact: true }).click(),
    );
    await page.getByRole("heading", { name: targetCard.name, exact: true }).waitFor();
    await assertPriceHistoryResponse(historyResponse, targetCard.id);

    const detailPricePanel = page.locator(".price-history-panel");
    await detailPricePanel.getByRole("heading", { name: "Market price", exact: true }).waitFor();
    await waitForRemoteHistory(detailPricePanel);
    const estimate = (
      await detailPricePanel.locator(".price-history-headline span").filter({ hasText: "Current estimate" }).locator("strong").innerText()
    ).trim();
    assert.match(estimate, /^\u00a3\d/, `Owned-card current estimate was not a GBP amount: ${estimate}`);
    assert.notEqual(estimate, "Needs estimate");

    const appData = await browserJson(page, new URL("/api/app-data", settings.baseUrl).href);
    assert.equal(appData.status, 200, `Collection verification returned ${appData.status}.`);
    const ownedMatches = Array.isArray(appData.body?.collection)
      ? appData.body.collection.filter((item) => item?.catalogueId === targetCard.id)
      : [];
    assert.equal(ownedMatches.length, 1, `Expected one owned ${targetCard.name} lot, found ${ownedMatches.length}.`);
    assert.match(ownedMatches[0]?.id ?? "", /^[0-9a-f-]{36}$/i, "Owned collection item did not have a UUID.");
    collectionItemId = ownedMatches[0].id;

    await clickDesktopNav(page, "Wishlist");
    await page.getByRole("heading", { name: "No wishlist items", exact: true }).waitFor();
  });

  await step("Verify Collection valuation and card image", async () => {
    await clickDesktopNav(page, "Collection");
    await page.getByRole("heading", { name: "Collection", exact: true }).waitFor();
    const card = await uniqueVisible(
      page.getByRole("button", { name: `View ${targetCard.name}`, exact: true }),
      `${targetCard.name} collection card`,
    );
    assert.match((await card.innerText()).replaceAll(",", ""), /\u00a3\d/);
    await assertLoadedImage(card.locator("img").first(), `${targetCard.name} collection card`);
  });

  await step("Verify default Binder sync and reload persistence", async () => {
    await clickDesktopNav(page, "Binders");
    await page.getByRole("heading", { name: "Binders", exact: true }).waitFor();
    await binderRefreshButton(page).waitFor({ timeout: 45_000 });
    await assertNoVisibleBinderAlert(page, "initial sync");
    const firstServerBinder = await assertServerBinderContains(page, collectionItemId);
    defaultBinderId = firstServerBinder.id;
    await openBinderAndAssertCard(page, targetCard, firstServerBinder.name);
    await page.getByRole("button", { name: "Close binder viewer", exact: true }).click();

    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Binders", exact: true }).waitFor();
    await binderRefreshButton(page).waitFor({ timeout: 45_000 });
    await assertNoVisibleBinderAlert(page, "reload sync");
    const reloadedServerBinder = await assertServerBinderContains(page, collectionItemId);
    assert.equal(reloadedServerBinder.id, defaultBinderId, "Reload returned a different default binder.");
    await openBinderAndAssertCard(page, targetCard, reloadedServerBinder.name);
    await page.getByRole("button", { name: "Close binder viewer", exact: true }).click();
  });

  await step("Persist notification preferences without sending mail", async () => {
    await clickDesktopNav(page, "Settings");
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    assert.match(await page.locator(".settings-overview-grid").innerText(), /\bPlus\b/);
    const notifications = settingsPanel(page, "Notifications");
    await notifications.locator("select").selectOption("Weekly");
    assert.equal(await notifications.locator("select").inputValue(), "Weekly");
    const [saveResponse] = await runWithPrearmedWaiters([
      () => armPageEvent(page, "response", {
        label: "notification preference response",
        predicate: (response) => {
          const url = new URL(response.url());
          return response.request().method() === "PATCH" && url.pathname === "/api/notification-preferences";
        },
        timeout: 45_000,
      }),
    ], () => notifications.getByRole("button", { name: "Save preferences", exact: true }).click());
    const savedPreferences = await saveResponse.json().catch(() => null);
    assert.equal(saveResponse.status(), 200, `Notification preference save returned ${saveResponse.status()}.`);
    assert.equal(savedPreferences?.digestFrequency, "Weekly", "Preference API did not return the selected frequency.");
    await page.getByRole("status").filter({ hasText: "preferences" }).waitFor();
    const persistedPreferences = await browserJson(
      page,
      new URL("/api/notification-preferences", settings.baseUrl).href,
    );
    assert.equal(persistedPreferences.status, 200);
    assert.equal(persistedPreferences.body?.digestFrequency, "Weekly", "Preference API did not persist the selected frequency.");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    await waitForInputValue(settingsPanel(page, "Notifications").locator("select"), "Weekly");
  });

  await step("Download and validate the collection CSV", async () => {
    const [download] = await runWithPrearmedWaiters(
      [() => armPageEvent(page, "download", { label: "collection CSV download", timeout: DOWNLOAD_TIMEOUT_MS })],
      () => page.getByRole("button", { name: "Export CSV", exact: true }).click(),
    );
    assert.match(download.suggestedFilename(), /^mintbinder-collection-\d{4}-\d{2}-\d{2}\.csv$/);
    const content = await downloadText(download);
    const [header = "", ...rows] = content.trim().split(/\r?\n/);
    const columns = header.split(",");
    for (const required of ["collection_item_id", "catalogue_id", "name", "set", "estimated_value_minor"]) {
      assert.ok(columns.includes(required), `CSV header omitted ${required}.`);
    }
    assert.equal(rows.length, 1, `Expected one exported collection row, found ${rows.length}.`);
    assert.ok(content.includes(targetCard.name), "CSV did not contain the QA card.");
    assert.ok(content.includes(targetCard.cardSet.name), "CSV did not contain the QA card set.");
  });

  await step("Show report progress and validate the insurance PDF", async () => {
    const [download] = await runWithPrearmedWaiters([
      () => armPageEvent(page, "download", { label: "insurance PDF download", timeout: DOWNLOAD_TIMEOUT_MS }),
      () => armLocatorVisible(
        page.getByRole("status").filter({ hasText: "Building your PDF" }),
        { label: "insurance report progress", timeout: 10_000 },
      ),
    ], () => page.getByRole("button", { name: "Insurance report", exact: true }).click());
    assert.match(download.suggestedFilename(), /^mintbinder-insurance-report-\d{4}-\d{2}-\d{2}\.pdf$/);
    const bytes = await downloadBytes(download);
    assert.ok(bytes.length > 1_000, `Insurance PDF was unexpectedly small (${bytes.length} bytes).`);
    assert.equal(bytes.subarray(0, 4).toString("ascii"), "%PDF");
  });

  await step("Download and inspect the secure account archive", async () => {
    await page.getByRole("button", { name: "Export account JSON", exact: true }).click();
    const exportForm = page.locator("form.account-export-form");
    await exportForm.getByLabel("Current password", { exact: true }).fill(password);
    const [download] = await runWithPrearmedWaiters(
      [() => armPageEvent(page, "download", { label: "account archive download", timeout: DOWNLOAD_TIMEOUT_MS })],
      () => exportForm.getByRole("button", { name: "Confirm and download", exact: true }).click(),
    );
    assert.match(download.suggestedFilename(), /^mintbinder-account-\d{4}-\d{2}-\d{2}\.json$/);
    const archive = JSON.parse(await downloadText(download));
    assert.equal(archive?.format, "mintbinder-account-export");
    assert.equal(archive?.account?.email, identity.email);
    assert.ok(
      archive.account.collectionItems?.some((item) => item.cardPrinting?.id === targetCard.id),
      "Account archive did not contain the QA collection item.",
    );
    const forbidden = findForbiddenKeys(archive);
    assert.deepEqual(forbidden, [], `Account archive exposed forbidden keys: ${forbidden.join(", ")}`);
  });

  await step("Create, rearrange, and reload a custom Binder", async () => {
    const binderName = `QA Binder ${runId}`;
    await clickDesktopNav(page, "Binders");
    await page.getByRole("heading", { name: "Binders", exact: true }).waitFor();
    await binderRefreshButton(page).waitFor({ timeout: 45_000 });
    await page.getByRole("button", { name: "New binder", exact: true }).click();

    const builder = page.locator(".binder-builder-panel");
    await builder.getByRole("heading", { name: "Create custom binder", exact: true }).waitFor();
    await builder.getByLabel("Binder name", { exact: true }).fill(binderName);
    await builder.getByRole("button", { name: `Add one copy of ${targetCard.name}`, exact: true }).click();

    const [createResponse, initialLayoutResponse] = await runWithPrearmedWaiters([
      () => expectFirstPartyResponse(page, {
        label: "custom binder creation",
        method: "POST",
        pathname: "/api/binders",
      }),
      () => expectFirstPartyResponse(page, {
        label: "initial custom binder layout",
        method: "PUT",
        pathnamePattern: /^\/api\/binders\/[0-9a-f-]+\/layout$/i,
      }),
    ], () => builder.getByRole("button", { name: "Create binder", exact: true }).click());
    assert.equal(createResponse.status(), 201, `Custom binder creation returned ${createResponse.status()}.`);
    assert.equal(initialLayoutResponse.status(), 200, `Initial custom binder layout returned ${initialLayoutResponse.status()}.`);
    const initialLayoutBody = await initialLayoutResponse.json().catch(() => null);
    const binderId = initialLayoutBody?.binder?.id;
    assert.match(binderId ?? "", /^[0-9a-f-]{36}$/i, "Custom binder response did not identify a UUID.");
    report.customBinder = { id: binderId, name: binderName };

    const dialog = page.getByRole("dialog", { name: `${binderName} binder`, exact: true });
    await dialog.waitFor({ timeout: 30_000 });
    await binderRefreshButton(page).waitFor({ timeout: 45_000 });
    assertBinderItemAtSlot(await serverBinderByName(page, binderName), collectionItemId, 0);

    await dialog.getByRole("button", { name: "Arrange cards", exact: true }).click();
    await dialog.getByRole("button", { name: `Move ${targetCard.name}`, exact: true }).click();
    await dialog.getByRole("button", { name: "Place lifted card into slot 2", exact: true }).click();
    await dialog.getByRole("status").filter({ hasText: "Unsaved layout changes" }).waitFor();

    const [savedLayoutResponse, refreshedBindersResponse] = await runWithPrearmedWaiters([
      () => expectFirstPartyResponse(page, {
        label: "manual custom binder layout save",
        method: "PUT",
        pathname: `/api/binders/${binderId}/layout`,
      }),
      () => expectFirstPartyResponse(page, {
        label: "binder refresh after manual layout save",
        method: "GET",
        pathname: "/api/binders",
      }),
    ], () => dialog.getByRole("button", { name: "Save layout", exact: true }).click());
    assert.equal(savedLayoutResponse.status(), 200, `Manual binder layout save returned ${savedLayoutResponse.status()}.`);
    assert.equal(refreshedBindersResponse.status(), 200, `Post-save binder refresh returned ${refreshedBindersResponse.status()}.`);
    await dialog.getByRole("status").filter({ hasText: "Saved across devices" }).waitFor();
    assertBinderItemAtSlot(await serverBinderByName(page, binderName), collectionItemId, 1);

    await page.getByRole("button", { name: "Close binder viewer", exact: true }).click();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("heading", { name: "Binders", exact: true }).waitFor();
    await binderRefreshButton(page).waitFor({ timeout: 45_000 });
    assertBinderItemAtSlot(await serverBinderByName(page, binderName), collectionItemId, 1);
    await openBinderAndAssertCard(page, targetCard, binderName);
    const reloadedDialog = page.getByRole("dialog", { name: `${binderName} binder`, exact: true });
    assert.equal(
      await reloadedDialog.locator(".binder-page.primary .binder-pocket").nth(0).getAttribute("aria-label"),
      "Empty binder sleeve 1",
      "The custom binder did not retain its intentionally blank first pocket.",
    );
    assert.equal(
      await reloadedDialog.locator(".binder-page.primary .binder-pocket").nth(1).getAttribute("aria-label"),
      `Open ${targetCard.name}`,
      "The custom binder did not retain the card in its second pocket.",
    );
    await page.getByRole("button", { name: "Close binder viewer", exact: true }).click();
  });

  await step("Add a second card directly without Wishlist conversion", async () => {
    await clickDesktopNav(page, "Add");
    await page.getByRole("heading", { name: "Add card", exact: true }).waitFor();
    await page.locator(".add-type-tabs").getByRole("button", { name: "Cards", exact: true }).click();
    await page.locator(".catalogue-controls").getByLabel("Set", { exact: true })
      .selectOption(directCard.cardSet.name);
    await page.getByPlaceholder("Search cards, sets, or collector numbers", { exact: true })
      .fill(directCard.name);
    const result = await findCatalogueResult(page, directCard);
    assert.match((await result.locator(".item-value").innerText()).trim(), /^\u00a3\d/);
    await assertLoadedImage(result.locator("img").first(), `${directCard.name} direct-add result`);
    await result.locator(".catalogue-result-main").click();

    const [createResponse] = await runWithPrearmedWaiters([
      () => expectFirstPartyResponse(page, {
        label: "direct card collection write",
        method: "POST",
        pathname: "/api/collection-items",
      }),
    ], () => page.getByRole("button", { name: "Save to collection", exact: true }).click());
    assert.equal(createResponse.status(), 200, `Direct card add returned ${createResponse.status()}.`);
    const createBody = await createResponse.json().catch(() => null);
    assert.equal(createBody?.item?.catalogueId, directCard.id, "Direct card API response identified the wrong printing.");
    await page.getByRole("heading", { name: directCard.name, exact: true }).waitFor();

    const appData = await browserJson(page, new URL("/api/app-data", settings.baseUrl).href);
    assert.equal(appData.status, 200, `Direct card verification returned ${appData.status}.`);
    const matches = appData.body?.collection?.filter((item) => item?.catalogueId === directCard.id) ?? [];
    assert.equal(matches.length, 1, `Expected one direct-add ${directCard.name} lot, found ${matches.length}.`);
    assert.equal(appData.body?.wishlist?.some((item) => item?.catalogueId === directCard.id), false);
    directCollectionItemId = matches[0]?.id;
    assert.match(directCollectionItemId ?? "", /^[0-9a-f-]{36}$/i, "Direct-add collection item did not have a UUID.");
  });

  await step("Add a priced sealed product and verify API persistence", async () => {
    await clickDesktopNav(page, "Add");
    await page.getByRole("heading", { name: "Add card", exact: true }).waitFor();
    await page.locator(".add-type-tabs").getByRole("button", { name: "Sealed", exact: true }).click();
    await page.getByRole("heading", { name: "Add sealed product", exact: true }).waitFor();
    await page.locator(".catalogue-controls").getByLabel("Set", { exact: true })
      .selectOption(sealedProduct.cardSet.name);
    await page.getByPlaceholder("Search sealed products or sets", { exact: true }).fill(sealedProduct.name);
    const result = await findCatalogueResult(page, sealedProduct);
    assert.match((await result.locator(".item-value").innerText()).trim(), /^\u00a3\d/);
    await assertLoadedImage(result.locator("img").first(), `${sealedProduct.name} sealed result`);
    await result.locator(".catalogue-result-main").click();

    const [createResponse] = await runWithPrearmedWaiters([
      () => expectFirstPartyResponse(page, {
        label: "sealed product collection write",
        method: "POST",
        pathname: "/api/collection-items",
      }),
    ], () => page.getByRole("button", { name: "Save to collection", exact: true }).click());
    assert.equal(createResponse.status(), 200, `Sealed product add returned ${createResponse.status()}.`);
    const createBody = await createResponse.json().catch(() => null);
    assert.equal(createBody?.item?.catalogueId, sealedProduct.id, "Sealed add API response identified the wrong product.");
    await page.getByRole("heading", { name: sealedProduct.name, exact: true }).waitFor();

    const appData = await browserJson(page, new URL("/api/app-data", settings.baseUrl).href);
    assert.equal(appData.status, 200, `Sealed persistence verification returned ${appData.status}.`);
    const matches = appData.body?.collection?.filter((item) => item?.catalogueId === sealedProduct.id) ?? [];
    assert.equal(matches.length, 1, `Expected one owned ${sealedProduct.name} lot, found ${matches.length}.`);
    assert.equal(matches[0]?.condition, "Sealed");
    assert.equal(matches[0]?.variant, "Factory sealed");
    sealedCollectionItemId = matches[0]?.id;
    assert.match(sealedCollectionItemId ?? "", /^[0-9a-f-]{36}$/i, "Sealed collection item did not have a UUID.");
  });

  await step("Verify the authenticated mobile navigation", async () => {
    const storageState = await context.storageState();
    const mobile = await browser.newContext({
      colorScheme: "dark",
      locale: "en-GB",
      serviceWorkers: "block",
      storageState,
      timezoneId: "Europe/London",
      viewport: { width: 360, height: 800 },
    });
    try {
      const mobilePage = await mobile.newPage();
      observePage(mobilePage, settings.baseUrl, diagnosticTracker);
      await mobilePage.goto(settings.baseUrl, { waitUntil: "domcontentloaded" });
      await mobilePage.getByRole("heading", { name: "Portfolio", exact: true }).waitFor();
      await mobilePage.locator("nav.bottom-nav").waitFor();
      await assertNoHorizontalDocumentOverflow(mobilePage, "Portfolio");
      for (const [locator, label] of [
        [mobilePage.locator(".topbar-actions > .plan-pill"), "plan header action"],
        [mobilePage.locator(".topbar-actions > .alert-pill"), "alerts header action"],
        [mobilePage.locator(".topbar-actions > .user-pill"), "settings header action"],
        [mobilePage.locator(".topbar-actions > .button.small[aria-label='Sign out']"), "sign-out header action"],
      ]) {
        await assertActionableWithinViewport(locator, label, 360);
      }
      await mobilePage.locator("nav.bottom-nav").getByRole("button", { name: "Add", exact: true }).click();
      await mobilePage.getByRole("heading", { name: "Add card", exact: true }).waitFor();
      await assertNoHorizontalDocumentOverflow(mobilePage, "Add card");
      await mobilePage.locator("nav.bottom-nav").getByRole("button", { name: "More", exact: true }).click();
      await mobilePage.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    } finally {
      await mobile.close();
    }
  });

  await step("Permanently delete the disposable account through Settings", async () => {
    await clickDesktopNav(page, "Settings");
    await page.getByRole("heading", { name: "Settings", exact: true }).waitFor();
    await page.getByRole("button", { name: "Delete account\u2026", exact: true }).click();
    const deleteForm = page.locator("form.account-delete-form");
    await deleteForm.getByLabel("Confirm account email", { exact: true }).fill(identity.email);
    await deleteForm.getByLabel("Current password", { exact: true }).fill(password);
    await deleteForm.locator("label.field").filter({ hasText: "DELETE MY ACCOUNT" }).locator("input").fill("DELETE MY ACCOUNT");
    await deleteForm.getByRole("button", { name: "Permanently delete account", exact: true }).click();
    await page.getByRole("heading", { name: "Sign in", exact: true }).waitFor({ timeout: 45_000 });

    const privateRead = await browserJson(page, new URL("/api/app-data", settings.baseUrl).href);
    assert.equal(privateRead.status, 401, `Deleted browser session could still read app data (${privateRead.status}).`);
    assert.equal(await prisma.user.findUnique({ where: { id: fixtureUserId }, select: { id: true } }), null);
    deletedThroughUi = true;
    report.fixture.deletedThroughUi = true;
  });

  await step("Confirm no first-party browser failures", async () => {
    assert.deepEqual(report.diagnostics.consoleErrors, []);
    assert.deepEqual(report.diagnostics.pageErrors, []);
    assert.deepEqual(report.diagnostics.firstPartyHttpErrors, []);
    assert.deepEqual(report.diagnostics.firstPartyRequestFailures, []);
    assert.deepEqual(report.diagnostics.unexpectedDialogs, []);
  });
} catch (error) {
  primaryError = error;
  report.failure = serializeError(error);
} finally {
  if (context) {
    await context.close().catch(() => undefined);
  }
  if (browser) {
    await browser.close().catch(() => undefined);
  }

  if (fixtureUserId && !deletedThroughUi) {
    try {
      const fixture = await prisma.user.findUnique({
        where: { id: fixtureUserId },
        select: { displayName: true, email: true, id: true },
      });
      if (fixture) {
        assert.ok(
          isBrowserQaFixtureIdentity({ ...fixture, runId }),
          `Refusing fallback cleanup for non-QA identity ${fixture.email}.`,
        );
        await prisma.user.delete({ where: { id: fixture.id } });
        report.fixture.cleanup = "fallback-database-delete";
      } else {
        report.fixture.cleanup = "already-deleted";
      }
    } catch (cleanupError) {
      report.fixture.cleanup = "failed";
      const serialized = serializeError(cleanupError);
      report.failure = report.failure
        ? { ...report.failure, cleanupError: serialized }
        : serialized;
      primaryError ??= cleanupError;
    }
  } else if (deletedThroughUi) {
    report.fixture.cleanup = "ui-account-deletion";
  }

  await prisma.$disconnect();
}

report.ok = !primaryError && report.checks.every((check) => check.ok) && report.fixture.cleanup !== "failed";
console.log(JSON.stringify(report, null, 2));
if (!report.ok) process.exitCode = 1;

async function step(name, action) {
  const startedAt = Date.now();
  const diagnosticStart = diagnosticCounts(report.diagnostics);
  let rejectOnDiagnostic;
  const diagnosticFailure = new Promise((_, reject) => {
    rejectOnDiagnostic = reject;
  });
  const unsubscribe = diagnosticTracker.subscribe((failure) => {
    rejectOnDiagnostic(new Error(`Browser failure during "${name}": ${JSON.stringify(failure)}`));
  });
  process.stdout.write(`[browser-qa] ${name} ... `);
  try {
    const actionResult = Promise.resolve().then(action);
    actionResult.catch(() => undefined);
    const value = await Promise.race([actionResult, diagnosticFailure]);
    const failures = newDiagnosticFailures(report.diagnostics, diagnosticStart);
    assert.deepEqual(failures, [], `Browser failures occurred during \"${name}\": ${JSON.stringify(failures)}`);
    const durationMs = Date.now() - startedAt;
    report.checks.push({ name, ok: true, durationMs });
    console.log(`ok (${durationMs}ms)`);
    return value;
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    report.checks.push({ name, ok: false, durationMs, error: serializeError(error) });
    console.log(`failed (${durationMs}ms)`);
    throw error;
  } finally {
    unsubscribe();
  }
}

function browserQaSettings(env) {
  const baseUrl = normalizeBrowserQaBaseUrl(
    env.AUTHENTICATED_QA_BASE_URL || env.NEXT_PUBLIC_APP_URL || "http://127.0.0.1:3000",
  );
  return {
    allowProduction: parseBrowserQaBoolean(env.AUTHENTICATED_QA_ALLOW_PRODUCTION, false),
    baseUrl,
    browserChannel: env.AUTHENTICATED_QA_BROWSER_CHANNEL?.trim() || "chrome",
    browserExecutable: env.AUTHENTICATED_QA_BROWSER_EXECUTABLE?.trim() || "",
    expectedCommit: env.AUTHENTICATED_QA_EXPECTED_COMMIT,
    headless: parseBrowserQaBoolean(env.AUTHENTICATED_QA_HEADLESS, true),
    jobSecret: env.JOB_SECRET,
  };
}

function browserQaRunId(now = new Date()) {
  return `${now.toISOString().replace(/[-:.TZ]/g, "").slice(0, 14)}-${randomBytes(4).toString("hex")}`;
}

async function provisionFixture(client, { identity: qaIdentity, password: rawPassword }) {
  const passwordHash = await hashPassword(rawPassword);
  return client.user.create({
    data: {
      displayName: qaIdentity.displayName,
      email: qaIdentity.email,
      emailVerifiedAt: new Date(),
      passwordHash,
      preferredCurrency: "GBP",
      preferredRegion: "United Kingdom",
      notificationPreference: {
        create: {
          digestFrequency: NotificationDigestFrequency.OFF,
          priceAlertsEnabled: false,
          weakPriceAlertsEnabled: false,
          wishlistTargetAlertsEnabled: false,
        },
      },
      subscriptions: {
        create: {
          currentPeriodEnd: new Date(Date.now() + 2 * 60 * 60 * 1000),
          plan: SubscriptionPlan.PLUS_MONTHLY,
          provider: "local",
          status: SubscriptionStatus.ACTIVE,
        },
      },
    },
    select: { displayName: true, email: true, id: true },
  });
}

async function selectTargetCard(client) {
  const priceWhere = {
    gradedCompany: null,
    priceMinor: { gt: 0 },
    source: { notIn: RESTRICTED_PRICE_SOURCES },
  };
  const usableCardWhere = {
    imageSmallUrl: { not: null },
    language: "en",
    priceSnapshots: { some: priceWhere },
  };
  const select = {
    cardSet: { select: { id: true, name: true } },
    id: true,
    imageLargeUrl: true,
    imageSmallUrl: true,
    name: true,
    number: true,
    priceSnapshots: {
      orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
      select: { observedAt: true, priceMinor: true, source: true, variantLabel: true },
      take: 8,
      where: priceWhere,
    },
  };
  const preferred = await client.cardPrinting.findFirst({
    where: {
      ...usableCardWhere,
      cardSet: { name: { equals: "Team Up", mode: "insensitive" } },
      name: { equals: "Latias & Latios-GX", mode: "insensitive" },
      number: "170",
    },
    select,
  });
  const fallback = preferred ?? await client.cardPrinting.findFirst({
    orderBy: [{ updatedAt: "desc" }, { name: "asc" }],
    where: usableCardWhere,
    select,
  });
  assert.ok(fallback, "No English card with a working image and customer-visible raw price was available.");
  assert.ok(fallback.priceSnapshots.length, "Selected QA card had no usable price snapshots.");
  return fallback;
}

async function selectDirectAddCard(client, excludedCard) {
  const priceWhere = {
    gradedCompany: null,
    priceMinor: { gt: 0 },
    source: { notIn: RESTRICTED_PRICE_SOURCES },
  };
  const card = await client.cardPrinting.findFirst({
    orderBy: [{ name: "asc" }, { number: "asc" }, { id: "asc" }],
    where: {
      id: { not: excludedCard.id },
      imageSmallUrl: { not: null },
      language: "en",
      name: { not: excludedCard.name },
      priceSnapshots: { some: priceWhere },
    },
    select: {
      cardSet: { select: { id: true, name: true } },
      id: true,
      imageLargeUrl: true,
      imageSmallUrl: true,
      name: true,
      number: true,
      priceSnapshots: {
        orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
        select: { observedAt: true, priceMinor: true, source: true, variantLabel: true },
        take: 8,
        where: priceWhere,
      },
    },
  });
  assert.ok(card, "No independent English card with a working image and customer-visible price was available.");
  assert.ok(card.priceSnapshots.length, "Selected direct-add QA card had no usable price snapshots.");
  return card;
}

async function selectTargetSealedProduct(client) {
  const priceWhere = {
    gradedCompany: null,
    priceMinor: { gt: 0 },
    source: { notIn: RESTRICTED_PRICE_SOURCES },
  };
  const product = await client.sealedProduct.findFirst({
    orderBy: [{ name: "asc" }, { id: "asc" }],
    where: {
      imageUrl: { not: null },
      relatedCardSetId: { not: null },
      visibility: CatalogueVisibility.GLOBAL,
      priceSnapshots: { some: priceWhere },
    },
    select: {
      id: true,
      imageUrl: true,
      name: true,
      priceSnapshots: {
        orderBy: [{ observedAt: "desc" }, { createdAt: "desc" }],
        select: { observedAt: true, priceMinor: true, source: true, variantLabel: true },
        take: 8,
        where: priceWhere,
      },
      relatedCardSet: { select: { id: true, name: true } },
    },
  });
  assert.ok(product?.relatedCardSet, "No global sealed product with a set, working image, and visible price was available.");
  assert.ok(product.priceSnapshots.length, "Selected sealed QA fixture had no usable price snapshots.");
  return {
    ...product,
    cardSet: product.relatedCardSet,
    number: "Sealed",
  };
}

async function launchQaBrowser(options) {
  const candidates = [
    options.browserExecutable,
    process.platform === "win32" ? "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe" : "",
    process.platform === "win32" ? "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe" : "",
    process.platform === "win32" ? "C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe" : "",
  ].filter(Boolean);
  const executablePath = candidates.find((candidate) => existsSync(candidate));
  if (executablePath) {
    return {
      browser: await chromium.launch({ executablePath, headless: options.headless }),
      description: executablePath,
    };
  }
  return {
    browser: await chromium.launch({ channel: options.browserChannel, headless: options.headless }),
    description: `channel:${options.browserChannel}`,
  };
}

function createDiagnosticTracker(diagnostics) {
  const subscribers = new Set();
  return {
    record(category, value, failure) {
      diagnostics[category].push(value);
      if (failure) {
        for (const subscriber of subscribers) subscriber(failure);
      }
    },
    subscribe(subscriber) {
      subscribers.add(subscriber);
      return () => subscribers.delete(subscriber);
    },
  };
}

function observePage(page, baseUrl, tracker) {
  const firstPartyOrigin = new URL(baseUrl).origin;
  page.on("pageerror", (error) => {
    const failure = { message: error.message, type: "pageerror" };
    tracker.record("pageErrors", error.message, failure);
  });
  page.on("dialog", (dialog) => {
    const entry = { message: dialog.message(), type: dialog.type() };
    void dialog.dismiss().catch(() => undefined);
    tracker.record("unexpectedDialogs", entry, { ...entry, type: `dialog:${entry.type}` });
  });
  page.on("console", (message) => {
    const entry = filteredBrowserConsoleError({
      baseUrl,
      locationUrl: message.location().url,
      text: message.text(),
      type: message.type(),
    });
    if (entry) tracker.record("consoleErrors", entry, entry);
  });
  page.on("requestfailed", (request) => {
    const entry = firstPartyRequestFailure({
      baseUrl,
      errorText: request.failure()?.errorText,
      method: request.method(),
      resourceType: request.resourceType(),
      url: request.url(),
    });
    if (entry && isExpectedBrowserRequestCancellation(entry)) {
      tracker.record("firstPartyRequestCancellations", entry);
    } else if (entry) {
      tracker.record("firstPartyRequestFailures", entry, entry);
    }
  });
  page.on("response", (response) => {
    const url = new URL(response.url());
    if (url.origin === firstPartyOrigin && response.status() >= 500) {
      const failure = {
        method: response.request().method(),
        status: response.status(),
        url: response.url(),
      };
      tracker.record("firstPartyHttpErrors", failure, failure);
      void response.text()
        .then((body) => { failure.body = body.slice(0, 500); })
        .catch(() => undefined);
    }
  });
}

function diagnosticCounts(diagnostics) {
  return {
    consoleErrors: diagnostics.consoleErrors.length,
    firstPartyHttpErrors: diagnostics.firstPartyHttpErrors.length,
    firstPartyRequestFailures: diagnostics.firstPartyRequestFailures.length,
    pageErrors: diagnostics.pageErrors.length,
    unexpectedDialogs: diagnostics.unexpectedDialogs.length,
  };
}

function newDiagnosticFailures(diagnostics, start) {
  return [
    ...diagnostics.consoleErrors.slice(start.consoleErrors),
    ...diagnostics.firstPartyHttpErrors.slice(start.firstPartyHttpErrors),
    ...diagnostics.firstPartyRequestFailures.slice(start.firstPartyRequestFailures),
    ...diagnostics.pageErrors.slice(start.pageErrors).map((message) => ({ message, type: "pageerror" })),
    ...diagnostics.unexpectedDialogs.slice(start.unexpectedDialogs).map((dialog) => ({ ...dialog, type: `dialog:${dialog.type}` })),
  ];
}

async function browserJson(page, url, options = {}) {
  const response = await page.context().request.get(url, {
    failOnStatusCode: false,
    headers: { "cache-control": "no-store", ...options.headers },
  });
  return {
    body: await response.json().catch(() => null),
    status: response.status(),
  };
}

async function findCatalogueResult(page, targetCard, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  do {
    const results = page.locator(".catalogue-result-card");
    const count = await results.count();
    for (let index = 0; index < count; index += 1) {
      const result = results.nth(index);
      const title = (await result.locator("h3").innerText()).trim();
      const identityText = (await result.locator("p.muted").innerText()).trim();
      const identityParts = identityText.split("|").map((part) => part.trim());
      if (
        title === targetCard.name &&
        identityParts[0] === targetCard.cardSet.name &&
        identityParts.at(-1) === targetCard.number
      ) {
        return result;
      }
    }
    await page.waitForTimeout(100);
  } while (Date.now() < deadline);
  throw new Error(`Could not find ${targetCard.name} (${targetCard.cardSet.name} ${targetCard.number}) in Add-card results.`);
}

function expectFirstPartyResponse(page, {
  label,
  method,
  pathname,
  pathnamePattern,
  timeout = 45_000,
}) {
  return armPageEvent(page, "response", {
    label,
    predicate: (response) => {
      const url = new URL(response.url());
      return url.origin === new URL(settings.baseUrl).origin &&
        response.request().method() === method &&
        (pathname ? url.pathname === pathname : pathnamePattern?.test(url.pathname));
    },
    timeout,
  });
}

function expectPriceHistoryResponse(page, catalogueId) {
  return armPageEvent(page, "response", {
    label: `price history response for ${catalogueId}`,
    predicate: (response) => {
      const url = new URL(response.url());
      return (
        response.request().method() === "GET" &&
        url.pathname === "/api/price-history" &&
        url.searchParams.get("catalogueId") === catalogueId
      );
    },
    timeout: 45_000,
  });
}

function armPageEvent(page, eventName, { label, predicate = () => true, timeout }) {
  let settled = false;
  let rejectWaiter;
  let timer;
  let onEvent = () => {};

  const cleanup = () => {
    clearTimeout(timer);
    page.off(eventName, onEvent);
    page.off("close", onPageClose);
  };
  const reject = (error) => {
    if (settled) return;
    settled = true;
    cleanup();
    rejectWaiter(error);
  };
  const onPageClose = () => reject(new Error(`Page closed while waiting for ${label}.`));
  const promise = new Promise((resolve, rejectPromise) => {
    rejectWaiter = rejectPromise;
    onEvent = (value) => {
      if (settled) return;
      let matches;
      try {
        matches = predicate(value);
      } catch (error) {
        reject(error);
        return;
      }
      if (!matches) return;
      settled = true;
      cleanup();
      resolve(value);
    };
    page.on(eventName, onEvent);
    page.on("close", onPageClose);
    timer = setTimeout(() => reject(new Error(`Timed out after ${timeout}ms waiting for ${label}.`)), timeout);
  });

  return {
    cancel() {
      reject(new Error(`Cancelled ${label} after its trigger did not complete.`));
    },
    promise,
  };
}

function armLocatorVisible(locator, { label, timeout }) {
  let settled = false;
  let rejectWaiter;
  let timer;

  const promise = new Promise((resolve, reject) => {
    rejectWaiter = reject;
    const deadline = Date.now() + timeout;
    const inspect = async () => {
      if (settled) return;
      try {
        if (await locator.isVisible()) {
          settled = true;
          clearTimeout(timer);
          resolve(locator);
          return;
        }
      } catch (error) {
        if (!settled) {
          settled = true;
          clearTimeout(timer);
          reject(error);
        }
        return;
      }
      if (Date.now() >= deadline) {
        settled = true;
        reject(new Error(`Timed out after ${timeout}ms waiting for ${label}.`));
        return;
      }
      timer = setTimeout(inspect, 50);
    };
    void inspect();
  });

  return {
    cancel() {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      rejectWaiter(new Error(`Cancelled ${label} after its trigger did not complete.`));
    },
    promise,
  };
}

async function assertPriceHistoryResponse(response, catalogueId) {
  const body = await response.json().catch(() => null);
  assert.equal(response.status(), 200, `Price history for ${catalogueId} returned ${response.status()}.`);
  assert.equal(body?.catalogueId, catalogueId, `Price history response identified ${body?.catalogueId ?? "no card"}.`);
  assert.ok(Array.isArray(body?.points), `Price history for ${catalogueId} did not return a points array.`);
  assert.ok(body.points.length > 0, `Price history for ${catalogueId} returned no usable points.`);
}

async function assertLoadedImage(locator, label) {
  await locator.waitFor({ state: "visible", timeout: 30_000 });
  await locator.evaluate((image) => {
    if (!(image instanceof HTMLImageElement)) throw new Error("Expected an image element.");
    if (image.complete && image.naturalWidth > 0) return;
    return new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => reject(new Error("Image did not load within 20 seconds.")), 20_000);
      image.addEventListener("load", () => {
        window.clearTimeout(timeout);
        if (image.naturalWidth > 0) {
          resolve(undefined);
        } else {
          reject(new Error("Image loaded without dimensions."));
        }
      }, { once: true });
      image.addEventListener("error", () => {
        window.clearTimeout(timeout);
        reject(new Error("Image request failed."));
      }, { once: true });
    });
  }).catch((error) => {
    throw new Error(`${label} image was unavailable: ${error instanceof Error ? error.message : String(error)}`);
  });
}

async function waitForRemoteHistory(panel) {
  const loading = panel.getByRole("status").filter({ hasText: "Loading" });
  if (await loading.count()) {
    await loading.waitFor({ state: "hidden", timeout: 45_000 });
  }
  const error = panel.locator(".inline-error-state");
  if (await error.count()) {
    throw new Error(`Price history request failed: ${(await error.innerText()).trim()}`);
  }
}

async function clickDesktopNav(page, name) {
  const nav = page.locator("aside.sidebar");
  await nav.getByRole("button", { name, exact: name !== "Alerts" }).click();
}

function settingsPanel(page, heading) {
  return page.locator("section.tool-panel").filter({
    has: page.getByRole("heading", { name: heading, exact: true }),
  });
}

async function uniqueVisible(locator, label) {
  const matches = [];
  const count = await locator.count();
  for (let index = 0; index < count; index += 1) {
    const candidate = locator.nth(index);
    if (await candidate.isVisible()) matches.push(candidate);
  }
  assert.equal(matches.length, 1, `Expected exactly one visible ${label}, found ${matches.length}.`);
  return matches[0];
}

async function waitForInputValue(locator, expected, timeoutMs = 30_000) {
  await locator.waitFor();
  const deadline = Date.now() + timeoutMs;
  let value = await locator.inputValue();
  while (value !== expected && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    value = await locator.inputValue();
  }
  assert.equal(value, expected, `Expected input value ${expected} after data hydration.`);
}

async function assertServerBinderContains(page, expectedCollectionItemId) {
  assert.ok(expectedCollectionItemId, "No owned collection item ID was captured before binder verification.");
  const response = await browserJson(page, new URL("/api/binders", settings.baseUrl).href);
  assert.equal(response.status, 200, `Binder API returned ${response.status}.`);
  const binders = Array.isArray(response.body?.binders) ? response.body.binders : [];
  const defaults = binders.filter((binder) => binder?.isDefault === true);
  assert.equal(defaults.length, 1, `Expected exactly one default binder, found ${defaults.length}.`);
  const binder = defaults[0];
  const assignedSlots = Array.isArray(binder.pages)
    ? binder.pages.flatMap((pageData) => Array.isArray(pageData?.slots) ? pageData.slots : [])
      .filter((slot) => slot?.collectionItemId === expectedCollectionItemId)
    : [];
  assert.equal(
    assignedSlots.length,
    1,
    `Default binder persisted ${assignedSlots.length} slots for collection item ${expectedCollectionItemId}.`,
  );
  assert.equal(assignedSlots[0]?.copyIndex, 1, "Default binder did not persist copy 1 of the owned lot.");
  return binder;
}

async function assertNoVisibleBinderAlert(page, phase) {
  const alerts = page.locator(".binders-page [role='alert']:visible");
  const messages = await alerts.allInnerTexts();
  assert.deepEqual(messages, [], `Binder screen reported an error during ${phase}: ${messages.join(" | ")}`);
}

function binderRefreshButton(page) {
  return page.locator(".binders-page > .page-header").getByRole("button", { name: "Refresh", exact: true });
}

async function openBinderAndAssertCard(page, targetCard, binderName) {
  const shelf = page.locator('section[aria-label="Binder shelf"]');
  const covers = shelf.locator("button.binder-cover").filter({
    has: page.locator(".binder-cover-label strong").getByText(binderName, { exact: true }),
  });
  await covers.first().waitFor({ timeout: 45_000 });
  const cover = await uniqueVisible(covers, `${binderName} binder cover`);
  await cover.click();
  const dialog = page.getByRole("dialog", { name: `${binderName} binder`, exact: true });
  await dialog.waitFor({ timeout: 30_000 });
  const targetPockets = dialog.getByRole("button", { name: `Open ${targetCard.name}`, exact: true });
  await targetPockets.first().waitFor({ timeout: 30_000 });
  await uniqueVisible(targetPockets, `${targetCard.name} binder pocket`);
  assert.match(await dialog.innerText(), /Filled pockets\s+1/);
  assert.match(await dialog.innerText(), /Cards\s+1/);
}

async function serverBinderByName(page, binderName) {
  const response = await browserJson(page, new URL("/api/binders", settings.baseUrl).href);
  assert.equal(response.status, 200, `Binder API returned ${response.status}.`);
  const matches = Array.isArray(response.body?.binders)
    ? response.body.binders.filter((binder) => binder?.name === binderName)
    : [];
  assert.equal(matches.length, 1, `Expected one server binder named ${binderName}, found ${matches.length}.`);
  return matches[0];
}

function assertBinderItemAtSlot(binder, expectedCollectionItemId, expectedAbsoluteSlot) {
  const matches = (Array.isArray(binder?.pages) ? binder.pages : []).flatMap((pageData) =>
    (Array.isArray(pageData?.slots) ? pageData.slots : [])
      .filter((slot) => slot?.collectionItemId === expectedCollectionItemId)
      .map((slot) => ({
        absoluteSlot: Number(pageData.position) * 9 + Number(slot.position),
        copyIndex: slot.copyIndex,
      })),
  );
  assert.deepEqual(
    matches,
    [{ absoluteSlot: expectedAbsoluteSlot, copyIndex: 1 }],
    `Binder ${binder?.name ?? "unknown"} did not persist copy 1 at absolute slot ${expectedAbsoluteSlot}.`,
  );
}

async function downloadText(download) {
  return (await downloadBytes(download)).toString("utf8");
}

async function downloadBytes(download) {
  const failure = await download.failure();
  assert.equal(failure, null, `Browser download failed: ${failure}`);
  const path = await download.path();
  assert.ok(path, "Browser download did not expose a temporary path.");
  return readFile(path);
}

function findForbiddenKeys(value, path = "$", found = []) {
  if (!value || typeof value !== "object") return found;
  for (const [key, nested] of Object.entries(value)) {
    const nextPath = `${path}.${key}`;
    if (FORBIDDEN_EXPORT_KEYS.has(key)) found.push(nextPath);
    findForbiddenKeys(nested, nextPath, found);
  }
  return found;
}

async function assertNoHorizontalDocumentOverflow(page, screenName) {
  const result = await page.evaluate(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: window.innerWidth,
    offenders: [...document.querySelectorAll("body *")]
      .map((element) => {
        const rect = element.getBoundingClientRect();
        return {
          className: typeof element.className === "string" ? element.className.slice(0, 120) : "",
          left: Math.round(rect.left),
          right: Math.round(rect.right),
          tag: element.tagName.toLowerCase(),
          text: (element.textContent ?? "").replace(/\s+/g, " ").trim().slice(0, 100),
          width: Math.round(rect.width),
        };
      })
      .filter((entry) => entry.width > 0 && (entry.left < -1 || entry.right > window.innerWidth + 1))
      .sort((left, right) => right.right - left.right)
      .slice(0, 12),
  }));
  assert.ok(
    result.documentWidth <= result.viewportWidth + 1,
    `${screenName} overflowed the mobile viewport: ${JSON.stringify(result)}`,
  );
}

async function assertActionableWithinViewport(locator, label, viewportWidth) {
  const action = await uniqueVisible(locator, label);
  await action.click({ trial: true });
  const box = await action.boundingBox();
  assert.ok(box, `${label} did not expose a visible bounding box.`);
  assert.ok(box.x >= 0, `${label} started outside the viewport (${box.x}).`);
  assert.ok(
    box.x + box.width <= viewportWidth + 1,
    `${label} ended outside the ${viewportWidth}px viewport (${box.x + box.width}).`,
  );
}

function serializeError(error) {
  if (error instanceof Error) {
    return { message: error.message, name: error.name, stack: error.stack };
  }
  return { message: String(error), name: "Error" };
}

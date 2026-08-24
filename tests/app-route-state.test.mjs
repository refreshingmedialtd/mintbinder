import assert from "node:assert/strict";
import test from "node:test";

import {
  appRouteHistoryMode,
  buildAppRoutePath,
  parseAppRouteState,
} from "../src/lib/navigation/app-route-state.ts";

test("screen transitions add history while same-screen fallback corrections replace it", () => {
  const collection = {
    screen: "collection",
    selectedBinderId: "",
    selectedItemId: "",
    selectedSetId: "",
  };
  const item = { ...collection, screen: "item", selectedItemId: "item_1" };

  assert.equal(appRouteHistoryMode(collection, item), "pushState");
  assert.equal(appRouteHistoryMode(item, { ...item, selectedItemId: "fallback_item" }), "replaceState");
  assert.equal(appRouteHistoryMode(null, item, true), "replaceState");
});

test("item and set detail routes round-trip through durable query state", () => {
  const itemPath = buildAppRoutePath("/", "", {
    screen: "item",
    selectedBinderId: "",
    selectedItemId: "collection_item-42",
    selectedSetId: "",
  });
  assert.equal(itemPath, "/?view=item&item=collection_item-42");
  assert.deepEqual(parseAppRouteState(itemPath.split("?")[1]), {
    screen: "item",
    selectedBinderId: "",
    selectedItemId: "collection_item-42",
    selectedSetId: "",
  });

  const setPath = buildAppRoutePath("/", "", {
    screen: "setDetail",
    selectedBinderId: "",
    selectedItemId: "",
    selectedSetId: "sv3pt5",
  });
  assert.equal(setPath, "/?view=set&set=sv3pt5");
  assert.equal(parseAppRouteState("?view=set&set=sv3pt5").screen, "setDetail");
});

test("route writes preserve auth, billing, and unrelated query parameters", () => {
  const path = buildAppRoutePath(
    "/",
    "?callbackUrl=%2Faccount&billing=success&session_id=checkout_1&error=OAuthAccountNotLinked",
    {
      screen: "binders",
      selectedBinderId: "binder_12",
      selectedItemId: "",
      selectedSetId: "",
    },
    "#collection",
  );
  const url = new URL(path, "https://mintbinder.test");

  assert.equal(url.searchParams.get("callbackUrl"), "/account");
  assert.equal(url.searchParams.get("billing"), "success");
  assert.equal(url.searchParams.get("session_id"), "checkout_1");
  assert.equal(url.searchParams.get("error"), "OAuthAccountNotLinked");
  assert.equal(url.searchParams.get("view"), "binders");
  assert.equal(url.searchParams.get("binder"), "binder_12");
  assert.equal(url.hash, "#collection");
});

test("switching screens removes stale owned detail parameters only", () => {
  const path = buildAppRoutePath("/", "?view=item&item=item_1&set=stale&campaign=beta", {
    screen: "wishlist",
    selectedBinderId: "binder_1",
    selectedItemId: "item_1",
    selectedSetId: "set_1",
  });
  const url = new URL(path, "https://mintbinder.test");

  assert.equal(url.searchParams.get("view"), "wishlist");
  assert.equal(url.searchParams.get("item"), null);
  assert.equal(url.searchParams.get("set"), null);
  assert.equal(url.searchParams.get("binder"), null);
  assert.equal(url.searchParams.get("campaign"), "beta");
});

test("unknown screens and malformed identifiers fail closed to dashboard state", () => {
  assert.deepEqual(parseAppRouteState("?view=unknown&item=other"), {
    screen: "dashboard",
    selectedBinderId: "",
    selectedItemId: "",
    selectedSetId: "",
  });
  assert.equal(parseAppRouteState("?view=toString").screen, "dashboard");
  assert.equal(parseAppRouteState("?view=item&item=https%3A%2F%2Fevil.test").selectedItemId, "");
});

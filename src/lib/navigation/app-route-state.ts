import type { Screen } from "../types.ts";

export type AppRouteState = {
  screen: Screen;
  selectedBinderId: string;
  selectedItemId: string;
  selectedSetId: string;
};

export function appRouteHistoryMode(
  previous: AppRouteState | null,
  next: AppRouteState,
  isInitialSync = false,
) {
  return isInitialSync || previous?.screen === next.screen ? "replaceState" : "pushState";
}

const defaultRouteState: AppRouteState = {
  screen: "dashboard",
  selectedBinderId: "",
  selectedItemId: "",
  selectedSetId: "",
};

const screenToRoute = {
  add: "add",
  alerts: "alerts",
  analytics: "analytics",
  binders: "binders",
  collection: "collection",
  dashboard: "dashboard",
  item: "item",
  ops: "ops",
  setDetail: "set",
  sets: "sets",
  settings: "settings",
  wishlist: "wishlist",
} as const satisfies Record<Screen, string>;

const routeToScreen = new Map<string, Screen>(
  Object.entries(screenToRoute).map(([screen, route]) => [route, screen as Screen]),
);

const ownedQueryKeys = ["view", "item", "set", "binder"] as const;

function safeRouteIdentifier(value: string | null) {
  const trimmed = value?.trim() ?? "";
  return trimmed.length <= 120 && /^[a-zA-Z0-9_-]*$/.test(trimmed) ? trimmed : "";
}

export function parseAppRouteState(search: string): AppRouteState {
  const params = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  const route = params.get("view")?.trim() ?? "";
  const screen = routeToScreen.get(route) ?? "dashboard";

  return {
    ...defaultRouteState,
    screen,
    selectedBinderId: screen === "binders" ? safeRouteIdentifier(params.get("binder")) : "",
    selectedItemId: screen === "item" ? safeRouteIdentifier(params.get("item")) : "",
    selectedSetId: screen === "setDetail" ? safeRouteIdentifier(params.get("set")) : "",
  };
}

export function buildAppRoutePath(
  pathname: string,
  currentSearch: string,
  state: AppRouteState,
  hash = "",
) {
  const params = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);

  for (const key of ownedQueryKeys) {
    params.delete(key);
  }

  if (state.screen !== "dashboard") {
    params.set("view", screenToRoute[state.screen]);
  }

  if (state.screen === "item" && safeRouteIdentifier(state.selectedItemId)) {
    params.set("item", state.selectedItemId);
  } else if (state.screen === "setDetail" && safeRouteIdentifier(state.selectedSetId)) {
    params.set("set", state.selectedSetId);
  } else if (state.screen === "binders" && safeRouteIdentifier(state.selectedBinderId)) {
    params.set("binder", state.selectedBinderId);
  }

  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

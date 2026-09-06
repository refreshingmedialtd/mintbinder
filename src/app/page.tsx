"use client";

import {
  ArrowLeft,
  ArrowDownUp,
  ArrowRight,
  BarChart3,
  Bell,
  BookOpen,
  Boxes,
  ChartNoAxesCombined,
  Check,
  Copy,
  CreditCard,
  Database,
  Download,
  ExternalLink,
  GalleryVerticalEnd,
  Grid2X2,
  Heart,
  History,
  Info,
  Layers3,
  List,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Mail,
  Lock,
  Minus,
  Palette,
  Paintbrush,
  PackagePlus,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Target,
  TerminalSquare,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import Image from "next/image";
import Link from "next/link";
import dynamic from "next/dynamic";
import { signIn, signOut, useSession } from "next-auth/react";
import type {
  ChangeEvent,
  CSSProperties,
  Dispatch,
  FormEvent,
  PointerEvent as ReactPointerEvent,
  ReactNode,
  SetStateAction,
} from "react";
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { APP_UPDATE_RELOAD_GUARD_EVENT } from "./service-worker-registration";
import { canUseOperationsForUser, normalizeAppRole, type AppUserRole } from "@/lib/auth/roles";
import {
  catalogueValueMinorForVariant,
  catalogueVariantSelectionLabel,
  catalogueVariantLabels,
  normalizeVariantLabel,
} from "@/lib/catalogue/variants";
import {
  catalogueNameAliasesForText,
} from "@/lib/catalogue/name-aliases";
import { isOptimizableCatalogueImageUrl } from "@/lib/catalogue/image-url";
import { catalogueItemImageCandidates } from "@/lib/catalogue/card-images";
import { catalogueVariantPriceRows } from "@/lib/catalogue/variant-price-rows";
import { CATALOGUE_LANGUAGE_OPTIONS, LOT_LANGUAGE_OPTIONS } from "@/lib/catalogue/languages";
import { chunkCatalogueLookupIds } from "@/lib/catalogue/lookup";
import {
  buildCollectionCsv,
  buildCollectionImportTemplateCsv,
  inspectCollectionImportCsv,
  type CollectionImportRow,
} from "@/lib/csv";
import { completionPercent, formatMoney } from "@/lib/format";
import { priceConfidenceFromScore, priceRangeMinor } from "@/lib/pricing/price-history";
import {
  groupPriceHistorySeries,
  preferredPriceHistorySeriesKey,
} from "@/lib/pricing/price-history-series";
import {
  effectivePriceConfidence,
  preferredLatestPricePoint,
  priceFreshnessStatus,
  priceMarketForSource,
  priceMarketRole,
  priceSourceLabel,
} from "@/lib/pricing/market-context";
import { buildInsuranceReportHtml } from "@/lib/reports/insurance";
import {
  appendBinderEntriesToBlankSlots,
  BINDER_SYNC_TIMEOUT_MS,
  binderOccupiedCopiesValueMinor,
  shouldCompleteMigratedDefaultBinder,
  shouldShowCollectionBinderFallback,
} from "@/lib/binders/client-state";
import {
  hasManagedDefaultBinderMarker,
  unassignedBinderCopyIndexes,
  unassignedBinderEntries,
  visibleBinderDescription,
} from "@/lib/binders/migration-state";
import {
  MAX_MANAGED_BINDER_PAGES,
  MAX_STANDARD_BINDER_PAGES,
} from "@/lib/binders/layout";
import {
  collectionConditionMultiplier,
  effectiveCollectionVariant,
  collectionItemMarketPricePoint,
  collectionItemPriceHistory,
  collectionItemValuation,
  collectionItemValueMinor,
} from "@/lib/valuation";
import {
  wishlistMatchesOwnedVariant,
  wishlistVariantSelectionLabel,
} from "@/lib/wishlist-variant";
import {
  appRouteHistoryMode,
  buildAppRoutePath,
  parseAppRouteState,
  type AppRouteState,
} from "@/lib/navigation/app-route-state";
import {
  buildCollectionIntelligence,
  type CollectionIntelligence,
  type HoldingInsight,
  type InsightAction,
} from "@/lib/insights";
import { sampleAppData } from "@/lib/sample-data";
import type {
  AppCatalogueData,
  AppCatalogueSearchData,
  AppData,
  AppDashboardData,
  AppDataSource,
  AppSubscription,
  ActiveSetGoal,
  CatalogueItem,
  CollectionEvent,
  CollectionItem,
  ItemType,
  NotificationPreferences,
  Screen,
  SetGoalResponse,
  SetGoalWishlistBulkResult,
  SetProgress,
  StorageLocation,
  WishlistItem,
} from "@/lib/types";

const LazyOperationsScreen = dynamic(
  () => import("@/components/operations-screen").then((module) => module.OperationsScreen),
  {
    loading: () => (
      <section aria-busy="true" aria-live="polite" className="page">
        <div className="empty-state compact">
          <strong>Loading operations</strong>
          <span>Preparing the administration tools.</span>
        </div>
      </section>
    ),
  },
);

const developmentSamplePreviewEnabled =
  process.env.NODE_ENV === "development" &&
  process.env.NEXT_PUBLIC_MINTBINDER_ENABLE_DEV_SAMPLE_FALLBACK === "true";

type AppState = {
  screen: Screen;
  addType: ItemType;
  collectionFilter: "all" | ItemType | "graded" | "unknown";
  collectionSetFilter: string;
  collectionConditionFilter: string;
  collectionLanguageFilter: string;
  collectionLocationFilter: string;
  collectionValueFilter: "all" | "profit" | "loss" | "unvalued" | "manual" | "weak" | "high";
  collectionSort:
    | "value-desc"
    | "value-asc"
    | "name"
    | "name-desc"
    | "set"
    | "set-desc"
    | "gain-desc"
    | "quantity-desc"
    | "recent";
  collectionView: "list" | "grid";
  wishlistView: "list" | "grid";
  setFilter: "all" | "owned" | "missing" | "want";
  selectedBinderId: string;
  selectedItemId: string;
  selectedSetId: string;
  selectedCatalogueId: string;
  selectedCatalogueVariant: string;
  plus: boolean;
};

type Viewer = {
  name: string;
  email: string;
  emailVerified: boolean;
  role: AppUserRole;
};

type AuthMode = "sign-in" | "register";
type ToastTone = "error" | "success" | "warning";
type ToastMessage = {
  message: string;
  tone: ToastTone;
};
type CollectionImportPreviewRow = {
  catalogueId: string;
  errors: string[];
  itemName?: string;
  rowNumber: number;
};
type CollectionImportPreview = {
  importableCount: number;
  rows: CollectionImportPreviewRow[];
  skippedCount: number;
  totalCount: number;
};
type CollectionImportResult = {
  failed: number;
  imported: number;
  skipped: number;
};
type DetailedPricePoint = NonNullable<CatalogueItem["priceHistory"]>[number] & {
  bucket?: string;
  currency?: string;
  pointCount?: number;
  sampleSize?: number | null;
};
type CatalogueSort =
  | "set-number"
  | "set-number-asc"
  | "set-number-desc"
  | "value-desc"
  | "value-asc"
  | "name"
  | "name-asc"
  | "name-desc"
  | "rarity";
type SetDetailSort =
  | "number"
  | "number-asc"
  | "number-desc"
  | "value-desc"
  | "value-asc"
  | "name"
  | "name-asc"
  | "name-desc"
  | "rarity";
type SetListSort =
  | "release-desc"
  | "release-asc"
  | "name-asc"
  | "name-desc"
  | "completion-desc"
  | "completion-asc";
type WishlistSort =
  | "priority-desc"
  | "target-desc"
  | "target-asc"
  | "market-desc"
  | "market-asc"
  | "set-number-asc"
  | "set-number-desc"
  | "name-asc"
  | "name-desc";
type SetOptionGroup = {
  label: string;
  options: Array<{
    displayName?: string;
    name: string;
    releaseDate?: string;
  }>;
};
type ThemeId =
  | "light"
  | "dark"
  | "league"
  | "forest"
  | "ocean"
  | "ember"
  | "electric"
  | "psychic"
  | "fairy"
  | "dragon"
  | "steel"
  | "ghost"
  | "meadow"
  | "sunset";

type BinderArtworkId = "mint" | "vault" | "sunburst" | "ocean" | "rose" | "midnight";
type BinderInteriorId = "classic" | "graphite" | "felt" | "cream" | "crimson" | "carbon";
type BinderVisibility = "private" | "unlisted";

type BinderSlotRecord = {
  collectionItemId: string | null;
  copyIndex: number | null;
  id?: string;
  note?: string | null;
  position: number;
};

type BinderPageRecord = {
  id?: string;
  position: number;
  slots: BinderSlotRecord[];
};

type CustomBinder = {
  artworkId: BinderArtworkId;
  coverStyle: string;
  createdAt: string;
  description: string;
  id: string;
  interiorId: BinderInteriorId;
  isDefault: boolean;
  legacyMigrationPending?: boolean;
  legacySource?: string;
  managedDefault?: boolean;
  name: string;
  pages: BinderPageRecord[];
  shareSlug?: string;
  updatedAt: string;
  visibility: BinderVisibility;
};

type LegacyStoredBinder = {
  artworkId: BinderArtworkId;
  createdAt: string;
  id: string;
  interiorId: BinderInteriorId;
  itemIds: string[];
  name: string;
};

type DefaultBinderSettings = {
  artworkId: BinderArtworkId;
  interiorId: BinderInteriorId;
  itemIds: string[];
};

type BinderSummary = {
  artworkId: BinderArtworkId;
  description: string;
  id: string;
  interiorId: BinderInteriorId;
  isDefault?: boolean;
  items: CollectionItem[];
  name: string;
  pages: BinderPageRecord[];
  shareSlug?: string;
  slots: Array<BinderSlotRecord & { item?: CollectionItem }>;
  visibility: BinderVisibility;
};


type ThemeOption = {
  access: "free" | "plus";
  description: string;
  id: ThemeId;
  name: string;
  swatches: [string, string, string];
};

const initialState: AppState = {
  screen: "dashboard",
  addType: "card",
  collectionFilter: "all",
  collectionSetFilter: "all",
  collectionConditionFilter: "all",
  collectionLanguageFilter: "all",
  collectionLocationFilter: "all",
  collectionValueFilter: "all",
  collectionSort: "value-desc",
  collectionView: "list",
  wishlistView: "list",
  setFilter: "all",
  selectedBinderId: "all-collection",
  selectedItemId: "",
  selectedSetId: "",
  selectedCatalogueId: "",
  selectedCatalogueVariant: "",
  plus: false,
};

const emptySubscription: AppSubscription = {
  cancelAtPeriodEnd: false,
  plan: "free",
  entitlements: {
    "billing.portal": false,
    "exports.insurance_report": false,
    "pricing.alerts": false,
  },
};

const emptyNotificationPreferences: NotificationPreferences = {
  digestFrequency: "Off",
  priceAlertsEnabled: false,
  weakPriceAlertsEnabled: false,
  wishlistTargetAlertsEnabled: false,
};

const storageTypes: StorageLocation["type"][] = ["Binder", "Box", "Display", "Safe", "Other"];
const sealedProductTypes = [
  "Booster box",
  "Booster pack",
  "Elite trainer box",
  "Collection box",
  "Tin",
  "Blister",
  "Deck",
  "Case",
  "Other",
];
const betaSetupDismissedStorageKey = "mintbinder-beta-setup-dismissed";
const themeStorageKey = "mintbinder-theme";
const defaultBinderId = "all-collection";
const binderStoragePrefix = "mintbinder-binders";
const defaultBinderSettingsStoragePrefix = "mintbinder-default-binder";
const binderMigrationStoragePrefix = "mintbinder-server-binder-migration-v1";
const defaultBinderSettingsFallback: DefaultBinderSettings = {
  artworkId: "mint",
  interiorId: "classic",
  itemIds: [],
};
const binderArtworkOptions: Array<{
  accent: string;
  description: string;
  id: BinderArtworkId;
  name: string;
  spine: string;
  surface: string;
}> = [
  {
    accent: "#38d7c5",
    description: "Clean mint cover with sharp collector lines.",
    id: "mint",
    name: "Mint League",
    spine: "#0f766e",
    surface: "#dffcf6",
  },
  {
    accent: "#f59e0b",
    description: "Dark vault cover for high-value showcases.",
    id: "vault",
    name: "Vault Black",
    spine: "#0f172a",
    surface: "#1f2937",
  },
  {
    accent: "#f43f5e",
    description: "Warm, bright binder for chase-card pages.",
    id: "sunburst",
    name: "Sunburst",
    spine: "#fb923c",
    surface: "#fff7ed",
  },
  {
    accent: "#60a5fa",
    description: "Cool blue cover for water-heavy sets.",
    id: "ocean",
    name: "Ocean Foil",
    spine: "#1d4ed8",
    surface: "#dbeafe",
  },
  {
    accent: "#fb7185",
    description: "Soft rose binder for display pages.",
    id: "rose",
    name: "Rose Gallery",
    spine: "#be123c",
    surface: "#ffe4e6",
  },
  {
    accent: "#a78bfa",
    description: "Night cover with purple foil details.",
    id: "midnight",
    name: "Midnight Holo",
    spine: "#312e81",
    surface: "#111827",
  },
];
const binderInteriorOptions: Array<{
  id: BinderInteriorId;
  name: string;
  page: string;
  pocket: string;
  ring: string;
  stitch: string;
  surface: string;
}> = [
  {
    id: "classic",
    name: "Classic vinyl",
    page: "#f8fbff",
    pocket: "rgba(255, 255, 255, 0.74)",
    ring: "#cbd5e1",
    stitch: "#cbd5e1",
    surface: "#172033",
  },
  {
    id: "graphite",
    name: "Graphite",
    page: "#1f2937",
    pocket: "rgba(15, 23, 42, 0.62)",
    ring: "#94a3b8",
    stitch: "#475569",
    surface: "#111827",
  },
  {
    id: "felt",
    name: "Green felt",
    page: "#e7f8ee",
    pocket: "rgba(255, 255, 255, 0.7)",
    ring: "#94a3b8",
    stitch: "#86efac",
    surface: "#14532d",
  },
  {
    id: "cream",
    name: "Archive cream",
    page: "#fff7ed",
    pocket: "rgba(255, 251, 235, 0.78)",
    ring: "#c4a484",
    stitch: "#fed7aa",
    surface: "#7c2d12",
  },
  {
    id: "crimson",
    name: "Crimson",
    page: "#fff1f2",
    pocket: "rgba(255, 255, 255, 0.72)",
    ring: "#fda4af",
    stitch: "#fb7185",
    surface: "#881337",
  },
  {
    id: "carbon",
    name: "Carbon weave",
    page: "#0f172a",
    pocket: "rgba(30, 41, 59, 0.72)",
    ring: "#64748b",
    stitch: "#334155",
    surface: "#020617",
  },
];
const themeOptions: ThemeOption[] = [
  {
    access: "free",
    description: "Dark navy workspace with violet and cyan market accents.",
    id: "light",
    name: "Pulse",
    swatches: ["#111b27", "#8b5cf6", "#22d3ee"],
  },
  {
    access: "free",
    description: "Near-black trading desk with cool blue signals.",
    id: "dark",
    name: "Graphite",
    swatches: ["#090f19", "#38bdf8", "#fb7185"],
  },
  {
    access: "plus",
    description: "Deep tournament red with gold highlights.",
    id: "league",
    name: "League Noir",
    swatches: ["#1b1628", "#ef4444", "#f59e0b"],
  },
  {
    access: "plus",
    description: "Mint-green analytics on a calm dark base.",
    id: "forest",
    name: "Viridian",
    swatches: ["#0f2a22", "#10b981", "#84cc16"],
  },
  {
    access: "plus",
    description: "Blue and aqua for sealed-product shelves.",
    id: "ocean",
    name: "Tidal",
    swatches: ["#10243a", "#0ea5e9", "#22d3ee"],
  },
  {
    access: "plus",
    description: "Warm orange and rose for chase-card energy.",
    id: "ember",
    name: "Ember Vault",
    swatches: ["#2a1713", "#f97316", "#f43f5e"],
  },
  {
    access: "plus",
    description: "High-contrast yellow with blue scan accents.",
    id: "electric",
    name: "Volt",
    swatches: ["#22230d", "#eab308", "#38bdf8"],
  },
  {
    access: "plus",
    description: "Violet and pink for vivid analytics sessions.",
    id: "psychic",
    name: "Psychic Glow",
    swatches: ["#211535", "#a855f7", "#ec4899"],
  },
  {
    access: "plus",
    description: "Rose and sky accents on a richer dark shell.",
    id: "fairy",
    name: "Fairy Flux",
    swatches: ["#2c1830", "#f472b6", "#38bdf8"],
  },
  {
    access: "plus",
    description: "Inky navy with red and gold highlights.",
    id: "dragon",
    name: "Dragon Vault",
    swatches: ["#111827", "#ef4444", "#f59e0b"],
  },
  {
    access: "plus",
    description: "Crisp steel grey with blue-green controls.",
    id: "steel",
    name: "Titanium",
    swatches: ["#171d26", "#94a3b8", "#2dd4bf"],
  },
  {
    access: "plus",
    description: "Dark violet and mint for night-time collection review.",
    id: "ghost",
    name: "Ghost Night",
    swatches: ["#171326", "#8b5cf6", "#2dd4bf"],
  },
  {
    access: "plus",
    description: "Fresh green and sky tones for relaxed cataloguing.",
    id: "meadow",
    name: "Meadow Glass",
    swatches: ["#172719", "#22c55e", "#38bdf8"],
  },
  {
    access: "plus",
    description: "Warm rose and amber for a showcase look.",
    id: "sunset",
    name: "Sunset Signal",
    swatches: ["#2b1924", "#fb7185", "#f59e0b"],
  },
];
const freeThemeIds = new Set<ThemeId>(["light", "dark"]);

export default function Home() {
  const { data: session, status } = useSession();
  const [appState, setAppState] = useState(initialState);
  const [isAppRouteHydrated, setIsAppRouteHydrated] = useState(false);
  const [catalogueItems, setCatalogueItems] = useState<CatalogueItem[]>([]);
  const [catalogueComplete, setCatalogueComplete] = useState(false);
  const [loadedCatalogueSetNames, setLoadedCatalogueSetNames] = useState<string[]>([]);
  const [collection, setCollection] = useState<CollectionItem[]>([]);
  const [wishlist, setWishlist] = useState<WishlistItem[]>([]);
  const [sets, setSets] = useState<SetProgress[]>([]);
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>([]);
  const [collectionEvents, setCollectionEvents] = useState<CollectionEvent[]>([]);
  const [notificationPreferences, setNotificationPreferences] =
    useState<NotificationPreferences>(emptyNotificationPreferences);
  const [subscription, setSubscription] = useState<AppSubscription>(emptySubscription);
  const [dataSource, setDataSource] = useState<AppDataSource>("database");
  const [dataNotice, setDataNotice] = useState("");
  const [themeId, setThemeId] = useState<ThemeId>("light");
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [isLoadingCatalogue, setIsLoadingCatalogue] = useState(false);
  const [toast, setToast] = useState<ToastMessage | null>(null);
  const [authMode, setAuthMode] = useState<AuthMode>("sign-in");
  const [signInEmail, setSignInEmail] = useState("");
  const [signInName, setSignInName] = useState("");
  const [signInPassword, setSignInPassword] = useState("");
  const [signInPasswordConfirmation, setSignInPasswordConfirmation] = useState("");
  const [signInError, setSignInError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [collectionSearch, setCollectionSearch] = useState("");
  const [addSearch, setAddSearch] = useState("");
  const [setSearch, setSetSearch] = useState("");
  const [plusPreviewOverride, setPlusPreviewOverride] = useState<boolean | null>(null);
  const [activeSetGoal, setActiveSetGoal] = useState<ActiveSetGoal | null>(null);
  const [isLoadingSetGoal, setIsLoadingSetGoal] = useState(false);
  const [activeSetGoalNotice, setActiveSetGoalNotice] = useState("");
  const [customBinders, setCustomBinders] = useState<CustomBinder[]>([]);
  const [isLoadingBinders, setIsLoadingBinders] = useState(false);
  const [binderNotice, setBinderNotice] = useState("");
  const [binderRetryNonce, setBinderRetryNonce] = useState(0);
  const [binderDraftProtected, setBinderDraftProtected] = useState(false);
  const toastTimeoutRef = useRef<number | null>(null);
  const binderDraftProtectionRef = useRef(false);
  const binderDraftSnapshotRef = useRef<CustomBinder[] | null>(null);
  const binderMutationInFlightRef = useRef(false);
  const binderLoadKeyRef = useRef("");
  const binderReloadFeedbackRef = useRef<"quiet" | "visible" | null>(null);
  const binderSyncControllerRef = useRef<AbortController | null>(null);
  const binderSyncTaskRef = useRef<Promise<void> | null>(null);
  const canLeaveBinderWorkspaceRef = useRef<(reason?: "navigation" | "app-update") => boolean>(() => true);
  const isInitialAppRouteSyncRef = useRef(true);
  const previousAppRouteStateRef = useRef<AppRouteState | null>(null);

  const showToast = useCallback((message: string, tone: ToastTone = "success") => {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
    }

    setToast({ message, tone });
    toastTimeoutRef.current = window.setTimeout(() => {
      setToast(null);
      toastTimeoutRef.current = null;
    }, tone === "error" ? 5200 : 3200);
  }, []);

  useEffect(() => () => {
    if (toastTimeoutRef.current !== null) {
      window.clearTimeout(toastTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    const applyBrowserRoute = () => {
      const route = parseAppRouteState(window.location.search);
      const currentRoute = previousAppRouteStateRef.current;

      if (
        currentRoute &&
        route.screen !== currentRoute.screen &&
        !canLeaveBinderWorkspaceRef.current()
      ) {
        const currentHistoryState =
          window.history.state && typeof window.history.state === "object" ? window.history.state : {};
        const restoredPath = buildAppRoutePath(
          window.location.pathname,
          window.location.search,
          currentRoute,
          window.location.hash,
        );
        window.history.pushState({ ...currentHistoryState, mintBinderRoute: true }, "", restoredPath);
        return;
      }

      setAppState((current) => ({ ...current, ...route }));
    };

    applyBrowserRoute();
    setIsAppRouteHydrated(true);
    window.addEventListener("popstate", applyBrowserRoute);
    return () => window.removeEventListener("popstate", applyBrowserRoute);
  }, []);

  useEffect(() => {
    function warnAboutPendingBinderChanges(event: BeforeUnloadEvent) {
      if (!binderDraftProtectionRef.current && !binderMutationInFlightRef.current) {
        return;
      }

      event.preventDefault();
      event.returnValue = "";
    }

    window.addEventListener("beforeunload", warnAboutPendingBinderChanges);
    return () => window.removeEventListener("beforeunload", warnAboutPendingBinderChanges);
  }, []);

  useEffect(() => {
    function protectBinderDraftDuringAppUpdate(event: Event) {
      if (!canLeaveBinderWorkspaceRef.current("app-update")) {
        event.preventDefault();
      }
    }

    window.addEventListener(APP_UPDATE_RELOAD_GUARD_EVENT, protectBinderDraftDuringAppUpdate);
    return () => window.removeEventListener(APP_UPDATE_RELOAD_GUARD_EVENT, protectBinderDraftDuringAppUpdate);
  }, []);

  useEffect(() => {
    if (!isAppRouteHydrated) {
      return;
    }

    const routeState: AppRouteState = {
      screen: appState.screen,
      selectedBinderId: appState.selectedBinderId,
      selectedItemId: appState.selectedItemId,
      selectedSetId: appState.selectedSetId,
    };
    const nextPath = buildAppRoutePath(
      window.location.pathname,
      window.location.search,
      routeState,
      window.location.hash,
    );
    const currentPath = `${window.location.pathname}${window.location.search}${window.location.hash}`;

    if (nextPath !== currentPath) {
      const currentHistoryState =
        window.history.state && typeof window.history.state === "object" ? window.history.state : {};
      const method = appRouteHistoryMode(
        previousAppRouteStateRef.current,
        routeState,
        isInitialAppRouteSyncRef.current,
      );
      window.history[method]({ ...currentHistoryState, mintBinderRoute: true }, "", nextPath);
    }

    previousAppRouteStateRef.current = routeState;
    isInitialAppRouteSyncRef.current = false;
  }, [
    appState.screen,
    appState.selectedBinderId,
    appState.selectedItemId,
    appState.selectedSetId,
    isAppRouteHydrated,
  ]);

  const reloadActiveSetGoal = useCallback(async (options?: { quiet?: boolean }) => {
    setIsLoadingSetGoal(true);
    try {
      const response = await fetch("/api/set-goal", { cache: "no-store" });
      const body = (await response.json().catch(() => ({}))) as SetGoalResponse & { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Set goal load failed with ${response.status}.`);
      setActiveSetGoal(body.goal ?? null);
      setActiveSetGoalNotice("");
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : "The active set goal could not be loaded.";
      setActiveSetGoalNotice(message);
      if (!options?.quiet) showToast(message, "error");
      return false;
    } finally {
      setIsLoadingSetGoal(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (status !== "authenticated") {
      setActiveSetGoal(null);
      setActiveSetGoalNotice("");
      return;
    }

    void reloadActiveSetGoal({ quiet: true });
  }, [reloadActiveSetGoal, status]);

  const catalogueById = useMemo(() => {
    return new Map(catalogueItems.map((item) => [item.id, item]));
  }, [catalogueItems]);
  const binderCardCollection = useMemo(
    () => collection.filter((item) => catalogueById.get(item.catalogueId)?.type === "card"),
    [catalogueById, collection],
  );
  const activeCardLotSignature = useMemo(
    () => binderCardCollection.map((item) => `${item.id}:${item.quantity}`).sort().join("|"),
    [binderCardCollection],
  );
  const binderCardCollectionRef = useRef(binderCardCollection);
  binderCardCollectionRef.current = binderCardCollection;

  const viewer: Viewer = {
    name: session?.user?.name || "Collector",
    email: session?.user?.email || "",
    emailVerified: session?.user?.isEmailVerified === true,
    role: normalizeAppRole(session?.user?.role),
  };
  const operationsEnabled = canUseOperationsForUser(viewer.role);
  const canPreviewPlan = operationsEnabled;
  const effectivePlus = canPreviewPlan && plusPreviewOverride !== null
    ? plusPreviewOverride
    : appState.plus;
  const effectiveAppState = useMemo(
    () => (effectivePlus === appState.plus ? appState : { ...appState, plus: effectivePlus }),
    [appState, effectivePlus],
  );

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(themeStorageKey);

    if (isThemeId(storedTheme)) {
      setThemeId(storedTheme);
    }
  }, []);

  useEffect(() => {
    window.scrollTo({ left: 0, top: 0, behavior: "auto" });
  }, [appState.screen, appState.selectedItemId, appState.selectedSetId]);

  useEffect(() => {
    if (!isThemeAllowed(themeId, effectivePlus)) {
      setThemeId("light");
      return;
    }

    document.documentElement.dataset.theme = themeId;
    window.localStorage.setItem(themeStorageKey, themeId);
  }, [effectivePlus, themeId]);

  const reloadBinders = useCallback((options?: { quiet?: boolean }) => {
    binderReloadFeedbackRef.current = options?.quiet ? "quiet" : "visible";
    binderLoadKeyRef.current = "";
    setBinderNotice("");
    setIsLoadingBinders(true);
    setBinderRetryNonce((current) => current + 1);
  }, []);

  const beginBinderDraft = useCallback((snapshot: CustomBinder[]) => {
    if (!binderDraftProtectionRef.current) {
      binderDraftSnapshotRef.current = snapshot.map((binder) => ({
        ...binder,
        pages: cloneBinderPages(binder.pages),
      }));
    }
    binderDraftProtectionRef.current = true;
    setBinderDraftProtected(true);
    binderSyncControllerRef.current?.abort();
  }, []);

  const clearBinderDraftProtection = useCallback(() => {
    binderDraftProtectionRef.current = false;
    binderDraftSnapshotRef.current = null;
    setBinderDraftProtected(false);
  }, []);

  const discardBinderDraft = useCallback(() => {
    const snapshot = binderDraftSnapshotRef.current;
    if (snapshot) {
      const pagesByBinderId = new Map(snapshot.map((binder) => [binder.id, binder.pages]));
      setCustomBinders((current) => current.map((binder) => {
        const pages = pagesByBinderId.get(binder.id);
        return pages ? { ...binder, pages: cloneBinderPages(pages) } : binder;
      }));
    }
    clearBinderDraftProtection();
    reloadBinders({ quiet: true });
  }, [clearBinderDraftProtection, reloadBinders]);

  const setBinderMutationInFlight = useCallback((inFlight: boolean) => {
    binderMutationInFlightRef.current = inFlight;
  }, []);

  useEffect(() => {
    if (status !== "authenticated") {
      binderDraftProtectionRef.current = false;
      binderDraftSnapshotRef.current = null;
      binderMutationInFlightRef.current = false;
      binderSyncControllerRef.current?.abort();
      binderLoadKeyRef.current = "";
      binderReloadFeedbackRef.current = null;
      setBinderDraftProtected(false);
      setCustomBinders([]);
      setBinderNotice("");
      setIsLoadingBinders(false);
      return;
    }

    if (isLoadingData) {
      return;
    }

    const cardCollection = binderCardCollectionRef.current;
    const hasCardCollection = cardCollection.length > 0;
    const loadKey = `${viewer.email.trim().toLowerCase()}:${activeCardLotSignature || "empty"}`;

    if (binderDraftProtectionRef.current) {
      binderLoadKeyRef.current = "";
      setBinderNotice("Binder refresh is paused while you have unsaved layout changes.");
      setIsLoadingBinders(false);
      return;
    }

    if (binderLoadKeyRef.current === loadKey) {
      return;
    }

    binderLoadKeyRef.current = loadKey;
    let cancelled = false;
    const syncController = new AbortController();
    binderSyncControllerRef.current = syncController;
    const previousSyncTask = binderSyncTaskRef.current;

    async function loadAndMigrateBinders() {
      setIsLoadingBinders(true);
      setBinderNotice("");

      if (previousSyncTask) {
        await previousSyncTask.catch(() => undefined);
      }
      if (cancelled) return;

      try {
        const legacyBinders = readStoredBinders(binderStorageKey(viewer.email));
        const legacyDefault = readStoredDefaultBinderSettings(defaultBinderSettingsStorageKey(viewer.email));
        const migrationKey = binderMigrationStorageKey(viewer.email);
        const migrationPending = window.localStorage.getItem(migrationKey) !== "1";
        let binders = await fetchServerBinders(syncController.signal);
        const pendingDefaultNeedsCompletion = shouldCompleteMigratedDefaultBinder(
          binders,
          cardCollection.length,
        );

        if (
          pendingDefaultNeedsCompletion ||
          (migrationPending && (legacyBinders.length || legacyDefault.itemIds.length || (!binders.length && hasCardCollection)))
        ) {
          const migration = await migrateLegacyBinders({
            binders,
            collection: cardCollection,
            legacyBinders: migrationPending || pendingDefaultNeedsCompletion ? legacyBinders : [],
            legacyDefault,
            signal: syncController.signal,
          });
          binders = migration.binders;

          if (migration.complete) {
            window.localStorage.setItem(migrationKey, "1");
          }

          if (!cancelled && migration.migratedCount) {
            showToast(`${migration.migratedCount} local binder${migration.migratedCount === 1 ? "" : "s"} moved to secure cross-device storage.`);
          }
        }

        binders = await syncManagedDefaultBinder(binders, cardCollection);

        if (!cancelled && !binderDraftProtectionRef.current) {
          setCustomBinders(binders);
          if (binderReloadFeedbackRef.current === "visible") {
            showToast("Binders refreshed across devices.");
          }
          binderReloadFeedbackRef.current = null;
        } else if (!cancelled) {
          binderLoadKeyRef.current = "";
          setBinderNotice("Binder refresh is paused while you have unsaved layout changes.");
        }
      } catch (error) {
        if (!(syncController.signal.aborted && binderDraftProtectionRef.current)) {
          console.warn("Unable to load or migrate binders.", error);
        }

        if (!cancelled) {
          const message = syncController.signal.aborted && binderDraftProtectionRef.current
            ? "Binder refresh is paused while you have unsaved layout changes."
            : error instanceof Error
              ? error.message
              : "Binders could not be loaded.";
          binderLoadKeyRef.current = "";
          setBinderNotice(message);
          if (binderReloadFeedbackRef.current === "visible") {
            showToast(message, "error");
          }
          binderReloadFeedbackRef.current = null;
        }
      } finally {
        if (binderSyncControllerRef.current === syncController) {
          binderSyncControllerRef.current = null;
        }
      }
    }

    const syncTask = loadAndMigrateBinders();
    binderSyncTaskRef.current = syncTask;
    void syncTask.finally(() => {
      if (binderSyncTaskRef.current === syncTask) {
        binderSyncTaskRef.current = null;
        setIsLoadingBinders(false);
      }
    });
    return () => {
      cancelled = true;
      syncController.abort();
      if (binderSyncControllerRef.current === syncController) {
        binderSyncControllerRef.current = null;
      }
      if (binderLoadKeyRef.current === loadKey) {
        binderLoadKeyRef.current = "";
      }
    };
  }, [activeCardLotSignature, binderRetryNonce, isLoadingData, showToast, status, viewer.email]);

  const applyAppData = useCallback((data: AppData) => {
    setCatalogueItems((current) =>
      data.catalogueComplete === false ? mergeCatalogueItems(current, data.catalogue) : data.catalogue,
    );
    setCatalogueComplete((current) => (data.catalogueComplete === false ? current : true));
    setCollection(data.collection);
    setWishlist(data.wishlist);
    setSets(data.sets);
    setStorageLocations(data.storageLocations);
    setCollectionEvents(data.events);
    setNotificationPreferences(data.notificationPreferences);
    setSubscription(data.subscription);
    setDataSource(data.source);
    setDataNotice(data.notice ?? "");
    setAppState((current) => ({
      ...current,
      plus: data.subscription.plan === "plus",
      selectedItemId: data.collection.some((item) => item.id === current.selectedItemId)
        ? current.selectedItemId
        : data.collection[0]?.id ?? "",
      selectedCatalogueId:
        data.catalogueComplete === false
          ? current.selectedCatalogueId
          : data.catalogue.some((item) => item.id === current.selectedCatalogueId)
            ? current.selectedCatalogueId
            : "",
      selectedSetId: data.sets.some((set) => set.id === current.selectedSetId)
        ? current.selectedSetId
        : data.sets[0]?.id ?? "",
    }));
  }, []);

  const applyEmptyAppData = useCallback((notice: string) => {
    setCatalogueItems([]);
    setCatalogueComplete(false);
    setLoadedCatalogueSetNames([]);
    setCollection([]);
    setWishlist([]);
    setSets([]);
    setStorageLocations([]);
    setCollectionEvents([]);
    setNotificationPreferences(emptyNotificationPreferences);
    setSubscription(emptySubscription);
    setDataSource("database");
    setDataNotice(notice);
    setAppState((current) => ({
      ...current,
      plus: false,
      selectedCatalogueId: "",
      selectedCatalogueVariant: "",
      selectedItemId: "",
      selectedSetId: "",
    }));
  }, []);

  const refreshAppData = useCallback(
    async (options?: { quiet?: boolean; isCancelled?: () => boolean }) => {
      if (!options?.quiet && !options?.isCancelled?.()) {
        setIsLoadingData(true);
      }

      try {
        const response = await fetch("/api/dashboard", { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`App data request failed with ${response.status}`);
        }

        const data = (await response.json()) as AppDashboardData;

        if (options?.isCancelled?.()) {
          return false;
        }

        applyAppData(data);
        return true;
      } catch (error) {
        console.warn("App data API load failed.", error);
        if (!options?.isCancelled?.()) {
          applyEmptyAppData("Could not load your Mint Binder data yet. Refresh the page or try again shortly.");
        }
        return false;
      } finally {
        if (!options?.quiet && !options?.isCancelled?.()) {
          setIsLoadingData(false);
        }
      }
    },
    [applyAppData, applyEmptyAppData],
  );

  const loadCatalogueItemsByIds = useCallback(
    async (ids: string[], options?: { quiet?: boolean }) => {
      const requestedIds = Array.from(new Set(ids.map((id) => id.trim()).filter(Boolean)));
      const catalogueById = new Map(catalogueItems.map((item) => [item.id, item]));
      const missingIds = requestedIds.filter((id) => !catalogueById.has(id));

      if (!missingIds.length || dataSource !== "database") {
        return requestedIds.flatMap((id) => {
          const item = catalogueById.get(id);
          return item ? [item] : [];
        });
      }

      try {
        const loaded: CatalogueItem[] = [];

        for (const batch of chunkCatalogueLookupIds(missingIds)) {
          const response = await fetch("/api/catalogue/search", {
            body: JSON.stringify({ ids: batch }),
            cache: "no-store",
            headers: { "content-type": "application/json" },
            method: "POST",
          });

          if (!response.ok) {
            throw new Error(`Catalogue lookup failed with ${response.status}`);
          }

          const data = (await response.json()) as AppCatalogueData;
          loaded.push(...data.catalogue);
          setDataSource(data.source);
          setDataNotice(data.notice ?? "");
        }

        for (const item of loaded) {
          catalogueById.set(item.id, item);
        }

        setCatalogueItems((current) => mergeCatalogueItems(current, loaded));

        return requestedIds.flatMap((id) => {
          const item = catalogueById.get(id);
          return item ? [item] : [];
        });
      } catch (error) {
        console.warn("Bounded catalogue lookup failed.", error);

        if (!options?.quiet) {
          showToast("Could not validate those catalogue items yet.", "error");
        }

        return null;
      }
    },
    [catalogueItems, dataSource, showToast],
  );

  const loadSetCatalogueData = useCallback(
    async (setName: string, options?: { force?: boolean; quiet?: boolean; setId?: string }) => {
      const normalizedSetName = setName.trim();
      const setKey = options?.setId ?? normalizedSetName;

      if (!normalizedSetName && !setKey) {
        return [];
      }

      if (catalogueComplete && !options?.force) {
        return catalogueItems.filter((item) =>
          item.type === "card" && (options?.setId ? item.setId === options.setId : item.set === normalizedSetName),
        );
      }

      if (loadedCatalogueSetNames.includes(setKey) && !options?.force) {
        return catalogueItems.filter((item) =>
          item.type === "card" && (options?.setId ? item.setId === options.setId : item.set === normalizedSetName),
        );
      }

      if (isLoadingCatalogue) {
        return null;
      }

      setIsLoadingCatalogue(true);

      try {
        const params = new URLSearchParams({ set: normalizedSetName });
        if (options?.setId) {
          params.set("setId", options.setId);
        }
        const response = await fetch(`/api/catalogue/set?${params.toString()}`, { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`Set catalogue request failed with ${response.status}`);
        }

        const data = (await response.json()) as AppCatalogueData;

        setCatalogueItems((current) => mergeCatalogueItems(current, data.catalogue));
        setLoadedCatalogueSetNames((current) =>
          current.includes(setKey) ? current : [...current, setKey],
        );
        setDataSource(data.source);
        setDataNotice(data.notice ?? "");

        return data.catalogue;
      } catch (error) {
        console.warn("Set catalogue API load failed.", error);

        if (!options?.quiet) {
          showToast("Could not load cards for this set yet.", "error");
        }

        return null;
      } finally {
        setIsLoadingCatalogue(false);
      }
    },
    [catalogueComplete, catalogueItems, isLoadingCatalogue, loadedCatalogueSetNames, showToast],
  );

  const cacheCatalogueItems = useCallback((items: CatalogueItem[]) => {
    if (!items.length) {
      return;
    }

    setCatalogueItems((current) => mergeCatalogueItems(current, items));
  }, []);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user?.id) {
      setIsLoadingData(status === "loading");
      return;
    }

    let cancelled = false;
    void refreshAppData({ isCancelled: () => cancelled });

    return () => {
      cancelled = true;
    };
  }, [refreshAppData, session?.user?.id, status]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const billing = params.get("billing");

    if (!billing) {
      return;
    }

    if (billing === "success") {
      showToast("Checkout complete. Waiting for billing confirmation.");
      void refreshAppData({ quiet: true });
    } else if (billing === "cancelled") {
      showToast("Checkout cancelled.", "warning");
    } else if (billing === "portal") {
      showToast("Billing portal closed.");
      void refreshAppData({ quiet: true });
    }

    params.delete("billing");
    params.delete("session_id");
    const nextQuery = params.toString();
    window.history.replaceState(
      window.history.state,
      "",
      `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}${window.location.hash}`,
    );
  }, [refreshAppData, showToast]);

  const summary = useMemo(() => {
    return collection.reduce(
      (total, item) => {
        const catalogueItem = catalogueById.get(item.catalogueId);
        const value = getOwnedValue(item, catalogueItem);
        const cost = item.purchasePriceMinor ?? 0;

        total.items += item.quantity;
        total.value += value ?? 0;
        total.cost += cost;

        if (value === null) {
          total.unvalued += item.quantity;
        }

        if (catalogueItem?.type === "sealed") {
          total.sealed += item.quantity;
        } else {
          total.cards += item.quantity;
        }

        return total;
      },
      { value: 0, cost: 0, items: 0, cards: 0, sealed: 0, unvalued: 0 },
    );
  }, [catalogueById, collection]);

  const wishlistTotal = useMemo(() => {
    return wishlist.reduce((total, item) => {
      const catalogueItem = catalogueById.get(item.catalogueId);
      return total + (item.targetPriceMinor ?? (catalogueItem ? wishlistMarketValueMinor(catalogueItem, item) ?? 0 : 0));
    }, 0);
  }, [catalogueById, wishlist]);

  const intelligence = useMemo(() => {
    return buildCollectionIntelligence({
      catalogueById,
      collection,
      events: collectionEvents,
      sets,
      storageLocations,
      wishlist,
    });
  }, [catalogueById, collection, collectionEvents, sets, storageLocations, wishlist]);

  function canLeaveBinderWorkspace(reason: "navigation" | "app-update" = "navigation") {
    if (binderMutationInFlightRef.current) {
      showToast(
        reason === "app-update"
          ? "Wait for the current binder save to finish before updating Mint Binder."
          : "Wait for the current binder save to finish before leaving.",
        "error",
      );
      return false;
    }
    if (
      binderDraftProtectionRef.current &&
      !window.confirm(
        reason === "app-update"
          ? "Update Mint Binder now and discard the unsaved binder layout changes?"
          : "Leave Binders and discard the unsaved layout draft?",
      )
    ) {
      return false;
    }
    if (binderDraftProtectionRef.current) {
      discardBinderDraft();
    }
    return true;
  }

  canLeaveBinderWorkspaceRef.current = canLeaveBinderWorkspace;

  function navigate(screen: Screen) {
    if (screen !== appState.screen && !canLeaveBinderWorkspace()) {
      return;
    }
    setAppState((current) => ({ ...current, screen }));
  }

  function startAdd(type: ItemType) {
    if (appState.screen !== "add" && !canLeaveBinderWorkspace()) {
      return;
    }
    setAppState((current) => ({
      ...current,
      screen: "add",
      addType: type,
      selectedCatalogueId: "",
      selectedCatalogueVariant: "",
    }));
    setAddSearch("");
  }

  async function addToCollection(catalogueId: string, formData?: FormData) {
    const catalogueItem = catalogueById.get(catalogueId);
    if (!catalogueItem) {
      showToast("That catalogue item is no longer available. Search again and retry.", "error");
      return false;
    }

    const payload = {
      catalogueId,
      quantity: Number(formData?.get("quantity") ?? 1),
      condition:
        String(formData?.get("condition") ?? "") ||
        (catalogueItem.type === "sealed" ? "Sealed" : "Near mint"),
      language: String(formData?.get("language") ?? "English"),
      variant:
        String(formData?.get("variant") ?? "") ||
        (catalogueItem.type === "sealed"
          ? "Factory sealed"
          : defaultWishlistVariant(catalogueItem) ?? selectedVariantLabel(catalogueItem)),
      paid: String(formData?.get("paid") ?? ""),
      purchaseDate: String(formData?.get("purchaseDate") ?? ""),
      overrideValue: String(formData?.get("overrideValue") ?? ""),
      valuationNote: String(formData?.get("valuationNote") ?? ""),
      location: String(formData?.get("location") ?? "Unassigned"),
      notes: String(formData?.get("notes") ?? ""),
    };

    if (dataSource === "database") {
      try {
        const response = await fetch("/api/collection-items", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Create collection item failed with ${response.status}`);
        }

        const result = (await response.json()) as { item: CollectionItem };
        const matchingWishlist = wishlist.find((item) =>
          wishlistMatchesOwnedVariant(item, catalogueId, payload.variant, catalogueItem),
        );
        const wishlistRemoved = matchingWishlist
          ? await removeWishlistItem(matchingWishlist.id, { quiet: true })
          : true;

        setCollection((items) => [...items, result.item]);
        if (wishlistRemoved) {
          setWishlist((items) => items.filter((item) =>
            !wishlistMatchesOwnedVariant(item, catalogueId, payload.variant, catalogueItem),
          ));
        }
        setAppState((current) => ({
          ...current,
          screen: "item",
          selectedItemId: result.item.id,
        }));
        void refreshAppData({ quiet: true });
        showToast(
          wishlistRemoved
            ? `${catalogueItemTitle(catalogueItem)} added to collection.`
            : `${catalogueItemTitle(catalogueItem)} was added, but its wishlist target could not be removed. Retry that removal from Wishlist.`,
          wishlistRemoved ? "success" : "warning",
        );
        return true;
      } catch (error) {
        console.warn("Collection save failed.", error);
        showToast("Save failed. Nothing was added; your details are still here so you can retry.", "error");
        return false;
      }
    }

    const paidInput = String(formData?.get("paid") ?? "").replace(/[^0-9.]/g, "");
    const paidValue = paidInput ? Math.round(Number(paidInput) * 100) : undefined;
    const nextItem: CollectionItem = {
      id: `owned-${Date.now()}`,
      catalogueId,
      quantity: Math.max(1, payload.quantity),
      condition: payload.condition,
      language: payload.language,
      variant: payload.variant,
      grade: catalogueItem.type === "sealed" ? "N/A" : "Raw",
      purchasePriceMinor:
        paidValue !== undefined && Number.isFinite(paidValue) ? paidValue : undefined,
      purchaseDate: payload.purchaseDate || undefined,
      overrideValueMinor: moneyInputToMinor(payload.overrideValue),
      valuationNote: payload.valuationNote || undefined,
      location: payload.location,
      notes: payload.notes,
    };

    setCollection((items) => [...items, nextItem]);
    setWishlist((items) => items.filter((item) =>
      !wishlistMatchesOwnedVariant(item, catalogueId, payload.variant, catalogueItem),
    ));
    setAppState((current) => ({ ...current, screen: "item", selectedItemId: nextItem.id }));
    showToast(`${catalogueItemTitle(catalogueItem)} added to collection.`);
    return true;
  }

  async function createManualSealedProduct(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    const productType = String(formData.get("productType") ?? "Other");
    const relatedSetId = String(formData.get("relatedSetId") ?? "none");
    const estimatedValue = String(formData.get("estimatedValue") ?? "");
    const notes = String(formData.get("notes") ?? "").trim();

    if (!name) {
      showToast("Sealed product name is required.", "error");
      return false;
    }

    if (dataSource === "database") {
      try {
        const response = await fetch("/api/sealed-products", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            estimatedValue,
            name,
            notes,
            productType,
            relatedSetId,
          }),
        });
        const result = (await response.json()) as { item?: CatalogueItem; error?: string };

        if (!response.ok || !result.item) {
          throw new Error(result.error ?? `Create sealed product failed with ${response.status}`);
        }

        setCatalogueItems((items) => upsertCatalogueItem(items, result.item!));
        setAppState((current) => ({
          ...current,
          addType: "sealed",
          selectedCatalogueId: result.item!.id,
          selectedCatalogueVariant: "",
        }));
        setAddSearch(result.item.name);
        void refreshAppData({ quiet: true });
        showToast(`${result.item.name} created.`);
        return true;
      } catch (error) {
        console.warn("Unable to create sealed product.", error);
        showToast("Sealed product could not be created. Nothing was saved; please retry.", "error");
        return false;
      }
    }

    const relatedSet = sets.find((set) => set.id === relatedSetId);
    const estimatedValueMinor = moneyInputToMinor(estimatedValue);
    const nextItem: CatalogueItem = {
      id: `manual-sealed-${Date.now()}`,
      type: "sealed",
      name,
      set: relatedSet?.name ?? "Sealed product",
      number: "Sealed",
      rarity: productType,
      hasPrice: estimatedValueMinor !== undefined,
      valueMinor: estimatedValueMinor ?? 0,
      confidence: "Weak",
      priceSource: estimatedValueMinor === undefined ? undefined : "manual",
      priceObservedAt: estimatedValueMinor === undefined ? undefined : new Date().toISOString(),
    };

    setCatalogueItems((items) => upsertCatalogueItem(items, nextItem));
    setAppState((current) => ({
      ...current,
      addType: "sealed",
      selectedCatalogueId: nextItem.id,
      selectedCatalogueVariant: "",
    }));
    setAddSearch(nextItem.name);
    showToast(`${nextItem.name} created.`);
    return true;
  }

  async function addToWishlist(catalogueId: string, requestedVariant?: string) {
    const catalogueItem = catalogueById.get(catalogueId);
    if (!catalogueItem || wishlist.some((item) => item.catalogueId === catalogueId)) {
      showToast("That item is already on the wishlist.", "warning");
      return false;
    }

    const variant = requestedVariant?.trim() || defaultWishlistVariant(catalogueItem);

    if (dataSource === "database") {
      try {
        const response = await fetch("/api/wishlist-items", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ catalogueId, variant }),
        });

        if (!response.ok) {
          throw new Error(`Create wishlist item failed with ${response.status}`);
        }

        const result = (await response.json()) as { item: WishlistItem };

        setWishlist((items) => [...items, result.item]);
        showToast(`${catalogueItemTitle(catalogueItem)} added to wishlist.`);
        return true;
      } catch (error) {
        console.warn("Wishlist save failed.", error);
        showToast("Wishlist save failed. Nothing was changed; please retry.", "error");
        return false;
      }
    }

    const marketValueMinor = variant
      ? catalogueValueMinorForVariant(catalogueItem, variant) ?? null
      : catalogueMarketValueMinor(catalogueItem);

    setWishlist((items) => [
      ...items,
      {
        id: `want-${Date.now()}`,
        catalogueId,
        variant,
        priority: marketValueMinor !== null && marketValueMinor > 10000 ? "Grail" : "High",
        targetPriceMinor: defaultWishlistTargetMinor(marketValueMinor),
        notes: "Added from set progress.",
      },
    ]);
    showToast(`${catalogueItemTitle(catalogueItem)} added to wishlist.`);
    return true;
  }

  async function duplicateItem(itemId: string) {
    const source = collection.find((item) => item.id === itemId);
    if (!source) {
      return;
    }

    const catalogueItem = catalogueById.get(source.catalogueId);
    const payload = payloadFromCollectionItem(source);

    if (dataSource === "database") {
      try {
        const response = await fetch("/api/collection-items", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Duplicate collection item failed with ${response.status}`);
        }

        const result = (await response.json()) as { item: CollectionItem };
        setCollection((items) => [...items, result.item]);
        setAppState((current) => ({ ...current, selectedItemId: result.item.id }));
        void refreshAppData({ quiet: true });
        showToast(`${catalogueItem ? catalogueItemTitle(catalogueItem) : "Item"} duplicated.`);
        return;
      } catch (error) {
        console.warn("Collection duplicate failed.", error);
        showToast("Duplicate failed. Nothing was changed; please retry.", "error");
        return;
      }
    }

    const copy = {
      ...source,
      id: `owned-${Date.now()}`,
      notes: source.notes ? `${source.notes} Duplicate lot.` : "Duplicate lot.",
    };

    setCollection((items) => [...items, copy]);
    setAppState((current) => ({ ...current, selectedItemId: copy.id }));
    showToast("Lot duplicated.");
  }

  async function updateCollectionItem(itemId: string, formData: FormData) {
    const source = collection.find((item) => item.id === itemId);
    const catalogueItem = source ? catalogueById.get(source.catalogueId) : undefined;

    if (!source || !catalogueItem) {
      return false;
    }

    const payload = {
      quantity: Number(formData.get("quantity") ?? source.quantity),
      condition: String(formData.get("condition") ?? source.condition),
      language: String(formData.get("language") ?? source.language),
      variant: String(formData.get("variant") ?? source.variant),
      paid: String(formData.get("paid") ?? ""),
      purchaseDate: String(formData.get("purchaseDate") ?? source.purchaseDate ?? ""),
      gradeCompany: String(formData.get("gradeCompany") ?? gradeCompanyFromLabel(source.grade)),
      gradeScore: String(formData.get("gradeScore") ?? gradeScoreFromLabel(source.grade)),
      overrideValue: String(formData.get("overrideValue") ?? moneyInputValue(source.overrideValueMinor)),
      valuationNote: String(formData.get("valuationNote") ?? source.valuationNote ?? ""),
      location: String(formData.get("location") ?? source.location),
      notes: String(formData.get("notes") ?? ""),
    };

    if (dataSource === "database") {
      try {
        const response = await fetch(`/api/collection-items/${encodeURIComponent(itemId)}`, {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Update collection item failed with ${response.status}`);
        }

        const result = (await response.json()) as { item: CollectionItem };
        setCollection((items) => items.map((item) => (item.id === itemId ? result.item : item)));
        void refreshAppData({ quiet: true });
        showToast(`${catalogueItemTitle(catalogueItem)} updated.`);
        return true;
      } catch (error) {
        console.warn("Collection update failed.", error);
        showToast("Update failed. Nothing was changed; your edits remain available to retry.", "error");
        return false;
      }
    }

    const paidInput = payload.paid.replace(/[^0-9.]/g, "");
    const paidValue = paidInput ? Math.round(Number(paidInput) * 100) : undefined;
    const updated: CollectionItem = {
      ...source,
      quantity: Math.max(1, payload.quantity),
      condition: payload.condition,
      language: payload.language,
      variant: payload.variant,
      purchasePriceMinor:
        paidValue !== undefined && Number.isFinite(paidValue) ? paidValue : undefined,
      purchaseDate: payload.purchaseDate || undefined,
      grade: gradeLabelFromForm(payload.gradeCompany, payload.gradeScore, catalogueItem.type),
      overrideValueMinor: moneyInputToMinor(payload.overrideValue),
      valuationNote: payload.valuationNote || undefined,
      location: payload.location,
      notes: payload.notes || undefined,
    };

    setCollection((items) => items.map((item) => (item.id === itemId ? updated : item)));
    showToast(`${catalogueItemTitle(catalogueItem)} updated.`);
    return true;
  }

  async function archiveCollectionItem(itemId: string) {
    const source = collection.find((item) => item.id === itemId);
    const catalogueItem = source ? catalogueById.get(source.catalogueId) : undefined;

    if (!source) {
      return false;
    }

    let removedInDatabase = false;

    if (dataSource === "database") {
      try {
        const response = await fetch(`/api/collection-items/${encodeURIComponent(itemId)}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error(`Remove collection item failed with ${response.status}`);
        }

        removedInDatabase = true;
      } catch (error) {
        console.warn("Collection remove failed.", error);
        showToast("Remove failed. The lot is still in your collection; please retry.", "error");
        return false;
      }
    }

    setCollection((items) => {
      const nextItems = items.filter((item) => item.id !== itemId);
      setAppState((current) => ({
        ...current,
        screen: "collection",
        selectedItemId: nextItems[0]?.id ?? "",
      }));
      return nextItems;
    });

    if (catalogueItem?.type === "card") {
      const stillOwned = collection.some(
        (item) => item.id !== source.id && item.catalogueId === source.catalogueId,
      );

      if (!stillOwned) {
        setSets((current) =>
          current.map((set) =>
            set.name === catalogueItem.set
              ? { ...set, owned: Math.max(0, set.owned - 1) }
              : set,
          ),
        );
      }
    }

    if (removedInDatabase) {
      void refreshAppData({ quiet: true });
    }

    showToast(`${catalogueItem ? catalogueItemTitle(catalogueItem) : "Item"} removed from collection.`);
    return true;
  }

  async function recordCollectionSale(itemId: string, formData: FormData) {
    const source = collection.find((item) => item.id === itemId);
    const catalogueItem = source ? catalogueById.get(source.catalogueId) : undefined;

    if (!source) {
      return false;
    }

    const soldDate = String(formData.get("occurredAt") ?? dateStamp());
    const amount = String(formData.get("amount") ?? "");
    const notes = String(formData.get("notes") ?? "").trim();
    const saleQuantity = Math.min(
      source.quantity,
      Math.max(1, Math.trunc(Number(formData.get("quantity") ?? source.quantity) || 1)),
    );
    const saleAmountMinor = moneyInputToMinor(amount);
    const soldBasisMinor = source.purchasePriceMinor === undefined
      ? undefined
      : Math.round(source.purchasePriceMinor * (saleQuantity / source.quantity));
    const remainingQuantity = source.quantity - saleQuantity;
    let recordedInDatabase = false;

    if (dataSource === "database") {
      try {
        const response = await fetch(`/api/collection-items/${encodeURIComponent(itemId)}/sale`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            amount,
            notes,
            occurredAt: soldDate,
            quantity: saleQuantity,
          }),
        });

        if (!response.ok) {
          throw new Error(`Record sale failed with ${response.status}`);
        }

        recordedInDatabase = true;
      } catch (error) {
        console.warn("Sale save failed.", error);
        showToast("Sale save failed. The lot was not changed; please retry.", "error");
        return false;
      }
    }

    setCollection((items) => {
      const nextItems = remainingQuantity > 0
        ? items.map((item) =>
          item.id === itemId
            ? {
                ...item,
                purchasePriceMinor: item.purchasePriceMinor === undefined
                  ? undefined
                  : Math.max(0, item.purchasePriceMinor - (soldBasisMinor ?? 0)),
                quantity: remainingQuantity,
              }
            : item,
        )
        : items.filter((item) => item.id !== itemId);
      setAppState((current) => ({
        ...current,
        screen: remainingQuantity > 0 ? "item" : "collection",
        selectedItemId: remainingQuantity > 0 ? itemId : nextItems[0]?.id ?? "",
      }));
      return nextItems;
    });
    setCollectionEvents((events) => [
      {
        id: `event-sale-${Date.now()}`,
        type: "Sold",
        itemId: source.id,
        catalogueId: source.catalogueId,
        itemName: catalogueItem ? catalogueItemTitle(catalogueItem) : "Collection item",
        quantity: saleQuantity,
        amountMinor: saleAmountMinor,
        basisMinor: soldBasisMinor,
        currency: saleAmountMinor === undefined ? undefined : "GBP",
        occurredAt: soldDate,
        notes: notes || undefined,
      },
      ...events,
    ]);

    if (remainingQuantity === 0 && catalogueItem?.type === "card") {
      const stillOwned = collection.some(
        (item) => item.id !== source.id && item.catalogueId === source.catalogueId,
      );

      if (!stillOwned) {
        setSets((current) =>
          current.map((set) =>
            set.name === catalogueItem.set
              ? { ...set, owned: Math.max(0, set.owned - 1) }
              : set,
          ),
        );
      }
    }

    if (recordedInDatabase) {
      void refreshAppData({ quiet: true });
    }

    showToast(
      `${catalogueItem ? catalogueItemTitle(catalogueItem) : "Item"} sale recorded${remainingQuantity ? `; ${remainingQuantity} remaining` : ""}.`,
    );
    return true;
  }

  function resetSampleData() {
    if (!developmentSamplePreviewEnabled) {
      showToast("Sample preview is only available in an explicitly enabled local development build.", "error");
      return;
    }

    setCatalogueItems(sampleAppData.catalogue);
    setCatalogueComplete(true);
    setLoadedCatalogueSetNames([]);
    setCollection(sampleAppData.collection);
    setWishlist(sampleAppData.wishlist);
    setSets(sampleAppData.sets);
    setStorageLocations(sampleAppData.storageLocations);
    setCollectionEvents(sampleAppData.events);
    setNotificationPreferences(sampleAppData.notificationPreferences);
    setDataSource(sampleAppData.source);
    setDataNotice(sampleAppData.notice ?? "");
    setAppState(initialState);
    showToast("Sample preview loaded locally. Your saved collection was not changed.", "warning");
  }

  async function removeWishlistItem(id: string, options?: { quiet?: boolean }) {
    if (dataSource === "database") {
      try {
        const response = await fetch(`/api/wishlist-items?id=${encodeURIComponent(id)}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error(`Delete wishlist item failed with ${response.status}`);
        }
      } catch (error) {
        console.warn("Wishlist delete failed.", error);
        if (!options?.quiet) {
          showToast("Wishlist delete failed. The target is still saved; please retry.", "error");
        }
        return false;
      }
    }

    setWishlist((items) => items.filter((item) => item.id !== id));

    if (!options?.quiet) {
      showToast("Wishlist item removed.");
    }

    return true;
  }

  async function updateWishlistItem(id: string, formData: FormData) {
    const source = wishlist.find((item) => item.id === id);

    if (!source) {
      return false;
    }

    const payload = {
      id,
      variant: String(formData.get("variant") ?? source.variant ?? ""),
      priority: String(formData.get("priority") ?? source.priority),
      targetPrice: String(formData.get("targetPrice") ?? ""),
      notes: String(formData.get("notes") ?? ""),
    };

    if (dataSource === "database") {
      try {
        const response = await fetch("/api/wishlist-items", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Update wishlist item failed with ${response.status}`);
        }

        const result = (await response.json()) as { item: WishlistItem };
        setWishlist((items) => items.map((item) => (item.id === id ? result.item : item)));
        showToast("Wishlist target updated.");
        return true;
      } catch (error) {
        console.warn("Wishlist update failed.", error);
        showToast("Wishlist update failed. Nothing was changed; please retry.", "error");
        return false;
      }
    }

    setWishlist((items) =>
      items.map((item) =>
        item.id === id
          ? {
              ...item,
              variant: payload.variant || undefined,
              priority: normalizePriority(payload.priority),
              targetPriceMinor: moneyInputToMinor(payload.targetPrice),
              notes: payload.notes || undefined,
            }
          : item,
      ),
    );
    showToast("Wishlist target updated.");
    return true;
  }

  async function createStorageLocation(formData: FormData) {
    const payload = {
      name: String(formData.get("name") ?? "").trim(),
      type: String(formData.get("type") ?? "Other"),
      notes: String(formData.get("notes") ?? "").trim(),
    };

    if (!payload.name) {
      showToast("Storage location needs a name.", "error");
      return false;
    }

    if (dataSource === "database") {
      try {
        const response = await fetch("/api/storage-locations", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(payload),
        });

        if (!response.ok) {
          throw new Error(`Create storage location failed with ${response.status}`);
        }

        const result = (await response.json()) as { location: StorageLocation };
        setStorageLocations((locations) => mergeStorageLocation(locations, result.location));
        void refreshAppData({ quiet: true });
        showToast(`${result.location.name} added to storage.`);
        return true;
      } catch (error) {
        console.warn("Storage location save failed.", error);
        showToast("Storage save failed. Nothing was added; please retry.", "error");
        return false;
      }
    }

    const existing = storageLocations.find(
      (location) => location.name.toLowerCase() === payload.name.toLowerCase(),
    );
    const location: StorageLocation = {
      id: existing?.id ?? `storage-${Date.now()}`,
      name: payload.name,
      type: storageTypes.includes(payload.type as StorageLocation["type"])
        ? (payload.type as StorageLocation["type"])
        : "Other",
      notes: payload.notes || undefined,
      itemCount: existing?.itemCount ?? 0,
      totalQuantity: existing?.totalQuantity ?? 0,
      valueMinor: existing?.valueMinor ?? 0,
    };

    setStorageLocations((locations) => mergeStorageLocation(locations, location));
    showToast(`${location.name} added to storage.`);
    return true;
  }

  async function deleteStorageLocation(id: string) {
    const location = storageLocations.find((item) => item.id === id);

    if (!location) {
      return false;
    }

    let deletedInDatabase = false;

    if (dataSource === "database") {
      try {
        const response = await fetch(`/api/storage-locations/${encodeURIComponent(id)}`, {
          method: "DELETE",
        });

        if (!response.ok) {
          throw new Error(`Delete storage location failed with ${response.status}`);
        }

        deletedInDatabase = true;
      } catch (error) {
        console.warn("Storage location delete failed.", error);
        showToast("Storage delete failed. The location and its assignments were not changed.", "error");
        return false;
      }
    }

    setStorageLocations((locations) => locations.filter((item) => item.id !== id));
    setCollection((items) =>
      items.map((item) =>
        item.location === location.name ? { ...item, location: "Unassigned" } : item,
      ),
    );

    if (deletedInDatabase) {
      void refreshAppData({ quiet: true });
    }

    showToast(`${location.name} removed from storage.`);
    return true;
  }

  function exportCollectionCsv() {
    const csv = buildCollectionCsv({
      catalogueById,
      collection,
      exportedAt: new Date(),
    });

    downloadCsv(`mintbinder-collection-${dateStamp()}.csv`, csv);
    showToast(`${collection.length} collection rows exported.`);
  }

  async function exportInsuranceReport() {
    if (!effectivePlus) {
      showToast(
        operationsEnabled
          ? "Switch the tester plan to Plus, then click Insurance report again."
          : "Insurance reports are a Plus feature. Upgrade to download one.",
        "warning",
      );
      return;
    }

    if (dataSource === "database") {
      try {
        const response = await fetch("/api/reports/insurance", { cache: "no-store" });

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Insurance report failed with ${response.status}`);
        }

        downloadBlob(`mintbinder-insurance-report-${dateStamp()}.pdf`, await response.blob());
        showToast("Insurance report exported.");
        return;
      } catch (error) {
        console.warn("Insurance report export failed.", error);
        showToast(error instanceof Error ? error.message : "Could not export insurance report.", "error");
        return;
      }
    }

    const html = buildInsuranceReportHtml({
      data: {
        catalogue: catalogueItems,
        collection,
        events: collectionEvents,
        sets,
        source: dataSource,
        storageLocations,
        subscription: {
          plan: effectivePlus ? "plus" : "free",
          entitlements: {
            "billing.portal": effectivePlus,
            "exports.insurance_report": effectivePlus,
            "pricing.alerts": effectivePlus,
          },
        },
        notificationPreferences,
        wishlist,
      },
      ownerEmail: viewer.email,
      ownerName: viewer.name,
    });

    downloadBlob(`mintbinder-insurance-report-${dateStamp()}.html`, new Blob([html], { type: "text/html" }));
    showToast("Insurance report exported.");
  }

  async function startPlusCheckout(plan: "monthly" | "yearly") {
    try {
      const response = await fetch("/api/billing/checkout", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const body = (await response.json()) as { error?: string; url?: string };

      if (!response.ok || !body.url) {
        throw new Error(body.error ?? `Checkout failed with ${response.status}`);
      }

      window.location.assign(body.url);
    } catch (error) {
      console.warn("Unable to start billing checkout.", error);
      showToast(error instanceof Error ? error.message : "Unable to start checkout.", "error");
    }
  }

  async function openBillingPortal() {
    try {
      const response = await fetch("/api/billing/portal", { method: "POST" });
      const body = (await response.json()) as {
        error?: string;
        message?: string;
        subscription?: AppSubscription;
        url?: string;
      };

      if (!response.ok) {
        throw new Error(body.error ?? `Billing portal failed with ${response.status}`);
      }

      if (body.subscription) {
        setSubscription(body.subscription);
      }

      if (body.url) {
        window.location.assign(body.url);
        return;
      }

      showToast(body.message ?? "Billing is managed in Mint Binder during beta.");
    } catch (error) {
      console.warn("Unable to open billing management.", error);
      showToast(error instanceof Error ? error.message : "Unable to open billing portal.", "error");
    }
  }

  async function cancelPlusSubscription() {
    if (!window.confirm("Cancel Plus renewal? You will keep Plus until the paid period ends.")) {
      return;
    }

    try {
      const response = await fetch("/api/billing/subscription", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      const body = (await response.json()) as {
        error?: string;
        message?: string;
        subscription?: AppSubscription;
      };

      if (!response.ok || !body.subscription) {
        throw new Error(body.error ?? `Billing update failed with ${response.status}`);
      }

      setSubscription(body.subscription);
      setAppState((current) => ({
        ...current,
        plus: body.subscription?.plan === "plus",
      }));
      void refreshAppData({ quiet: true });
      showToast(body.message ?? "Plus renewal cancelled.");
    } catch (error) {
      console.warn("Unable to cancel Plus renewal.", error);
      showToast(error instanceof Error ? error.message : "Unable to cancel Plus renewal.", "error");
    }
  }

  async function updateNotificationPreferences(nextPreferences: NotificationPreferences) {
    if (dataSource === "database") {
      try {
        const response = await fetch("/api/notification-preferences", {
          method: "PATCH",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(nextPreferences),
        });
        const body = (await response.json()) as NotificationPreferences & { error?: string };

        if (!response.ok) {
          throw new Error(body.error ?? `Preferences update failed with ${response.status}`);
        }

        setNotificationPreferences(body);
        showToast("Notification preferences saved.");
        return true;
      } catch (error) {
        console.warn("Unable to update notification preferences.", error);
        showToast(error instanceof Error ? error.message : "Unable to update notification preferences.", "error");
        return false;
      }
    }

    setNotificationPreferences(nextPreferences);
    showToast("Notification preferences saved locally.");
    return true;
  }

  function downloadImportTemplate() {
    downloadCsv("mintbinder-collection-import-template.csv", buildCollectionImportTemplateCsv());
    showToast("Collection import template downloaded.");
  }

  async function previewCollectionCsv(file: File): Promise<CollectionImportPreview | null> {
    try {
      const inspection = inspectCollectionImportCsv(await file.text());

      if (!inspection.totalRows) {
        showToast("No import rows found in that CSV.", "error");
        return null;
      }

      const matchedCatalogue = await loadCatalogueItemsByIds(
        inspection.rows.map((entry) => entry.row.catalogueId),
        { quiet: true },
      );

      if (!matchedCatalogue) {
        showToast("The catalogue lookup failed, so this import cannot be validated yet.", "error");
        return null;
      }

      const catalogueLookup = new Map(matchedCatalogue.map((item) => [item.id, item]));
      const previewRows = inspection.rows.map((entry): CollectionImportPreviewRow => {
        const catalogueItem = catalogueLookup.get(entry.row.catalogueId);
        const errors = [...entry.errors];

        if (entry.row.catalogueId && !catalogueItem) {
          errors.push("Catalogue item was not found.");
        }

        return {
          catalogueId: entry.row.catalogueId,
          errors,
          itemName: catalogueItem ? catalogueItemTitle(catalogueItem) : undefined,
          rowNumber: entry.rowNumber,
        };
      });
      const importableCount = previewRows.filter((row) => row.errors.length === 0).length;

      return {
        importableCount,
        rows: previewRows,
        skippedCount: previewRows.length - importableCount,
        totalCount: inspection.totalRows,
      };
    } catch (error) {
      console.warn("Collection CSV preview failed.", error);
      showToast("Could not read that CSV. Check the template and try again.", "error");
      return null;
    }
  }

  async function importCollectionCsv(file: File): Promise<CollectionImportResult> {
    const emptyResult = { failed: 0, imported: 0, skipped: 0 };

    try {
      const inspection = inspectCollectionImportCsv(await file.text());
      const matchedCatalogue = await loadCatalogueItemsByIds(
        inspection.rows.map((entry) => entry.row.catalogueId),
        { quiet: true },
      );

      if (!matchedCatalogue) {
        showToast("The catalogue lookup failed. Nothing was imported.", "error");
        return { ...emptyResult, failed: inspection.totalRows };
      }

      const catalogueLookup = new Map(matchedCatalogue.map((item) => [item.id, item]));
      const importableRows = inspection.rows
        .filter((entry) => entry.errors.length === 0 && catalogueLookup.has(entry.row.catalogueId))
        .map((entry) => entry.row);
      const skipped = inspection.totalRows - importableRows.length;

      if (!importableRows.length) {
        showToast("No validated rows matched the current catalogue. Nothing was imported.", "error");
        return { ...emptyResult, skipped };
      }

      let failed = 0;
      let imported = 0;

      if (dataSource === "database") {
        const importedItems: CollectionItem[] = [];

        for (const row of importableRows) {
          try {
            const response = await fetch("/api/collection-items", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify(importPayload(row)),
            });

            if (!response.ok) {
              throw new Error(`Import row failed with ${response.status}`);
            }

            const result = (await response.json()) as { item: CollectionItem };
            importedItems.push(result.item);
            imported += 1;
          } catch (error) {
            console.warn(`Collection CSV row for ${row.catalogueId} failed.`, error);
            failed += 1;
          }
        }

        if (importedItems.length) {
          setCollection((items) => [...items, ...importedItems]);
          void refreshAppData({ quiet: true });
        }
      } else {
        const importedAt = Date.now();
        const importedItems = importableRows.map((row, index) => {
          const catalogueItem = catalogueLookup.get(row.catalogueId);
          const paidValue = moneyInputToMinor(row.paid);
          const overrideValue = moneyInputToMinor(row.overrideValue);

          return {
            id: `owned-import-${importedAt}-${index}-${row.catalogueId}`,
            catalogueId: row.catalogueId,
            quantity: row.quantity,
            condition: row.condition,
            language: row.language,
            variant: row.variant,
            grade: catalogueItem?.type === "sealed" ? "N/A" : row.grade || "Raw",
            purchasePriceMinor: paidValue,
            purchaseDate: row.purchaseDate || undefined,
            overrideValueMinor: overrideValue,
            valuationNote: row.valuationNote || undefined,
            location: row.location,
            notes: row.notes || undefined,
          };
        });

        setCollection((items) => [...items, ...importedItems]);
        imported = importedItems.length;
      }

      const result = { failed, imported, skipped };

      if (!imported) {
        showToast(`Import failed for ${failed} row${failed === 1 ? "" : "s"}. Nothing was added.`, "error");
      } else if (failed || skipped) {
        showToast(
          `${imported} imported, ${skipped} skipped, ${failed} failed. Review the CSV before retrying failed rows.`,
          "warning",
        );
      } else {
        showToast(`${imported} row${imported === 1 ? "" : "s"} imported.`);
      }

      return result;
    } catch (error) {
      console.warn("Collection CSV import failed.", error);
      showToast("Could not import that CSV. Nothing new was saved by this attempt.", "error");
      return { ...emptyResult, failed: 1 };
    }
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSigningIn(true);
    setSignInError("");

    if (authMode === "register" && signInPassword !== signInPasswordConfirmation) {
      setIsSigningIn(false);
      setSignInError("Passwords do not match.");
      return;
    }

    try {
      const result = await signIn("credentials", {
        email: signInEmail,
        password: signInPassword,
        mode: authMode,
        name: signInName,
        redirect: false,
      });

      if (!result?.error) {
        setSignInPassword("");
        setSignInPasswordConfirmation("");
        return;
      }

      setSignInError(
        authMode === "register"
          ? "Could not create that account."
          : "Could not sign in with those details.",
      );
    } catch (error) {
      console.warn("Authentication request failed.", error);
      setSignInError("Authentication is temporarily unavailable. Please try again.");
    } finally {
      setIsSigningIn(false);
    }
  }

  if (status !== "authenticated") {
    return (
      <SignInScreen
        authMode={authMode}
        email={signInEmail}
        error={signInError}
        isSubmitting={isSigningIn}
        name={signInName}
        notice={status === "loading" ? "Checking for an existing session. You can still sign in." : ""}
        password={signInPassword}
        passwordConfirmation={signInPasswordConfirmation}
        onAuthModeChange={(mode) => {
          setAuthMode(mode);
          setSignInError("");
          setSignInPasswordConfirmation("");
        }}
        onEmailChange={setSignInEmail}
        onNameChange={setSignInName}
        onPasswordChange={setSignInPassword}
        onPasswordConfirmationChange={setSignInPasswordConfirmation}
        onSubmit={handleSignIn}
      />
    );
  }

  const context = {
    activeSetGoal,
    appState: effectiveAppState,
    viewer,
    cacheCatalogueItems,
    catalogueItems,
    catalogueById,
    catalogueComplete,
    collection,
    customBinders,
    binderNotice,
    storageLocations,
    collectionEvents,
    notificationPreferences,
    subscription,
    sets,
    dataSource,
    dataNotice,
    isLoadingData,
    isLoadingBinders,
    isLoadingSetGoal,
    isLoadingCatalogue,
    collectionSearch,
    setCollectionSearch,
    addSearch,
    setAddSearch,
    setSearch,
    setSetSearch,
    navigate,
    startAdd,
    summary,
    intelligence,
    wishlist,
    wishlistTotal,
    addToCollection,
    beginBinderDraft,
    binderDraftProtected,
    clearBinderDraftProtection,
    createManualSealedProduct,
    discardBinderDraft,
    setCustomBinders,
    setBinderMutationInFlight,
    updateCollectionItem,
    archiveCollectionItem,
    recordCollectionSale,
    addToWishlist,
    duplicateItem,
    removeWishlistItem,
    updateWishlistItem,
    createStorageLocation,
    deleteStorageLocation,
    exportCollectionCsv,
    exportInsuranceReport,
    startPlusCheckout,
    openBillingPortal,
    cancelPlusSubscription,
    updateNotificationPreferences,
    downloadImportTemplate,
    previewCollectionCsv,
    importCollectionCsv,
    setThemeId,
    setAppState,
    showToast,
    resetSampleData,
    reloadActiveSetGoal,
    reloadBinders,
    refreshAppData,
    loadSetCatalogueData,
    loadedCatalogueSetNames,
    setActiveSetGoal,
    activeSetGoalNotice,
    setActiveSetGoalNotice,
    themeId,
  };

  return (
    <div className="app-shell">
      <Header
        alertCount={intelligence.actionQueue.length + (effectivePlus ? intelligence.priceAlerts.length : 0)}
        canPreviewPlan={canPreviewPlan}
        plus={effectivePlus}
        previewPlus={effectivePlus}
        userEmail={viewer.email}
        userName={viewer.name}
        onNavigate={navigate}
        onTogglePreviewPlus={(nextPlus) => {
          setPlusPreviewOverride(nextPlus);
          showToast(`Previewing ${nextPlus ? "Plus" : "Free"} plan.`);
        }}
        onSignOut={() => {
          if (canLeaveBinderWorkspace()) {
            void signOut({ redirect: false });
          }
        }}
      />
      <div className="app-body">
        <Sidebar
          active={appState.screen}
          alertCount={intelligence.actionQueue.length + (effectivePlus ? intelligence.priceAlerts.length : 0)}
          onNavigate={navigate}
        />
        <main aria-busy={isLoadingData} className="main">
          {renderScreen(context)}
          <LegalFooter />
        </main>
      </div>
      <BottomNav active={appState.screen} onNavigate={navigate} />
      {toast ? (
        <div
          aria-atomic="true"
          aria-live={toast.tone === "error" ? "assertive" : "polite"}
          className={`toast ${toast.tone}`}
          role={toast.tone === "error" ? "alert" : "status"}
        >
          {toast.message}
        </div>
      ) : null}
    </div>
  );
}

type ScreenContext = {
  activeSetGoal: ActiveSetGoal | null;
  activeSetGoalNotice: string;
  appState: AppState;
  viewer: Viewer;
  cacheCatalogueItems: (items: CatalogueItem[]) => void;
  catalogueItems: CatalogueItem[];
  catalogueById: Map<string, CatalogueItem>;
  catalogueComplete: boolean;
  collection: CollectionItem[];
  customBinders: CustomBinder[];
  binderNotice: string;
  storageLocations: StorageLocation[];
  collectionEvents: CollectionEvent[];
  notificationPreferences: NotificationPreferences;
  subscription: AppSubscription;
  sets: SetProgress[];
  dataSource: AppDataSource;
  dataNotice: string;
  isLoadingData: boolean;
  isLoadingBinders: boolean;
  isLoadingSetGoal: boolean;
  isLoadingCatalogue: boolean;
  loadedCatalogueSetNames: string[];
  collectionSearch: string;
  setCollectionSearch: (value: string) => void;
  addSearch: string;
  setAddSearch: (value: string) => void;
  setSearch: string;
  setSetSearch: (value: string) => void;
  navigate: (screen: Screen) => void;
  startAdd: (type: ItemType) => void;
  summary: {
    value: number;
    cost: number;
    items: number;
    cards: number;
    sealed: number;
    unvalued: number;
  };
  intelligence: CollectionIntelligence;
  wishlist: WishlistItem[];
  wishlistTotal: number;
  addToCollection: (catalogueId: string, formData?: FormData) => Promise<boolean>;
  beginBinderDraft: (snapshot: CustomBinder[]) => void;
  binderDraftProtected: boolean;
  clearBinderDraftProtection: () => void;
  createManualSealedProduct: (formData: FormData) => Promise<boolean>;
  discardBinderDraft: () => void;
  setCustomBinders: Dispatch<SetStateAction<CustomBinder[]>>;
  setBinderMutationInFlight: (inFlight: boolean) => void;
  updateCollectionItem: (itemId: string, formData: FormData) => Promise<boolean>;
  archiveCollectionItem: (itemId: string) => Promise<boolean>;
  recordCollectionSale: (itemId: string, formData: FormData) => Promise<boolean>;
  addToWishlist: (catalogueId: string, variant?: string) => Promise<boolean>;
  duplicateItem: (itemId: string) => Promise<void>;
  removeWishlistItem: (id: string, options?: { quiet?: boolean }) => Promise<boolean>;
  updateWishlistItem: (id: string, formData: FormData) => Promise<boolean>;
  createStorageLocation: (formData: FormData) => Promise<boolean>;
  deleteStorageLocation: (id: string) => Promise<boolean>;
  exportCollectionCsv: () => void;
  exportInsuranceReport: () => Promise<void>;
  startPlusCheckout: (plan: "monthly" | "yearly") => Promise<void>;
  openBillingPortal: () => Promise<void>;
  cancelPlusSubscription: () => Promise<void>;
  updateNotificationPreferences: (preferences: NotificationPreferences) => Promise<boolean>;
  downloadImportTemplate: () => void;
  previewCollectionCsv: (file: File) => Promise<CollectionImportPreview | null>;
  importCollectionCsv: (file: File) => Promise<CollectionImportResult>;
  setThemeId: Dispatch<SetStateAction<ThemeId>>;
  setAppState: Dispatch<SetStateAction<AppState>>;
  showToast: (message: string, tone?: ToastTone) => void;
  resetSampleData: () => void;
  reloadActiveSetGoal: (options?: { quiet?: boolean }) => Promise<boolean>;
  reloadBinders: (options?: { quiet?: boolean }) => void;
  refreshAppData: (options?: { quiet?: boolean }) => Promise<boolean>;
  loadSetCatalogueData: (
    setName: string,
    options?: { force?: boolean; quiet?: boolean; setId?: string },
  ) => Promise<CatalogueItem[] | null>;
  setActiveSetGoal: Dispatch<SetStateAction<ActiveSetGoal | null>>;
  setActiveSetGoalNotice: Dispatch<SetStateAction<string>>;
  themeId: ThemeId;
};

function renderScreen(context: ScreenContext) {
  switch (context.appState.screen) {
    case "collection":
      return <CollectionScreen {...context} />;
    case "binders":
      return <BindersScreen {...context} />;
    case "add":
      return <AddScreen {...context} />;
    case "item":
      return <ItemDetailScreen {...context} />;
    case "sets":
      return <SetsScreen {...context} />;
    case "setDetail":
      return <SetDetailScreen {...context} />;
    case "wishlist":
      return <WishlistScreen {...context} />;
    case "alerts":
      return <AlertsScreen {...context} />;
    case "analytics":
      return <AnalyticsScreen {...context} />;
    case "ops":
      return canUseOperationsForUser(context.viewer.role) ? (
        <LazyOperationsScreen
          refreshAppData={context.refreshAppData}
          showToast={context.showToast}
        />
      ) : <OperationsLockedScreen />;
    case "settings":
      return <SettingsScreen {...context} />;
    case "dashboard":
    default:
      return <DashboardScreen {...context} />;
  }
}

function SignInScreen({
  authMode,
  email,
  error,
  isSubmitting,
  name,
  notice,
  password,
  passwordConfirmation,
  onAuthModeChange,
  onEmailChange,
  onNameChange,
  onPasswordChange,
  onPasswordConfirmationChange,
  onSubmit,
}: {
  authMode: AuthMode;
  email: string;
  error: string;
  isSubmitting: boolean;
  name: string;
  notice: string;
  password: string;
  passwordConfirmation: string;
  onAuthModeChange: (value: AuthMode) => void;
  onEmailChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onPasswordConfirmationChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
  const [showPassword, setShowPassword] = useState(false);
  const passwordConfirmationEntered = authMode === "register" && passwordConfirmation.length > 0;
  const passwordsMatch = passwordConfirmationEntered && password === passwordConfirmation;

  return (
    <main className="auth-shell">
      <div className="auth-stack">
        <form className="auth-card" onSubmit={onSubmit}>
          <AuthBrand />
          <div>
            <h1>{authMode === "register" ? "Create account" : "Sign in"}</h1>
            <p className="muted">Track the cards and sealed products you own, want, and are watching.</p>
          </div>
          <div className="segmented" aria-label="Authentication mode">
            <button
              aria-pressed={authMode === "sign-in"}
              className={authMode === "sign-in" ? "active" : ""}
              type="button"
              onClick={() => onAuthModeChange("sign-in")}
            >
              Sign in
            </button>
            <button
              aria-pressed={authMode === "register"}
              className={authMode === "register" ? "active" : ""}
              type="button"
              onClick={() => onAuthModeChange("register")}
            >
              Create account
            </button>
          </div>
          {notice ? <p className="auth-notice" role="status">{notice}</p> : null}
          <Field label="Email">
            <input
              autoComplete="email"
              autoCapitalize="none"
              inputMode="email"
              name="email"
              spellCheck={false}
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              required
            />
          </Field>
          <Field label="Password">
            <input
              autoComplete={authMode === "register" ? "new-password" : "current-password"}
              name="password"
              type={showPassword ? "text" : "password"}
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              minLength={8}
              required
            />
          </Field>
          {authMode === "register" ? (
            <Field label="Confirm password">
              <input
                aria-describedby={passwordConfirmationEntered ? "password-confirmation-status" : undefined}
                aria-invalid={passwordConfirmationEntered && !passwordsMatch}
                autoComplete="new-password"
                name="passwordConfirmation"
                type={showPassword ? "text" : "password"}
                value={passwordConfirmation}
                onChange={(event) => onPasswordConfirmationChange(event.target.value)}
                minLength={8}
                required
              />
            </Field>
          ) : null}
          {passwordConfirmationEntered ? (
            <p
              className={passwordsMatch ? "auth-confirmation valid" : "auth-confirmation invalid"}
              id="password-confirmation-status"
              role="status"
            >
              {passwordsMatch ? "Passwords match." : "Passwords do not match yet."}
            </p>
          ) : null}
          <label className="check-row auth-password-visibility">
            <input
              checked={showPassword}
              onChange={(event) => setShowPassword(event.currentTarget.checked)}
              type="checkbox"
            />
            <span>Show password</span>
          </label>
          {authMode === "sign-in" ? (
            <Link className="auth-secondary-link" href="/auth/forgot-password">
              Forgot your password?
            </Link>
          ) : null}
          {authMode === "register" ? (
            <Field label="Display name">
              <input
                autoComplete="name"
                name="name"
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                required
              />
            </Field>
          ) : null}
          {error ? <p className="auth-error" role="alert">{error}</p> : null}
          <button className="button primary full" type="submit" disabled={isSubmitting}>
            {authMode === "register" ? <UserRound size={17} /> : <LogIn size={17} />}
            {isSubmitting
              ? authMode === "register"
                ? "Creating account"
                : "Signing in"
              : authMode === "register"
                ? "Create account"
                : "Sign in"}
          </button>
        </form>
        <section className="auth-onboarding" aria-label="Getting started">
          <h2>Start with one binder</h2>
          <div className="onboarding-list">
            <span><Layers3 size={17} />Add owned cards or sealed products.</span>
            <span><Heart size={17} />Set wishlist targets before buying.</span>
            <span><Sparkles size={17} />Upgrade later for alerts and deeper analytics.</span>
          </div>
          <p className="muted">Mint Binder is an independent beta, not an official Pokemon product.</p>
        </section>
        <LegalFooter compact />
      </div>
    </main>
  );
}

function AuthBrand() {
  return (
    <div className="auth-brand">
      <span className="brand-mark">
        <span className="brand-dot" />
      </span>
      <span>Mint Binder</span>
    </div>
  );
}

function LegalFooter({ compact = false }: { compact?: boolean }) {
  return (
    <footer className={compact ? "legal-footer compact" : "legal-footer"} aria-label="Legal links">
      <span>Independent collector beta.</span>
      <a href="/legal/privacy">Privacy</a>
      <a href="/legal/terms">Terms</a>
      <a href="/legal/non-affiliation">Non-affiliation</a>
    </footer>
  );
}

function Header({
  alertCount,
  canPreviewPlan,
  plus,
  previewPlus,
  userEmail,
  userName,
  onNavigate,
  onTogglePreviewPlus,
  onSignOut,
}: {
  alertCount: number;
  canPreviewPlan: boolean;
  plus: boolean;
  previewPlus: boolean;
  userEmail: string;
  userName: string;
  onNavigate: (screen: Screen) => void;
  onTogglePreviewPlus: (plus: boolean) => void;
  onSignOut: () => void;
}) {
  return (
    <header className="topbar">
      <button className="brand" onClick={() => onNavigate("dashboard")} aria-label="Open dashboard">
        <span className="brand-mark">
          <span className="brand-dot" />
        </span>
        <span className="brand-text">Mint Binder</span>
      </button>
      <div className="topbar-actions">
        <button
          aria-label={plus ? "Open Plus insights" : "Open upgrade settings"}
          className="plan-pill"
          onClick={() => onNavigate(plus ? "analytics" : "settings")}
        >
          {plus ? <Sparkles size={17} /> : <Lock size={17} />}
          <span className="topbar-action-label">{plus ? "Plus" : "Upgrade"}</span>
        </button>
        {canPreviewPlan ? (
          <div className="plan-preview-control" aria-label="Temporary tester-only plan preview">
            <span>Test plan</span>
            <button
              className={!previewPlus ? "active" : ""}
              type="button"
              onClick={() => onTogglePreviewPlus(false)}
            >
              Free
            </button>
            <button
              className={previewPlus ? "active" : ""}
              type="button"
              onClick={() => onTogglePreviewPlus(true)}
            >
              Plus
            </button>
          </div>
        ) : null}
        <button
          className="status-pill alert-pill"
          onClick={() => onNavigate("alerts")}
          aria-label={`${alertCount} alerts`}
          title={`${alertCount} alerts`}
        >
          <Bell size={17} />
          {alertCount}
        </button>
        <button
          aria-label={`Open settings for ${userName}`}
          className="user-pill"
          onClick={() => onNavigate("settings")}
          title={userEmail}
        >
          <UserRound size={17} />
          <span className="user-pill-name">{userName}</span>
        </button>
        <button aria-label="Sign out" className="button small" onClick={onSignOut}>
          <LogOut size={17} />
          <span className="topbar-action-label">Sign out</span>
        </button>
      </div>
    </header>
  );
}

function Sidebar({
  active,
  alertCount,
  onNavigate,
}: {
  active: Screen;
  alertCount: number;
  onNavigate: (screen: Screen) => void;
}) {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <NavButton active={active === "dashboard"} icon={<LayoutDashboard />} label="Portfolio" onClick={() => onNavigate("dashboard")} />
      <NavButton active={active === "collection"} icon={<Layers3 />} label="Collection" onClick={() => onNavigate("collection")} />
      <NavButton active={active === "add"} icon={<Plus />} label="Add" onClick={() => onNavigate("add")} />
      <NavButton active={active === "wishlist"} icon={<Heart />} label="Wishlist" onClick={() => onNavigate("wishlist")} />
      <NavButton active={active === "sets" || active === "setDetail"} icon={<GalleryVerticalEnd />} label="Sets" onClick={() => onNavigate("sets")} />
      <span className="nav-divider" />
      <NavButton active={active === "binders"} icon={<BookOpen />} label="Binders" onClick={() => onNavigate("binders")} />
      <NavButton active={active === "alerts"} icon={<Bell />} label={`Alerts (${alertCount})`} onClick={() => onNavigate("alerts")} />
      <NavButton active={active === "analytics"} icon={<BarChart3 />} label="Insights" onClick={() => onNavigate("analytics")} />
      <NavButton active={active === "settings"} icon={<Settings />} label="Settings" onClick={() => onNavigate("settings")} />
    </aside>
  );
}

function BottomNav({
  active,
  onNavigate,
}: {
  active: Screen;
  onNavigate: (screen: Screen) => void;
}) {
  return (
    <nav className="bottom-nav" aria-label="Primary navigation">
      <MobileNavButton active={active === "dashboard"} icon={<LayoutDashboard />} label="Portfolio" onClick={() => onNavigate("dashboard")} />
      <MobileNavButton active={active === "collection"} icon={<Layers3 />} label="Collection" onClick={() => onNavigate("collection")} />
      <button
        aria-current={active === "add" ? "page" : undefined}
        className={active === "add" ? "active add-button" : "add-button"}
        onClick={() => onNavigate("add")}
      >
        <span className="icon-wrap">
          <Plus size={20} />
        </span>
        <span>Add</span>
      </button>
      <MobileNavButton active={active === "wishlist"} icon={<Heart />} label="Want" onClick={() => onNavigate("wishlist")} />
      <MobileNavButton active={active === "sets" || active === "setDetail"} icon={<GalleryVerticalEnd />} label="Sets" onClick={() => onNavigate("sets")} />
      <MobileNavButton active={active === "settings" || active === "binders" || active === "alerts" || active === "analytics" || active === "ops"} icon={<Settings />} label="More" onClick={() => onNavigate("settings")} />
    </nav>
  );
}

function NavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button aria-current={active ? "page" : undefined} className={active ? "nav-button active" : "nav-button"} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function MobileNavButton({
  active,
  icon,
  label,
  onClick,
}: {
  active: boolean;
  icon: ReactNode;
  label: string;
  onClick: () => void;
}) {
  return (
    <button aria-current={active ? "page" : undefined} className={active ? "active" : ""} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function DashboardScreen({
  collection,
  collectionEvents,
  catalogueById,
  dataSource,
  sets,
  storageLocations,
  dataNotice,
  isLoadingData,
  navigate,
  refreshAppData,
  startAdd,
  summary,
  intelligence,
  viewer,
  wishlist,
  setAddSearch,
  setAppState,
}: ScreenContext) {
  const [portfolioCardSearch, setPortfolioCardSearch] = useState("");
  const recent = collection.slice(-5).reverse();
  const focusSets = sets
    .filter((set) => set.owned > 0)
    .sort((left, right) => completionPercent(right.owned, right.total) - completionPercent(left.owned, left.total))
    .slice(0, 3);
  const dashboardSets = focusSets.length ? focusSets : sets.slice(0, 3);
  const gain = summary.value - summary.cost;
  const hasDataLoadError = dataSource === "database" && Boolean(dataNotice) && !isLoadingData;

  function searchCardCatalogue(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const query = portfolioCardSearch.trim();

    if (!query) {
      return;
    }

    setAddSearch(query);
    setAppState((current) => ({
      ...current,
      addType: "card",
      screen: "add",
      selectedCatalogueId: "",
      selectedCatalogueVariant: "",
    }));
  }

  return (
    <section className="page">
      <PageHeader
        title="Portfolio"
        action={
          <button className="button primary" onClick={() => startAdd("card")}>
            <Plus size={17} />
            Add item
          </button>
        }
      />

      <section aria-labelledby="portfolio-card-search-title" className="portfolio-card-search">
        <div className="portfolio-card-search-copy">
          <span className="tag blue">Catalogue</span>
          <div>
            <h2 id="portfolio-card-search-title">Find any card</h2>
            <p>Search by card name, set, or collector number to check the exact printing and its price history.</p>
          </div>
        </div>
        <form className="portfolio-card-search-form" onSubmit={searchCardCatalogue} role="search">
          <label className="search-box">
            <Search aria-hidden="true" size={18} />
            <span className="sr-only">Search the card catalogue</span>
            <input
              aria-label="Search the card catalogue"
              autoComplete="off"
              onChange={(event) => setPortfolioCardSearch(event.target.value)}
              placeholder="Try Latias & Latios-GX, Team Up, or 170"
              value={portfolioCardSearch}
            />
          </label>
          <button className="button primary" disabled={!portfolioCardSearch.trim()} type="submit">
            <Search size={17} />
            Search cards
          </button>
        </form>
      </section>

      <PortfolioHero
        dataNotice={dataNotice}
        dataSource={dataSource}
        gain={gain}
        intelligence={intelligence}
        isLoadingData={isLoadingData}
        navigate={navigate}
        onRetry={() => void refreshAppData()}
        summary={summary}
      />

      {!collection.length && !hasDataLoadError ? (
        <section className="starter-panel">
          <div>
            <span className="tag blue">First run</span>
            <h2>Start with one card or sealed product.</h2>
            <p className="muted">
              You can save the basics first, then add condition, values, storage, and notes when you have them.
            </p>
          </div>
          <div className="actions">
            <button className="button primary" onClick={() => startAdd("card")}>
              <Plus size={17} />
              Add first card
            </button>
            <button className="button" onClick={() => startAdd("sealed")}>
              <PackagePlus size={17} />
              Add sealed
            </button>
          </div>
        </section>
      ) : null}

      {!hasDataLoadError ? (
        <OnboardingChecklist
          collection={collection}
          ownerEmail={viewer.email}
          sets={sets}
          storageLocations={storageLocations}
          summary={summary}
          wishlist={wishlist}
          navigate={navigate}
          setAppState={setAppState}
          startAdd={startAdd}
        />
      ) : null}

      <div className="dashboard-grid portfolio-dashboard-grid">
        <div className="section-block">
          <TopHoldings holdings={intelligence.topHoldings} />

          <section className="section-block">
            <SectionHeader title="Recent additions" />
            <div className="compact-item-list">
              {recent.length ? recent.map((item) => (
                <PortfolioRecentRow
                  key={item.id}
                  item={item}
                  catalogueItem={catalogueById.get(item.catalogueId)}
                  onClick={() => {
                    setAppState((current) => ({ ...current, selectedItemId: item.id }));
                    navigate("item");
                  }}
                />
              )) : (
                <EmptyState
                  title="No items yet"
                  description="Add your first card or sealed product to start building the dashboard."
                  action={
                    <button className="button primary" onClick={() => startAdd("card")}>
                      <Plus size={17} />
                      Add first item
                    </button>
                  }
                />
              )}
            </div>
          </section>
        </div>

        <div className="side-stack">
          <DashboardAttentionPanel
            intelligence={intelligence}
            navigate={navigate}
            setAppState={setAppState}
            startAdd={startAdd}
            summary={summary}
          />

          <section className="section-block">
            <SectionHeader title="Set progress" action={<button className="button" onClick={() => navigate("sets")}>Open sets</button>} />
            <div className="set-list">
              {dashboardSets.map((set) => (
                <SetProgressCard
                  key={set.id}
                  set={set}
                  onClick={() => {
                    setAppState((current) => ({ ...current, selectedSetId: set.id }));
                    navigate("setDetail");
                  }}
                />
              ))}
            </div>
            {sets.length > dashboardSets.length ? (
              <p className="muted">Showing {dashboardSets.length} focus sets. Open Sets for the full catalogue.</p>
            ) : null}
          </section>

          <section className="tool-panel">
            <div className="panel-title-row">
              <h2>Recent history</h2>
              <History size={18} />
            </div>
            <EventList events={collectionEvents.slice(0, 4)} />
          </section>
        </div>
      </div>
    </section>
  );
}

function PortfolioHero({
  dataNotice,
  dataSource,
  gain,
  intelligence,
  isLoadingData,
  navigate,
  onRetry,
  summary,
}: {
  dataNotice: string;
  dataSource: AppDataSource;
  gain: number;
  intelligence: CollectionIntelligence;
  isLoadingData: boolean;
  navigate: (screen: Screen) => void;
  onRetry: () => void;
  summary: ScreenContext["summary"];
}) {
  const rangeChange = portfolioRangeChange(intelligence.portfolioHistory, "30d");
  const hasDataLoadError = dataSource === "database" && Boolean(dataNotice) && !isLoadingData;

  return (
    <section className="portfolio-hero">
      <div className="portfolio-hero-main">
        <div className="portfolio-kicker">
          <span className={hasDataLoadError ? "tag red" : dataSource === "database" ? "status-pill" : "tag amber"}>
            {isLoadingData ? "Loading" : hasDataLoadError ? "Data unavailable" : dataSource === "database" ? "Live data" : "Sample data"}
          </span>
          <span className="status-pill">{intelligence.healthLabel}</span>
        </div>
        <div>
          <span className="portfolio-label">Collection value</span>
          <strong className="portfolio-value">{formatMoney(summary.value)}</strong>
          <p className="muted">
            {summary.items} lots tracked across {summary.cards} cards and {summary.sealed} sealed products.
          </p>
        </div>
        <div className="portfolio-actions">
          <button className="button" onClick={() => navigate("collection")}>
            <Layers3 size={17} />
            View collection
          </button>
          <button className="button" onClick={() => navigate("analytics")}>
            <BarChart3 size={17} />
            Insights
          </button>
        </div>
        {hasDataLoadError ? (
          <div className="data-error-state" role="alert">
            <p>{dataNotice}</p>
            <button className="button small" type="button" onClick={onRetry}>
              <RefreshCw size={16} />
              Retry data load
            </button>
          </div>
        ) : dataNotice ? <p className="muted">{dataNotice}</p> : null}
      </div>
      <div className="portfolio-hero-side">
        <PortfolioValueLineChart
          compact
          currentValueMinor={summary.value}
          history={intelligence.portfolioHistory}
        />
        <div className="portfolio-metric-grid">
          <span>
            <small>30-day change</small>
            <strong className={rangeChange && rangeChange.valueMinor >= 0 ? "positive" : ""}>
              {rangeChange ? `${formatSignedMoney(rangeChange.valueMinor)} (${formatSignedPercent(rangeChange.percent)})` : "Building"}
            </strong>
          </span>
          <span>
            <small>Total gain/loss</small>
            <strong className={gain >= 0 ? "positive" : ""}>{formatSignedMoney(gain)}</strong>
          </span>
          <span>
            <small>Cost basis</small>
            <strong>{formatMoney(summary.cost)}</strong>
          </span>
          <span>
            <small>Latest pricing</small>
            <strong>{intelligence.latestPricingAt ? formatEventDate(intelligence.latestPricingAt) : "Pending"}</strong>
          </span>
        </div>
      </div>
    </section>
  );
}

function DashboardAttentionPanel({
  intelligence,
  navigate,
  setAppState,
  startAdd,
  summary,
}: {
  intelligence: CollectionIntelligence;
  navigate: (screen: Screen) => void;
  setAppState: Dispatch<SetStateAction<AppState>>;
  startAdd: (type: ItemType) => void;
  summary: ScreenContext["summary"];
}) {
  const actions = intelligence.actionQueue.slice(0, 3);

  return (
    <section className="tool-panel attention-panel">
      <div className="panel-title-row">
        <h2>Needs attention</h2>
        <span className={actions.length ? "tag blue" : "tag green"}>
          {actions.length ? `${actions.length} open` : "Clear"}
        </span>
      </div>
      {actions.length ? (
        <div className="insight-list">
          {actions.map((action) => (
            <article className="insight-row" key={action.id}>
              <span className={`tag ${actionTagClass(action.tone)}`}>{action.category}</span>
              <div>
                <strong>{action.title}</strong>
                <p className="muted">{action.detail}</p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">No obvious collection issues right now.</p>
      )}
      <div className="attention-actions">
        {summary.unvalued ? (
          <button
            className="button"
            onClick={() =>
              setAppState((current) => ({
                ...current,
                collectionFilter: "unknown",
                collectionValueFilter: "unvalued",
                screen: "collection",
              }))
            }
          >
            <Bell size={17} />
            Review {summary.unvalued}
          </button>
        ) : null}
        <button className="button" onClick={() => navigate("wishlist")}>
          <Heart size={17} />
          Wishlist
        </button>
        <button className="button primary" onClick={() => startAdd("card")}>
          <Plus size={17} />
          Add
        </button>
      </div>
    </section>
  );
}

function OnboardingChecklist({
  collection,
  navigate,
  ownerEmail,
  sets,
  setAppState,
  startAdd,
  storageLocations,
  summary,
  wishlist,
}: {
  collection: CollectionItem[];
  navigate: (screen: Screen) => void;
  ownerEmail: string;
  sets: SetProgress[];
  setAppState: Dispatch<SetStateAction<AppState>>;
  startAdd: (type: ItemType) => void;
  storageLocations: StorageLocation[];
  summary: ScreenContext["summary"];
  wishlist: WishlistItem[];
}) {
  const hasNamedStorage =
    storageLocations.length > 0 ||
    collection.some((item) => item.location.trim() && item.location.trim().toLowerCase() !== "unassigned");
  const steps = [
    {
      action: () => startAdd("card"),
      actionLabel: "Add",
      done: collection.length > 0,
      detail: "Start the collection ledger.",
      icon: <Plus size={16} />,
      label: "Track first item",
    },
    {
      action: () => startAdd("card"),
      actionLabel: "Add target",
      done: wishlist.length > 0,
      detail: "Save a card or sealed product you want next.",
      icon: <Heart size={16} />,
      label: "Add wishlist target",
    },
    {
      action: () => navigate("settings"),
      actionLabel: "Storage",
      done: hasNamedStorage,
      detail: "Name the binder, box, display, or safe.",
      icon: <MapPin size={16} />,
      label: "Set storage",
    },
    {
      action: () => navigate("sets"),
      actionLabel: "Sets",
      done: sets.some((set) => set.owned > 0),
      detail: "Use set progress as a collection goal.",
      icon: <GalleryVerticalEnd size={16} />,
      label: "Choose set focus",
    },
    {
      action: () =>
        setAppState((current) => ({
          ...current,
          collectionFilter: "unknown",
          collectionValueFilter: "unvalued",
          screen: "collection",
        })),
      actionLabel: "Review",
      done: collection.length > 0 && summary.unvalued === 0,
      detail: summary.unvalued ? `${summary.unvalued} lot${summary.unvalued === 1 ? "" : "s"} need a value.` : "All tracked lots have a value.",
      icon: <Bell size={16} />,
      label: "Close value gaps",
    },
  ];
  const completed = steps.filter((step) => step.done).length;
  const nextStep = steps.find((step) => !step.done);
  const isComplete = completed === steps.length;
  const [isDismissed, setIsDismissed] = useState(false);
  const dismissalStorageKey = `${betaSetupDismissedStorageKey}:${ownerEmail.trim().toLowerCase() || "local"}`;

  useEffect(() => {
    setIsDismissed(window.localStorage.getItem(dismissalStorageKey) === "1");
  }, [dismissalStorageKey]);

  function dismissSetup() {
    window.localStorage.setItem(dismissalStorageKey, "1");
    setIsDismissed(true);
  }

  if (isDismissed) {
    return null;
  }

  return (
    <section className="tool-panel onboarding-panel">
      <div className="panel-title-row">
        <div>
          <h2>Collection setup</h2>
          <p className="muted">{completed} of {steps.length} complete</p>
        </div>
        <div className="actions setup-panel-actions">
          <span className={isComplete ? "tag green" : "tag blue"}>
            {isComplete ? "Ready" : "Setup"}
          </span>
          <button className="icon-button setup-dismiss-button" type="button" onClick={dismissSetup} aria-label="Hide collection setup">
            <X size={16} />
          </button>
        </div>
      </div>
      <div className="setup-checklist-list">
        {steps.map((step) => (
          <article className={step.done ? "setup-checklist-row complete" : "setup-checklist-row"} key={step.label}>
            <span className="setup-checklist-status" aria-label={step.done ? "Complete" : "Open"}>
              {step.done ? <Check size={15} /> : step.icon}
            </span>
            <div>
              <strong>{step.label}</strong>
              <p className="muted">{step.detail}</p>
            </div>
            {!step.done ? (
              <button className="button small" type="button" onClick={step.action}>
                {step.actionLabel}
              </button>
            ) : null}
          </article>
        ))}
      </div>
      {nextStep ? (
        <button className="button primary full" type="button" onClick={nextStep.action}>
          {nextStep.icon}
          Continue setup
        </button>
      ) : null}
    </section>
  );
}

function CollectionScreen({
  appState,
  catalogueById,
  collection,
  collectionSearch,
  storageLocations,
  setAppState,
  setCollectionSearch,
  startAdd,
  navigate,
}: ScreenContext) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const filters: Array<[ScreenContext["appState"]["collectionFilter"], string]> = [
    ["all", "All"],
    ["card", "Cards"],
    ["sealed", "Sealed"],
    ["graded", "Graded"],
    ["unknown", "Unknown value"],
  ];

  const setOptions = uniqueValues(
    collection.map((item) => catalogueById.get(item.catalogueId)?.set ?? ""),
  ).sort((left, right) => left.localeCompare(right));
  const conditionOptions = uniqueValues(collection.map((item) => item.condition)).sort((left, right) =>
    left.localeCompare(right),
  );
  const languageOptions = uniqueValues(collection.map((item) => item.language)).sort((left, right) =>
    left.localeCompare(right),
  );
  const locationOptions = uniqueValues([
    ...storageLocations.map((location) => location.name),
    ...collection.map((item) => item.location),
  ]).sort((left, right) => left.localeCompare(right));
  const normalizedSearch = collectionSearch.trim().toLowerCase();
  const enrichedItems = collection.map((item, index) => {
    const catalogueItem = catalogueById.get(item.catalogueId);
    const value = getOwnedValue(item, catalogueItem);
    const gain = value === null ? null : value - (item.purchasePriceMinor ?? 0);

    return {
      catalogueItem,
      gain,
      index,
      item,
      value,
    };
  });
  const items = enrichedItems
    .filter(({ catalogueItem, gain, item, value }) => {
      if (!catalogueItem) {
        return false;
      }

      const matchesFilter =
        appState.collectionFilter === "all" ||
        catalogueItem.type === appState.collectionFilter ||
        (appState.collectionFilter === "graded" && item.grade !== "Raw" && item.grade !== "N/A") ||
        (appState.collectionFilter === "unknown" && value === null);
      const matchesAdvancedFilters =
        (appState.collectionSetFilter === "all" || catalogueItem.set === appState.collectionSetFilter) &&
        (appState.collectionConditionFilter === "all" || item.condition === appState.collectionConditionFilter) &&
        (appState.collectionLanguageFilter === "all" || item.language === appState.collectionLanguageFilter) &&
        (appState.collectionLocationFilter === "all" || item.location === appState.collectionLocationFilter) &&
        (appState.collectionValueFilter === "all" ||
          (appState.collectionValueFilter === "profit" && gain !== null && gain > 0) ||
          (appState.collectionValueFilter === "loss" && gain !== null && gain < 0) ||
          (appState.collectionValueFilter === "unvalued" && value === null) ||
          (appState.collectionValueFilter === "manual" && item.overrideValueMinor !== undefined) ||
          (appState.collectionValueFilter === "weak" &&
            item.overrideValueMinor === undefined &&
            catalogueItem.hasPrice &&
            catalogueItem.confidence === "Weak") ||
          (appState.collectionValueFilter === "high" && value !== null && value >= 10000));
      const matchesSearch =
        !normalizedSearch ||
        [
          catalogueItem.name,
          catalogueItemTitle(catalogueItem),
          catalogueItem.set,
          catalogueItemSetLabel(catalogueItem),
          catalogueItem.number,
          catalogueItem.rarity,
          item.condition,
          item.grade,
          item.language,
          item.location,
          item.notes ?? "",
          item.valuationNote ?? "",
          selectedVariantLabel(catalogueItem, item.variant),
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);

      return matchesFilter && matchesAdvancedFilters && matchesSearch;
    })
    .sort((left, right) => {
      const leftName = left.catalogueItem ? catalogueItemTitle(left.catalogueItem) : "";
      const rightName = right.catalogueItem ? catalogueItemTitle(right.catalogueItem) : "";

      if (appState.collectionSort === "value-asc") {
        return compareNullableNumbers(left.value, right.value, "asc");
      }

      if (appState.collectionSort === "name") {
        return leftName.localeCompare(rightName, undefined, {
          numeric: true,
        });
      }

      if (appState.collectionSort === "name-desc") {
        return rightName.localeCompare(leftName, undefined, {
          numeric: true,
        });
      }

      if (appState.collectionSort === "set") {
        return `${left.catalogueItem?.set ?? ""} ${left.catalogueItem?.number ?? ""}`.localeCompare(
          `${right.catalogueItem?.set ?? ""} ${right.catalogueItem?.number ?? ""}`,
          undefined,
          { numeric: true },
        );
      }

      if (appState.collectionSort === "set-desc") {
        return `${right.catalogueItem?.set ?? ""} ${right.catalogueItem?.number ?? ""}`.localeCompare(
          `${left.catalogueItem?.set ?? ""} ${left.catalogueItem?.number ?? ""}`,
          undefined,
          { numeric: true },
        );
      }

      if (appState.collectionSort === "gain-desc") {
        return compareNullableNumbers(right.gain, left.gain, "desc");
      }

      if (appState.collectionSort === "quantity-desc") {
        return right.item.quantity - left.item.quantity;
      }

      if (appState.collectionSort === "recent") {
        return right.index - left.index;
      }

      return compareNullableNumbers(right.value, left.value, "desc");
    })
    .map(({ item }) => item);
  const visibleValue = items.reduce(
    (total, item) => total + (getOwnedValue(item, catalogueById.get(item.catalogueId)) ?? 0),
    0,
  );
  const collectionValue = enrichedItems.reduce((total, row) => total + (row.value ?? 0), 0);
  const unvaluedCount = enrichedItems.filter((row) => row.value === null).length;
  const cardLots = enrichedItems.filter((row) => row.catalogueItem?.type === "card").length;
  const sealedLots = enrichedItems.filter((row) => row.catalogueItem?.type === "sealed").length;
  const activeFilterCount = [
    normalizedSearch.length > 0,
    appState.collectionFilter !== "all",
    appState.collectionSetFilter !== "all",
    appState.collectionConditionFilter !== "all",
    appState.collectionLanguageFilter !== "all",
    appState.collectionLocationFilter !== "all",
    appState.collectionValueFilter !== "all",
  ].filter(Boolean).length;

  function resetFilters() {
    setCollectionSearch("");
    setAppState((current) => ({
      ...current,
      collectionConditionFilter: "all",
      collectionFilter: "all",
      collectionLanguageFilter: "all",
      collectionLocationFilter: "all",
      collectionSetFilter: "all",
      collectionValueFilter: "all",
    }));
  }

  if (!collection.length) {
    return (
      <section className="page">
        <PageHeader
          title="Collection"
          action={
            <button className="button primary" onClick={() => startAdd("card")}>
              <Plus size={17} />
              Add item
            </button>
          }
        />
        <EmptyState
          title="Your collection is ready."
          description="Add a card, add a sealed product, or import a CSV when you already have a list."
          action={
            <div className="actions">
              <button className="button primary" onClick={() => startAdd("card")}>
                <Plus size={17} />
                Add card
              </button>
              <button className="button" onClick={() => startAdd("sealed")}>
                <PackagePlus size={17} />
                Add sealed
              </button>
              <button className="button" onClick={() => navigate("settings")}>
                <Upload size={17} />
                Import CSV
              </button>
            </div>
          }
        />
      </section>
    );
  }

  return (
    <section className="page">
      <PageHeader
        title="Collection"
        action={
          <>
            <button className="button" onClick={() => navigate("binders")}>
              <BookOpen size={17} />
              Binders
            </button>
            <button className="button primary" onClick={() => startAdd("card")}>
              <Plus size={17} />
              Add item
            </button>
          </>
        }
      />

      <div className="summary-strip collection-summary-strip">
        <span><small>Collection value</small><strong>{formatMoney(collectionValue)}</strong></span>
        <span><small>Lots</small><strong>{collection.length}</strong></span>
        <span><small>Cards / sealed</small><strong>{cardLots} / {sealedLots}</strong></span>
        <span><small>Needs estimate</small><strong>{unvaluedCount}</strong></span>
      </div>

      <div className="toolbar">
        <div className="collection-toolbar-head">
          <label className="search-box">
            <Search size={18} />
            <input
              value={collectionSearch}
              onChange={(event) => setCollectionSearch(event.target.value)}
              placeholder="Search name, set, grade, notes"
            />
          </label>
          <div className="toolbar-actions">
            <label className="sort-control compact-sort-control">
              <ArrowDownUp size={16} />
              <span className="sr-only">Sort collection</span>
              <select
                value={appState.collectionSort}
                onChange={(event) =>
                  setAppState((current) => ({
                    ...current,
                    collectionSort: event.target.value as AppState["collectionSort"],
                  }))
                }
              >
                <option value="value-desc">Value high to low</option>
                <option value="value-asc">Value low to high</option>
                <option value="gain-desc">Gain/loss</option>
                <option value="quantity-desc">Quantity</option>
                <option value="name">Name A-Z</option>
                <option value="name-desc">Name Z-A</option>
                <option value="set">Set number low to high</option>
                <option value="set-desc">Set number high to low</option>
                <option value="recent">Recently added</option>
              </select>
            </label>
            <button className="button" onClick={() => setFiltersOpen((open) => !open)}>
              <SlidersHorizontal size={17} />
              Filters{activeFilterCount ? ` (${activeFilterCount})` : ""}
            </button>
            <div className="segmented compact" aria-label="Collection view">
              <button
                className={appState.collectionView === "list" ? "active" : ""}
                aria-label="List view"
                onClick={() => setAppState((current) => ({ ...current, collectionView: "list" }))}
              >
                <List size={16} />
              </button>
              <button
                className={appState.collectionView === "grid" ? "active" : ""}
                aria-label="Grid view"
                onClick={() => setAppState((current) => ({ ...current, collectionView: "grid" }))}
              >
                <Grid2X2 size={16} />
              </button>
            </div>
          </div>
        </div>
        <div className="filter-row">
          {filters.map(([id, label]) => (
            <button
              key={id}
              className={appState.collectionFilter === id ? "filter-chip active" : "filter-chip"}
              onClick={() => setAppState((current) => ({ ...current, collectionFilter: id }))}
            >
              {label}
            </button>
          ))}
        </div>
        <p className="result-meta collection-result-meta">
          {items.length} of {collection.length} lots | {formatMoney(visibleValue)} visible value
        </p>
        {filtersOpen || activeFilterCount > 0 ? (
          <div className="filter-panel">
            <div className="field-grid">
              <Field label="Set">
                <select
                  value={appState.collectionSetFilter}
                  onChange={(event) =>
                    setAppState((current) => ({ ...current, collectionSetFilter: event.target.value }))
                  }
                >
                  <option value="all">All sets</option>
                  {setOptions.map((set) => (
                    <option key={set} value={set}>
                      {set}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Condition">
                <select
                  value={appState.collectionConditionFilter}
                  onChange={(event) =>
                    setAppState((current) => ({ ...current, collectionConditionFilter: event.target.value }))
                  }
                >
                  <option value="all">All conditions</option>
                  {conditionOptions.map((condition) => (
                    <option key={condition} value={condition}>
                      {condition}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Language">
                <select
                  value={appState.collectionLanguageFilter}
                  onChange={(event) =>
                    setAppState((current) => ({ ...current, collectionLanguageFilter: event.target.value }))
                  }
                >
                  <option value="all">All languages</option>
                  {languageOptions.map((language) => (
                    <option key={language} value={language}>
                      {language}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Storage">
                <select
                  value={appState.collectionLocationFilter}
                  onChange={(event) =>
                    setAppState((current) => ({ ...current, collectionLocationFilter: event.target.value }))
                  }
                >
                  <option value="all">All locations</option>
                  {locationOptions.map((location) => (
                    <option key={location} value={location}>
                      {location}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Value">
                <select
                  value={appState.collectionValueFilter}
                  onChange={(event) =>
                    setAppState((current) => ({
                      ...current,
                      collectionValueFilter: event.target.value as AppState["collectionValueFilter"],
                    }))
                  }
                >
                  <option value="all">All values</option>
                  <option value="profit">Gain</option>
                  <option value="loss">Loss</option>
                  <option value="high">£100+</option>
                  <option value="unvalued">Unknown value</option>
                  <option value="manual">Manual values</option>
                  <option value="weak">Weak confidence</option>
                </select>
              </Field>
            </div>
            <div className="filter-panel-footer">
              <p className="muted">Combine filters to find grading candidates, storage gaps, and high-value lots quickly.</p>
              <button className="button" onClick={resetFilters} disabled={!activeFilterCount}>
                <X size={17} />
                Reset
              </button>
            </div>
          </div>
        ) : null}
      </div>

      {items.length ? (
        appState.collectionView === "grid" ? (
          <div className="collection-grid">
            {items.map((item) => (
              <OwnedItemCard
                key={item.id}
                item={item}
                catalogueItem={catalogueById.get(item.catalogueId)}
                onClick={() => {
                  setAppState((current) => ({ ...current, selectedItemId: item.id }));
                  navigate("item");
                }}
              />
            ))}
          </div>
        ) : (
          <>
            <div className="mobile-list">
              {items.map((item) => (
                <OwnedItemCard
                  key={item.id}
                  item={item}
                  catalogueItem={catalogueById.get(item.catalogueId)}
                  onClick={() => {
                    setAppState((current) => ({ ...current, selectedItemId: item.id }));
                    navigate("item");
                  }}
                />
              ))}
            </div>
            <CollectionTable
              items={items}
              catalogueById={catalogueById}
              openItem={(id) => {
                setAppState((current) => ({ ...current, selectedItemId: id }));
                navigate("item");
              }}
            />
          </>
        )
      ) : (
        <EmptyState
          title="No matching items"
          description="Try clearing filters, or add the item if it is not in your collection yet."
          action={
            <div className="actions">
              <button className="button" onClick={resetFilters} disabled={!activeFilterCount}>
                <X size={17} />
                Reset filters
              </button>
              <button className="button primary" onClick={() => startAdd("card")}>
                <Plus size={17} />
                Add card
              </button>
            </div>
          }
        />
      )}
    </section>
  );
}

function BindersScreen({
  appState,
  beginBinderDraft,
  binderDraftProtected,
  binderNotice,
  catalogueById,
  collection,
  customBinders,
  isLoadingBinders,
  reloadBinders,
  clearBinderDraftProtection,
  discardBinderDraft,
  setAppState,
  setBinderMutationInFlight,
  setCustomBinders,
  showToast,
  startAdd,
  navigate,
}: ScreenContext) {
  const [isCreating, setIsCreating] = useState(false);
  const [isCreatingBinder, setIsCreatingBinder] = useState(false);
  const [isSavingBinder, setIsSavingBinder] = useState(false);
  const [isUpdatingBinderMetadata, setIsUpdatingBinderMetadata] = useState(false);
  const [isDeletingBinder, setIsDeletingBinder] = useState(false);
  const [binderSaveState, setBinderSaveState] = useState<"idle" | "dirty" | "saving" | "saved" | "error">(
    binderDraftProtected ? "dirty" : "idle",
  );
  const [binderSaveError, setBinderSaveError] = useState("");
  const [draftName, setDraftName] = useState("");
  const [draftArtworkId, setDraftArtworkId] = useState<BinderArtworkId>("mint");
  const [draftCopyCounts, setDraftCopyCounts] = useState<Record<string, number>>({});
  const [itemSearch, setItemSearch] = useState("");
  const [focusedItemId, setFocusedItemId] = useState<string | null>(null);
  const [isArranging, setIsArranging] = useState(false);
  const [liftedSlotIndex, setLiftedSlotIndex] = useState<number | null>(null);
  const [recentMoveSlotIndex, setRecentMoveSlotIndex] = useState<number | null>(null);
  const [openBinderId, setOpenBinderId] = useState<string | null>(null);
  const [visiblePageIndex, setVisiblePageIndex] = useState(0);
  const [isBinderOpening, setIsBinderOpening] = useState(false);
  const [pageTurnDirection, setPageTurnDirection] = useState<"next" | "previous" | null>(null);
  const [pullingSlotIndex, setPullingSlotIndex] = useState<number | null>(null);
  const pageTurnTimeoutRef = useRef<number | null>(null);
  const binderSaveStateRef = useRef(binderSaveState);
  const currentBinderDraftProtectedRef = useRef(binderDraftProtected);
  const reloadAfterBinderDraftRef = useRef(false);
  const swipeStartXRef = useRef<number | null>(null);
  binderSaveStateRef.current = binderSaveState;
  currentBinderDraftProtectedRef.current = binderDraftProtected;
  const isBinderSyncBlocked = isLoadingBinders || Boolean(binderNotice);
  const isBinderLayoutLocked =
    isLoadingBinders || isCreatingBinder || isSavingBinder || isUpdatingBinderMetadata || isDeletingBinder;
  const isMobileBinder = useMediaQuery("(max-width: 759px)");
  const availableItems = useMemo(
    () => collection.filter((item) => catalogueById.get(item.catalogueId)?.type === "card"),
    [catalogueById, collection],
  );
  const binders = useMemo(
    () => {
      const syncedBinders = binderSummaries(availableItems, customBinders);

      return shouldShowCollectionBinderFallback(syncedBinders.length, availableItems.length)
        ? [defaultBinderSummary(availableItems)]
        : syncedBinders;
    },
    [availableItems, customBinders],
  );
  const selectedBinder = useMemo(
    () =>
      binders.find((binder) => binder.id === appState.selectedBinderId) ??
      binders[0] ??
      defaultBinderSummary([]),
    [appState.selectedBinderId, binders],
  );
  const visibleItemIds = useMemo(() => new Set(availableItems.map((item) => item.id)), [availableItems]);
  const activeBinder = useMemo(
    () => (openBinderId ? binders.find((binder) => binder.id === openBinderId) ?? null : null),
    [binders, openBinderId],
  );
  const binderViewerRef = useDialogFocus<HTMLDivElement>(Boolean(activeBinder && !focusedItemId));
  const activeCustomBinder = useMemo(
    () => (activeBinder ? customBinders.find((binder) => binder.id === activeBinder.id) : undefined),
    [activeBinder, customBinders],
  );
  const activeBinderValue = activeBinder
    ? binderOccupiedCopiesValueMinor(
        activeBinder.items,
        (item) => getOwnedValue(item, catalogueById.get(item.catalogueId)),
      )
    : 0;
  const activeCardCount = activeBinder
    ? activeBinder.items.filter((item) => catalogueById.get(item.catalogueId)?.type === "card").length
    : 0;
  const totalLeafPages = Math.max(1, activeBinder?.pages.length ?? 1);
  const totalSpreads = Math.max(1, Math.ceil(totalLeafPages / 2));
  const totalPageViews = isMobileBinder ? totalLeafPages : totalSpreads;
  const boundedPageIndex = Math.min(visiblePageIndex, totalPageViews - 1);
  const currentPageStart = boundedPageIndex * (isMobileBinder ? 9 : 18);
  const nextPageStart = currentPageStart + 9;
  const leftPageNumber = isMobileBinder ? boundedPageIndex + 1 : boundedPageIndex * 2 + 1;
  const rightPageNumber = !isMobileBinder && leftPageNumber < totalLeafPages ? leftPageNumber + 1 : null;
  const normalizedItemSearch = normalizeSearchText(itemSearch);
  const pickerItems = useMemo(
    () =>
      availableItems
        .filter((item) => {
          const catalogueItem = catalogueById.get(item.catalogueId);
          const haystack = normalizeSearchText(
            [
              catalogueItem?.name,
              catalogueItem ? catalogueItemTitle(catalogueItem) : undefined,
              catalogueItem?.set,
              catalogueItem ? catalogueItemSetLabel(catalogueItem) : undefined,
              catalogueItem?.number,
              catalogueItem ? selectedVariantLabel(catalogueItem, item.variant) : item.variant,
              item.grade,
              item.location,
            ].filter(Boolean).join(" "),
          );

          return !normalizedItemSearch || haystack.includes(normalizedItemSearch);
        })
        .slice(0, 120),
    [availableItems, catalogueById, normalizedItemSearch],
  );
  const focusedItem = focusedItemId ? activeBinder?.items.find((item) => item.id === focusedItemId) : undefined;
  const focusedCatalogueItem = focusedItem ? catalogueById.get(focusedItem.catalogueId) : undefined;

  const turnBinderPages = useCallback((direction: "next" | "previous") => {
    if (pageTurnDirection || isBinderOpening) {
      return;
    }

    const nextSpread = direction === "next"
      ? Math.min(totalPageViews - 1, boundedPageIndex + 1)
      : Math.max(0, boundedPageIndex - 1);

    if (nextSpread === boundedPageIndex) {
      return;
    }

    setPageTurnDirection(direction);
    setVisiblePageIndex(nextSpread);

    if (pageTurnTimeoutRef.current !== null) {
      window.clearTimeout(pageTurnTimeoutRef.current);
    }

    pageTurnTimeoutRef.current = window.setTimeout(() => {
      setPageTurnDirection(null);
      pageTurnTimeoutRef.current = null;
    }, 720);
  }, [boundedPageIndex, isBinderOpening, pageTurnDirection, totalPageViews]);

  const closeBinderViewer = useCallback(() => {
    if (isBinderLayoutLocked) {
      showToast("Wait for the current binder save to finish before closing.", "error");
      return;
    }
    const hasDraft = binderSaveState === "dirty" || binderSaveState === "error";
    if (
      hasDraft &&
      !window.confirm("Close this binder without saving its latest layout changes?")
    ) {
      return;
    }

    if (hasDraft) {
      reloadAfterBinderDraftRef.current = false;
      discardBinderDraft();
    }
    setOpenBinderId(null);
    setBinderSaveState("idle");
    setBinderSaveError("");
    setIsArranging(false);
    setLiftedSlotIndex(null);
    setFocusedItemId(null);
    setPullingSlotIndex(null);
    if (reloadAfterBinderDraftRef.current) {
      reloadAfterBinderDraftRef.current = false;
      void reloadBinders({ quiet: true });
    }
  }, [binderSaveState, discardBinderDraft, isBinderLayoutLocked, reloadBinders, showToast]);

  useEffect(() => {
    if (binders.some((binder) => binder.id === appState.selectedBinderId)) {
      return;
    }

    const fallbackBinder = binders.find((binder) => binder.isDefault) ?? binders[0];
    setAppState((current) => ({ ...current, selectedBinderId: fallbackBinder?.id ?? "" }));
  }, [appState.selectedBinderId, binders, setAppState]);

  useEffect(() => {
    setIsArranging(false);
    setLiftedSlotIndex(null);
    setFocusedItemId(null);
    setPullingSlotIndex(null);
    setPageTurnDirection(null);
    setVisiblePageIndex(0);
    setBinderSaveState(currentBinderDraftProtectedRef.current ? "dirty" : "idle");
    setBinderSaveError("");

    if (!activeBinder?.id) {
      setIsBinderOpening(false);
      return;
    }

    setIsBinderOpening(true);
    const openingTimer = window.setTimeout(() => setIsBinderOpening(false), 920);

    return () => window.clearTimeout(openingTimer);
  }, [activeBinder?.id]);

  useEffect(() => {
    if (!openBinderId || binders.some((binder) => binder.id === openBinderId)) {
      return;
    }

    setOpenBinderId(null);
  }, [binders, openBinderId]);

  useEffect(() => {
    if (visiblePageIndex <= totalPageViews - 1) {
      return;
    }

    setVisiblePageIndex(Math.max(0, totalPageViews - 1));
  }, [totalPageViews, visiblePageIndex]);

  useEffect(() => () => {
    if (pageTurnTimeoutRef.current !== null) {
      window.clearTimeout(pageTurnTimeoutRef.current);
    }
  }, []);

  useEffect(() => {
    if (!activeBinder) {
      return;
    }

    function handleBinderKeyboard(event: KeyboardEvent) {
      if (focusedItemId) {
        return;
      }

      if (event.key === "ArrowLeft") {
        event.preventDefault();
        turnBinderPages("previous");
      }

      if (event.key === "ArrowRight") {
        event.preventDefault();
        turnBinderPages("next");
      }

      if (event.key === "Escape") {
        closeBinderViewer();
      }
    }

    window.addEventListener("keydown", handleBinderKeyboard);
    return () => window.removeEventListener("keydown", handleBinderKeyboard);
  }, [activeBinder, closeBinderViewer, focusedItemId, turnBinderPages]);

  function selectBinder(id: string) {
    setAppState((current) => ({ ...current, selectedBinderId: id }));
  }

  function refreshBindersSafely() {
    if (isBinderLayoutLocked) {
      showToast("Wait for the current binder save to finish before refreshing.", "error");
      return;
    }
    if (
      (binderSaveState === "dirty" || binderSaveState === "error") &&
      !window.confirm("Refresh binders and discard this unsaved layout draft?")
    ) {
      return;
    }

    if (binderSaveState === "dirty" || binderSaveState === "error") {
      setBinderSaveState("idle");
      setBinderSaveError("");
      reloadAfterBinderDraftRef.current = false;
      discardBinderDraft();
      return;
    }

    reloadBinders();
  }

  function openBinder(id: string) {
    selectBinder(id);
    setOpenBinderId(id);
    setVisiblePageIndex(0);
  }

  function setDraftBinderItemCopyCount(itemId: string, count: number) {
    const owned = collection.find((item) => item.id === itemId);
    const boundedCount = Math.max(0, Math.min(Math.floor(count), owned?.quantity ?? 0));
    setDraftCopyCounts((current) => {
      if (!boundedCount) {
        const next = { ...current };
        delete next[itemId];
        return next;
      }

      return { ...current, [itemId]: boundedCount };
    });
  }

  function setSelectedBinderItemCopyCount(itemId: string, count: number) {
    if (!activeCustomBinder || isBinderLayoutLocked) {
      return;
    }

    const owned = collection.find((item) => item.id === itemId);
    const boundedCount = Math.max(0, Math.min(Math.floor(count), owned?.quantity ?? 0));

    if (!owned) {
      setBinderSaveError("That card lot is no longer available. Refresh binders and try again.");
      return;
    }

    const existingSlots = activeCustomBinder.pages.flatMap((page) => page.slots)
      .filter((slot) => slot.collectionItemId === itemId);
    const managedDefault = !activeCustomBinder.managedDefault
      ? customBinders.find((binder) => binder.isDefault && binder.managedDefault)
      : undefined;
    const allocatableCopyIndexes = unassignedBinderCopyIndexes(
      owned,
      customBinders,
      [activeCustomBinder.id, ...(managedDefault ? [managedDefault.id] : [])],
    );
    const existingCopyIndexes = new Set(
      existingSlots
        .map((slot) => slot.copyIndex)
        .filter((copyIndex): copyIndex is number => Boolean(copyIndex)),
    );
    const newCopyIndexes = allocatableCopyIndexes
      .filter((copyIndex) => !existingCopyIndexes.has(copyIndex))
      .slice(0, Math.max(0, boundedCount - existingSlots.length));

    if (existingSlots.length + newCopyIndexes.length < boundedCount) {
      const message = "Those copies are already assigned to another custom binder.";
      setBinderSaveError(message);
      showToast(message, "error");
      return;
    }

    const pages = cloneBinderPages(activeCustomBinder.pages);
    const currentSlots = pages.flatMap((page) => page.slots)
      .filter((slot) => slot.collectionItemId === itemId);
    currentSlots.forEach((slot, index) => {
      if (index >= boundedCount) {
        Object.assign(slot, emptyBinderSlot(slot.position));
      }
    });
    const entries = newCopyIndexes.map((copyIndex) => ({ collectionItemId: itemId, copyIndex }));
    const appended = appendBinderEntriesToBlankSlots(
      pages,
      entries,
      activeCustomBinder.managedDefault ? MAX_MANAGED_BINDER_PAGES : MAX_STANDARD_BINDER_PAGES,
    );
    if (appended.placedCount !== entries.length) {
      const message = "This binder has no free pockets left.";
      setBinderSaveError(message);
      showToast(message, "error");
      return;
    }

    beginBinderDraft(customBinders);
    setCustomBinders((current) => current.map((binder) =>
      binder.id === activeCustomBinder.id ? { ...binder, pages: appended.pages } : binder,
    ));
    setBinderSaveState("dirty");
    setBinderSaveError("");
  }

  async function createBinder(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    if (isCreatingBinder || isBinderSyncBlocked) {
      if (isBinderSyncBlocked) {
        showToast("Wait for binder sync to finish before creating a custom binder.", "error");
      }
      return;
    }

    const name = draftName.trim();

    if (!name) {
      showToast("Binder needs a name.", "error");
      return;
    }

    const selectedDraftCopies = Object.entries(draftCopyCounts).filter(([, count]) => count > 0);
    if (!selectedDraftCopies.length) {
      showToast("Choose at least one card copy.", "error");
      return;
    }

    const managedDefault = customBinders.find((binder) => binder.isDefault && binder.managedDefault);
    const entries = selectedDraftCopies
      .filter(([id]) => visibleItemIds.has(id))
      .flatMap(([collectionItemId, count]) => {
        const owned = collection.find((item) => item.id === collectionItemId);
        if (!owned) return [];
        return unassignedBinderCopyIndexes(owned, customBinders, managedDefault?.id)
          .slice(0, count)
          .map((copyIndex) => ({ collectionItemId, copyIndex }));
      });
    const requestedCopyCount = selectedDraftCopies
      .filter(([id]) => visibleItemIds.has(id))
      .reduce((total, [, count]) => total + count, 0);

    if (!requestedCopyCount) {
      showToast("Choose at least one currently available card copy.", "error");
      return;
    }
    if (entries.length !== requestedCopyCount) {
      showToast("Some selected copies are already assigned to another custom binder.", "error");
      return;
    }
    if (entries.length > MAX_STANDARD_BINDER_PAGES * 9) {
      showToast(`A custom binder can hold at most ${MAX_STANDARD_BINDER_PAGES * 9} card copies.`, "error");
      return;
    }

    let created: CustomBinder | null = null;
    setIsCreatingBinder(true);
    setBinderMutationInFlight(true);
    try {
      created = await createServerBinder({
        artworkId: draftArtworkId,
        description: "A curated card binder.",
        name,
      });
      const binder = await replaceServerBinderLayout(created.id, buildBinderPages(entries), {
        expectedUpdatedAt: created.updatedAt,
        releaseConflictsFromDefaultBinderId: managedDefault?.id,
        releaseConflictsFromDefaultUpdatedAt: managedDefault?.updatedAt,
      });
      setCustomBinders((current) => [...current.map((item) => ({ ...item, isDefault: binder.isDefault ? false : item.isDefault })), binder]);
      setAppState((current) => ({ ...current, selectedBinderId: binder.id }));
      setOpenBinderId(binder.id);
      setVisiblePageIndex(0);
      setDraftName("");
      setDraftArtworkId("mint");
      setDraftCopyCounts({});
      setIsCreating(false);
      setBinderSaveState("saved");
      showToast(`${binder.name} created and synced.`);
      if (managedDefault) {
        void reloadBinders({ quiet: true });
      }
    } catch (error) {
      console.warn("Binder creation failed.", error);
      if (created) {
        try {
          await deleteServerBinder(created);
        } catch (cleanupError) {
          console.warn("Binder shell cleanup was not needed or could not complete safely.", cleanupError);
        }
      }
      showToast(error instanceof Error ? error.message : "Binder could not be created.", "error");
      void reloadBinders({ quiet: true });
    } finally {
      setIsCreatingBinder(false);
      setBinderMutationInFlight(false);
    }
  }

  async function updateActiveBinderAppearance(artworkId: BinderArtworkId) {
    if (!activeCustomBinder || isBinderLayoutLocked) {
      return;
    }

    setIsSavingBinder(true);
    setBinderMutationInFlight(true);
    try {
      const updated = await patchServerBinder(activeCustomBinder, {
        coverStyle: serverCoverStyleFromArtwork(artworkId),
      });
      setCustomBinders((current) => current.map((binder) =>
        binder.id === updated.id
          ? {
              ...updated,
              pages: binder.pages,
            }
          : binder,
      ));
      setBinderSaveError("");
      showToast("Binder artwork saved.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "Binder artwork could not be saved.";
      setBinderSaveError(message);
      showToast(message, "error");
    } finally {
      setIsSavingBinder(false);
      setBinderMutationInFlight(false);
    }
  }

  function handleBinderSlotClick(slot: BinderSummary["slots"][number] | undefined, slotIndex: number) {
    if (isBinderLayoutLocked) {
      return;
    }
    const item = slot?.item;
    if (!activeBinder || !isArranging) {
      if (item && pullingSlotIndex === null) {
        setPullingSlotIndex(slotIndex);
        window.setTimeout(() => {
          setFocusedItemId(item.id);
          setPullingSlotIndex(null);
        }, 360);
      }
      return;
    }

    if (liftedSlotIndex === null) {
      if (!item) {
        return;
      }

      setLiftedSlotIndex(slotIndex);
      return;
    }

    if (slotIndex === liftedSlotIndex) {
      setLiftedSlotIndex(null);
      return;
    }

    if (!activeCustomBinder) return;
    const pages = swapBinderSlots(activeCustomBinder.pages, liftedSlotIndex, slotIndex);
    beginBinderDraft(customBinders);
    setCustomBinders((current) => current.map((binder) => (binder.id === activeCustomBinder.id ? { ...binder, pages } : binder)));
    setBinderSaveState("dirty");
    setBinderSaveError("");
    setRecentMoveSlotIndex(slotIndex);
    window.setTimeout(() => setRecentMoveSlotIndex(null), 520);
    setLiftedSlotIndex(null);
  }

  async function saveActiveBinderLayout() {
    if (
      !activeCustomBinder ||
      !["dirty", "error"].includes(binderSaveState) ||
      isBinderLayoutLocked
    ) return;
    setIsSavingBinder(true);
    setBinderMutationInFlight(true);
    setBinderSaveState("saving");
    try {
      const managedDefault = !activeCustomBinder.isDefault
        ? customBinders.find((binder) => binder.isDefault && binder.managedDefault)
        : undefined;
      const updated = await replaceServerBinderLayout(activeCustomBinder.id, activeCustomBinder.pages, {
        expectedUpdatedAt: activeCustomBinder.updatedAt,
        releaseConflictsFromDefaultBinderId: managedDefault?.id,
        releaseConflictsFromDefaultUpdatedAt: managedDefault?.updatedAt,
      });
      setCustomBinders((current) => current.map((binder) => (binder.id === updated.id ? updated : binder)));
      setBinderSaveState("saved");
      setBinderSaveError("");
      clearBinderDraftProtection();
      reloadAfterBinderDraftRef.current = false;
      showToast("Binder layout saved across devices.");
      void reloadBinders({ quiet: true });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Binder layout could not be saved.";
      setBinderSaveState("error");
      setBinderSaveError(message);
      showToast(message, "error");
    } finally {
      setIsSavingBinder(false);
      setBinderMutationInFlight(false);
    }
  }

  async function deleteSelectedBinder() {
    if (!activeCustomBinder || isBinderLayoutLocked) {
      return;
    }

    if (customBinders.length <= 1) {
      showToast("Create another binder before deleting your only binder.", "error");
      return;
    }

    if (!window.confirm(`Delete ${activeCustomBinder.name}? This only removes the custom binder, not the card lots.`)) {
      return;
    }

    setIsDeletingBinder(true);
    setBinderMutationInFlight(true);
    try {
      await deleteServerBinder(activeCustomBinder);
      const remaining = customBinders.filter((binder) => binder.id !== activeCustomBinder.id);
      const replacement = activeCustomBinder.isDefault
        ? [...remaining].sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0]
        : remaining.find((binder) => binder.isDefault) ?? remaining[0];
      setCustomBinders(remaining.map((binder) => ({
        ...binder,
        isDefault: activeCustomBinder.isDefault ? binder.id === replacement?.id : binder.isDefault,
      })));
      setAppState((current) => ({ ...current, selectedBinderId: replacement?.id ?? "" }));
      setBinderSaveState("idle");
      setBinderSaveError("");
      clearBinderDraftProtection();
      setOpenBinderId(null);
      showToast(`${activeCustomBinder.name} removed.`);
      void reloadBinders({ quiet: true });
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Binder could not be deleted.", "error");
    } finally {
      setIsDeletingBinder(false);
      setBinderMutationInFlight(false);
    }
  }

  if (!availableItems.length) {
    return (
      <section className="page">
        <PageHeader
          title="Binders"
          action={
            <button className="button primary" onClick={() => startAdd("card")}>
              <Plus size={17} />
              Add card
            </button>
          }
        />
        <EmptyState
          title="Your first binder is waiting."
          description="Add cards to your collection and Mint Binder will build the full collection binder automatically."
          action={
            <button className="button primary" onClick={() => startAdd("card")}>
              <Plus size={17} />
              Add first card
            </button>
          }
        />
      </section>
    );
  }

  return (
    <section className="page binders-page">
      <PageHeader
        title="Binders"
        action={
          <>
            <button className="button" disabled={isLoadingBinders || isBinderLayoutLocked} onClick={refreshBindersSafely}>
              <RefreshCw className={isLoadingBinders ? "spin" : ""} size={17} />
              {isLoadingBinders ? "Syncing" : "Refresh"}
            </button>
            <button className="button" onClick={() => navigate("collection")}>
              <Layers3 size={17} />
              Collection
            </button>
            <button
              className="button primary"
              disabled={isBinderSyncBlocked}
              onClick={() => setIsCreating((open) => !open)}
            >
              <BookOpen size={17} />
              New binder
            </button>
          </>
        }
      />

      {binderNotice ? (
        <div className="data-error-state" role="alert">
          <p>{binderNotice} Your legacy browser copy has not been removed.</p>
          <button className="button small" type="button" onClick={refreshBindersSafely}>
            <RefreshCw size={16} />
            Retry binder sync
          </button>
        </div>
      ) : null}

      <section className="binder-library-intro">
        <div>
          <p className="eyebrow">Your collection, shelved</p>
          <h2>Choose a binder and open it.</h2>
          <p>Browse card sleeves like a physical collection. Turn pages, inspect a card, or enter arrange mode to move it between pockets.</p>
        </div>
        <div className="binder-library-stats" aria-label="Binder library summary">
          <span><strong>{isLoadingBinders ? "…" : binders.length}</strong> binder{binders.length === 1 ? "" : "s"}</span>
          <span><strong>{availableItems.length}</strong> card lots</span>
        </div>
      </section>

      <section className="binder-shelf" aria-label="Binder shelf">
        {binders.map((binder) => (
          <button
            className={binder.id === selectedBinder.id ? "binder-cover selected" : "binder-cover"}
            key={binder.id}
            onClick={() => openBinder(binder.id)}
            style={binderArtworkStyle(binder.artworkId)}
            type="button"
          >
            <span className="binder-cover-spine" />
            <span className="binder-cover-rivets" aria-hidden="true" />
            <span className="binder-cover-kicker">{binder.isDefault ? "Master collection" : "Curated binder"}</span>
            <span className="binder-cover-icon"><Sparkles size={23} /></span>
            <span className="binder-cover-preview" aria-hidden="true">
              {binder.items.slice(0, 3).map((item, index) => {
                const catalogueItem = catalogueById.get(item.catalogueId);

                return catalogueItem ? (
                  <span className={`binder-cover-card card-${index + 1}`} key={`${item.id}-${index}`}>
                    {renderItemImage(catalogueItem)}
                  </span>
                ) : null;
              })}
            </span>
            <span className="binder-cover-label">
              <strong>{binder.name}</strong>
              <span>{binder.items.length} card cop{binder.items.length === 1 ? "y" : "ies"}</span>
            </span>
            <span className="binder-cover-open">Open <ArrowRight size={13} /></span>
          </button>
        ))}
      </section>

      {isCreating ? (
        <section className="tool-panel binder-builder-panel">
          <div className="panel-title-row">
            <div>
              <h2>Create custom binder</h2>
              <p className="muted">Pick artwork, then choose card lots for this binder.</p>
            </div>
            <button className="icon-button" type="button" onClick={() => setIsCreating(false)} aria-label="Close custom binder form">
              <X size={17} />
            </button>
          </div>
          <form className="binder-builder-grid" onSubmit={createBinder}>
            <div className="binder-builder-fields">
              <Field label="Binder name">
                <input value={draftName} onChange={(event) => setDraftName(event.target.value)} placeholder="Trade binder" required />
              </Field>
              <Field label="Artwork">
                <div className="binder-artwork-grid" role="radiogroup" aria-label="Binder artwork">
                  {binderArtworkOptions.map((artwork) => (
                    <button
                      aria-checked={draftArtworkId === artwork.id}
                      className={draftArtworkId === artwork.id ? "binder-artwork-option selected" : "binder-artwork-option"}
                      key={artwork.id}
                      onClick={() => setDraftArtworkId(artwork.id)}
                      role="radio"
                      style={binderArtworkStyle(artwork.id)}
                      type="button"
                    >
                      <Paintbrush size={15} />
                      <span>{artwork.name}</span>
                    </button>
                  ))}
                </div>
              </Field>
              <button
                className="button primary full"
                type="submit"
                disabled={isCreatingBinder || isBinderSyncBlocked}
              >
                <Check size={17} />
                {isCreatingBinder ? "Creating and syncing" : "Create binder"}
              </button>
            </div>
            <BinderItemPicker
              catalogueById={catalogueById}
              itemSearch={itemSearch}
              items={pickerItems}
              selectedCopyCounts={draftCopyCounts}
              onItemSearchChange={setItemSearch}
              onSetItemCopyCount={setDraftBinderItemCopyCount}
            />
          </form>
        </section>
      ) : null}

      {activeBinder ? (
        <section className="binder-viewer-backdrop" onClick={closeBinderViewer} role="presentation">
          <div
            aria-label={`${activeBinder.name} binder`}
            aria-modal="true"
            className={isBinderOpening ? "binder-viewer opening" : "binder-viewer"}
            onClick={(event) => event.stopPropagation()}
            ref={binderViewerRef}
            role="dialog"
            tabIndex={-1}
          >
            <div className="binder-viewer-topbar">
              <button className="button small" type="button" onClick={closeBinderViewer}>
                <ArrowLeft size={16} />
                Library
              </button>
              <div>
                <p className="eyebrow">{activeBinder.isDefault ? "Default binder" : "Custom binder"}</p>
                <h2>{activeBinder.name}</h2>
              </div>
              <button className="icon-button" type="button" onClick={closeBinderViewer} aria-label="Close binder viewer">
                <X size={18} />
              </button>
            </div>

            <div className="binder-viewer-grid">
              <div className="binder-stage" style={binderStageStyle(activeBinder.artworkId, activeBinder.interiorId)}>
                <div className="binder-stage-header">
                  <div>
                    <p className="eyebrow">{activeBinder.isDefault ? "Full card collection" : "Selected binder"}</p>
                    <h2>{activeBinder.name}</h2>
                    <p className="muted">{activeBinder.description}</p>
                  </div>
                  <div className="binder-stage-stats">
                    <span>{formatMoney(activeBinderValue)}</span>
                    <small>{activeCardCount} cards</small>
                  </div>
                </div>

                <div className="binder-arrange-bar">
                  <button
                    className={isArranging ? "button primary small" : "button small"}
                    disabled={!activeCustomBinder || isBinderLayoutLocked}
                    type="button"
                    onClick={() => {
                      setIsArranging((current) => !current);
                      setLiftedSlotIndex(null);
                    }}
                  >
                    <ArrowDownUp size={15} />
                    {isSavingBinder
                      ? "Saving layout"
                      : isArranging
                        ? "Finish arranging"
                        : activeCustomBinder
                          ? "Arrange cards"
                          : "Layout syncing"}
                  </button>
                  <span>
                    {isArranging
                      ? liftedSlotIndex !== null
                        ? "Choose a sleeve to place the lifted card."
                        : "Click a card to lift it out of its sleeve."
                      : "Move cards between sleeves without opening the lot modal."}
                  </span>
                </div>

                <div className="binder-page-toolbar">
                  <button
                    className="button small"
                    disabled={boundedPageIndex === 0 || Boolean(pageTurnDirection) || isBinderOpening}
                    onClick={() => turnBinderPages("previous")}
                    type="button"
                  >
                    <ArrowLeft size={15} />
                    Previous
                  </button>
                  <span>
                    Pages {leftPageNumber}{rightPageNumber ? `–${rightPageNumber}` : ""}
                    <small> of {totalLeafPages}</small>
                  </span>
                  <button
                    className="button small"
                    disabled={boundedPageIndex >= totalPageViews - 1 || Boolean(pageTurnDirection) || isBinderOpening}
                    onClick={() => turnBinderPages("next")}
                    type="button"
                  >
                    Next
                    <ArrowRight size={15} />
                  </button>
                </div>

                <div className="binder-book-shell">
                  <div className="binder-opening-cover" aria-hidden="true">
                    <span className="binder-opening-spine" />
                    <span className="binder-opening-mark"><Sparkles size={28} /></span>
                    <strong>{activeBinder.name}</strong>
                    <small>{activeCardCount} cards</small>
                  </div>
                  <button
                    aria-label="Turn to previous binder pages"
                    className="binder-page-turn previous"
                    disabled={boundedPageIndex === 0 || Boolean(pageTurnDirection) || isBinderOpening}
                    onClick={() => turnBinderPages("previous")}
                    type="button"
                  >
                    <ArrowLeft size={22} />
                  </button>
                  <div
                    className={[
                      "binder-book",
                      isArranging ? "arranging" : "",
                      pageTurnDirection ? `turning-${pageTurnDirection}` : "",
                    ].filter(Boolean).join(" ")}
                    key={`${activeBinder.id}-${boundedPageIndex}-${pageTurnDirection ?? "still"}`}
                    aria-label={`${activeBinder.name}, pages ${leftPageNumber}${rightPageNumber ? ` and ${rightPageNumber}` : ""}`}
                    onPointerDown={(event) => {
                      if (isMobileBinder && event.pointerType === "touch") swipeStartXRef.current = event.clientX;
                    }}
                    onPointerUp={(event) => {
                      if (!isMobileBinder || swipeStartXRef.current === null) return;
                      const distance = event.clientX - swipeStartXRef.current;
                      swipeStartXRef.current = null;
                      if (Math.abs(distance) < 48) return;
                      turnBinderPages(distance < 0 ? "next" : "previous");
                    }}
                  >
                    <BinderPage
                      catalogueById={catalogueById}
                      slots={activeBinder.slots.slice(currentPageStart, currentPageStart + 9)}
                      isArranging={isArranging}
                      liftedSlotIndex={liftedSlotIndex}
                      offset={currentPageStart}
                      pageNumber={leftPageNumber}
                      pageRole="primary"
                      pullingSlotIndex={pullingSlotIndex}
                      recentMoveSlotIndex={recentMoveSlotIndex}
                      onSlotClick={handleBinderSlotClick}
                      isLocked={isBinderLayoutLocked}
                    />
                    <span className="binder-ring-strip" aria-hidden="true">
                      {Array.from({ length: 6 }, (_, index) => (
                        <span className="binder-ring" key={index} />
                      ))}
                    </span>
                    <BinderPage
                      catalogueById={catalogueById}
                      slots={activeBinder.slots.slice(nextPageStart, nextPageStart + 9)}
                      isArranging={isArranging}
                      liftedSlotIndex={liftedSlotIndex}
                      offset={nextPageStart}
                      pageNumber={rightPageNumber}
                      pageRole="secondary"
                      pullingSlotIndex={pullingSlotIndex}
                      recentMoveSlotIndex={recentMoveSlotIndex}
                      onSlotClick={handleBinderSlotClick}
                      isLocked={isBinderLayoutLocked}
                    />
                  </div>
                  <button
                    aria-label="Turn to next binder pages"
                    className="binder-page-turn next"
                    disabled={boundedPageIndex >= totalPageViews - 1 || Boolean(pageTurnDirection) || isBinderOpening}
                    onClick={() => turnBinderPages("next")}
                    type="button"
                  >
                    <ArrowRight size={22} />
                  </button>
                  <div className="binder-page-dots" aria-hidden="true">
                    {Array.from({ length: totalPageViews }, (_, index) => (
                      <span className={index === boundedPageIndex ? "active" : ""} key={index} />
                    ))}
                  </div>
                </div>
              </div>

              <aside className="tool-panel binder-side-panel binder-viewer-panel">
                <div className="panel-title-row">
                  <h2>{activeBinder.isDefault ? "Full card collection" : "Binder settings"}</h2>
                  {activeCustomBinder ? (
                    <button
                      className="button small danger"
                      disabled={isBinderLayoutLocked || customBinders.length <= 1}
                      onClick={() => void deleteSelectedBinder()}
                      title={customBinders.length <= 1 ? "Create another binder before deleting your only binder." : undefined}
                      type="button"
                    >
                      <Trash2 size={15} />
                      {isDeletingBinder ? "Deleting" : "Delete"}
                    </button>
                  ) : null}
                </div>

                <div className="binder-summary-list">
                  <MetricList
                    rows={[
                      ["Filled pockets", activeBinder.items.length],
                      ["Estimated value", formatMoney(activeBinderValue)],
                      ["Cards", activeCardCount],
                    ]}
                  />
                  <p className="muted">
                    {activeCustomBinder
                      ? "Layout, blank pockets, and copy numbers sync securely across your signed-in devices."
                      : "You can browse the collection now. Layout editing unlocks as soon as secure binder sync completes."}
                  </p>
                </div>

                <BinderSyncControls
                  binder={activeCustomBinder}
                  error={binderSaveError}
                  isBusy={isSavingBinder}
                  onBinderChange={(updated) => {
                    setCustomBinders((current) => current.map((binder) =>
                      binder.id === updated.id
                        ? {
                            ...updated,
                            pages: binder.pages,
                          }
                        : { ...binder, isDefault: updated.isDefault ? false : binder.isDefault },
                    ));
                    if (updated.isDefault) {
                      if (["dirty", "error", "saving"].includes(binderSaveStateRef.current)) {
                        reloadAfterBinderDraftRef.current = true;
                      } else {
                        void reloadBinders({ quiet: true });
                      }
                    }
                  }}
                  onError={(message) => {
                    setBinderSaveError(message);
                    showToast(message, "error");
                  }}
                  onSaveLayout={() => void saveActiveBinderLayout()}
                  onUpdatingChange={(updating) => {
                    setIsUpdatingBinderMetadata(updating);
                    setBinderMutationInFlight(updating);
                  }}
                  saveState={binderSaveState}
                  showToast={showToast}
                />

                <div className="binder-appearance-editor">
                  <Field label="Outside artwork">
                    <div className="binder-artwork-grid compact" role="radiogroup" aria-label="Selected binder artwork">
                      {binderArtworkOptions.map((artwork) => (
                        <button
                          aria-checked={activeBinder.artworkId === artwork.id}
                          className={activeBinder.artworkId === artwork.id ? "binder-artwork-option selected" : "binder-artwork-option"}
                          key={artwork.id}
                        disabled={!activeCustomBinder || isBinderLayoutLocked}
                          onClick={() => void updateActiveBinderAppearance(artwork.id)}
                          role="radio"
                          style={binderArtworkStyle(artwork.id)}
                          type="button"
                        >
                          <Paintbrush size={15} />
                          <span>{artwork.name}</span>
                        </button>
                      ))}
                    </div>
                  </Field>
                </div>

                {activeCustomBinder ? (
                  <BinderItemPicker
                    catalogueById={catalogueById}
                    itemSearch={itemSearch}
                    items={pickerItems}
                    selectedCopyCounts={binderCopyCounts(activeCustomBinder.pages)}
                    onItemSearchChange={setItemSearch}
                    onSetItemCopyCount={setSelectedBinderItemCopyCount}
                    disabled={isBinderLayoutLocked}
                  />
                ) : null}
              </aside>
            </div>
          </div>
        </section>
      ) : null}

      {focusedItem && focusedCatalogueItem ? (
        <BinderFocusModal
          catalogueItem={focusedCatalogueItem}
          item={focusedItem}
          onClose={() => setFocusedItemId(null)}
          onOpenItem={() => {
            setAppState((current) => ({ ...current, selectedItemId: focusedItem.id }));
            navigate("item");
          }}
        />
      ) : null}
    </section>
  );
}

function BinderPage({
  catalogueById,
  isArranging,
  isLocked,
  slots,
  liftedSlotIndex,
  offset,
  pageNumber,
  pageRole,
  pullingSlotIndex,
  recentMoveSlotIndex,
  onSlotClick,
}: {
  catalogueById: Map<string, CatalogueItem>;
  isArranging: boolean;
  isLocked: boolean;
  slots: BinderSummary["slots"];
  liftedSlotIndex: number | null;
  offset: number;
  pageNumber: number | null;
  pageRole?: "primary" | "secondary";
  pullingSlotIndex: number | null;
  recentMoveSlotIndex: number | null;
  onSlotClick: (slot: BinderSummary["slots"][number] | undefined, slotIndex: number) => void;
}) {
  const visibleSlots = Array.from({ length: 9 }, (_, index) => slots[index]);

  return (
    <div className={pageRole ? `binder-page ${pageRole}` : "binder-page"}>
      <span className="binder-page-number" aria-hidden="true">{pageNumber ?? ""}</span>
      {visibleSlots.map((slot, index) => {
        const item = slot?.item;
        const catalogueItem = item ? catalogueById.get(item.catalogueId) : undefined;
        const isFilled = Boolean(item && catalogueItem);
        const globalSlotIndex = offset + index;
        const isLifted = Boolean(item && globalSlotIndex === liftedSlotIndex);
        const isMoved = Boolean(item && globalSlotIndex === recentMoveSlotIndex);
        const isPulling = Boolean(item && globalSlotIndex === pullingSlotIndex);
        const isDropTarget = Boolean(isArranging && liftedSlotIndex !== null && globalSlotIndex !== liftedSlotIndex);
        const pocketClassName = [
          "binder-pocket",
          isFilled ? "filled" : "",
          isArranging ? "arranging" : "",
          isLifted ? "lifted" : "",
          isMoved ? "moved" : "",
          isPulling ? "pulling" : "",
          isDropTarget ? "drop-target" : "",
        ].filter(Boolean).join(" ");

        return (
          <button
            aria-label={
              item && catalogueItem
                ? isArranging
                  ? `${isLifted ? "Return" : "Move"} ${catalogueItemTitle(catalogueItem)}`
                  : `Open ${catalogueItemTitle(catalogueItem)}`
                : isDropTarget
                  ? `Place lifted card into slot ${offset + index + 1}`
                  : `Empty binder sleeve ${offset + index + 1}`
            }
            className={pocketClassName}
            disabled={isLocked || (!isFilled && !isDropTarget)}
            key={`${globalSlotIndex}-${slot?.collectionItemId ?? "empty"}-${slot?.copyIndex ?? 0}`}
            onClick={() => onSlotClick(slot, globalSlotIndex)}
            type="button"
          >
            {item && catalogueItem ? (
              <>
                <span className="binder-pocket-image">
                  {renderItemImage(catalogueItem)}
                  <span className="binder-pocket-glint" aria-hidden="true" />
                </span>
                <span className="binder-pocket-caption">
                  <strong>{catalogueItemTitle(catalogueItem)}</strong>
                  <small>{selectedVariantLabel(catalogueItem, item.variant)}{slot?.copyIndex ? ` · Copy ${slot.copyIndex}` : ""}</small>
                </span>
              </>
            ) : (
              <span className="binder-empty-slot">{isDropTarget ? "Place" : "Empty"}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

function BinderSyncControls({
  binder,
  error,
  isBusy,
  onBinderChange,
  onError,
  onSaveLayout,
  onUpdatingChange,
  saveState,
  showToast,
}: {
  binder?: CustomBinder;
  error: string;
  isBusy: boolean;
  onBinderChange: (binder: CustomBinder) => void;
  onError: (message: string) => void;
  onSaveLayout: () => void;
  onUpdatingChange: (updating: boolean) => void;
  saveState: "idle" | "dirty" | "saving" | "saved" | "error";
  showToast: (message: string, tone?: ToastTone) => void;
}) {
  const [name, setName] = useState(binder?.name ?? "");
  const [description, setDescription] = useState(binder?.description ?? "");
  const [isUpdating, setIsUpdating] = useState(false);

  useEffect(() => {
    setName(binder?.name ?? "");
    setDescription(binder?.description ?? "");
  }, [binder?.description, binder?.id, binder?.name]);

  if (!binder) return null;

  async function updateMetadata(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!binder || isUpdating || isBusy) return;
    setIsUpdating(true);
    onUpdatingChange(true);
    try {
      const updated = await patchServerBinder(binder, { description, name });
      onBinderChange(updated);
      showToast("Binder details saved.");
    } catch (updateError) {
      onError(updateError instanceof Error ? updateError.message : "Binder details could not be saved.");
    } finally {
      setIsUpdating(false);
      onUpdatingChange(false);
    }
  }

  async function updateAccess(next: Partial<{ isDefault: boolean; visibility: BinderVisibility }>) {
    if (!binder || isUpdating || isBusy) return;
    if (next.isDefault && ["dirty", "error", "saving"].includes(saveState)) {
      onError("Save or discard the layout draft before making this the default binder.");
      return;
    }
    setIsUpdating(true);
    onUpdatingChange(true);
    try {
      const updated = await patchServerBinder(binder, next);
      onBinderChange(updated);
      showToast(next.isDefault ? "Default binder updated." : updated.visibility === "unlisted" ? "Private sharing link enabled." : "Binder is private again.");
    } catch (updateError) {
      onError(updateError instanceof Error ? updateError.message : "Binder access could not be updated.");
    } finally {
      setIsUpdating(false);
      onUpdatingChange(false);
    }
  }

  async function copyShareLink() {
    if (!binder?.shareSlug) return;
    const relativeUrl = `/shared/binders/${binder.shareSlug}`;
    const url = typeof window === "undefined" ? relativeUrl : `${window.location.origin}${relativeUrl}`;
    try {
      await navigator.clipboard.writeText(url);
      showToast("Private binder link copied.");
    } catch {
      onError("The share link could not be copied. Open it and copy the browser address instead.");
    }
  }

  const sharePath = binder.shareSlug ? `/shared/binders/${binder.shareSlug}` : "";
  const statusLabel = saveState === "dirty"
    ? "Unsaved layout changes"
    : saveState === "saving"
      ? "Saving layout"
      : saveState === "saved"
        ? "Saved across devices"
        : saveState === "error"
          ? "Save failed"
          : "Synced";

  return (
    <section className="binder-sync-panel" aria-label="Binder sync and sharing">
      <div className="binder-save-row">
        <span className={`binder-save-state ${saveState}`} role="status">{statusLabel}</span>
        <button className="button primary small" type="button" disabled={!["dirty", "error"].includes(saveState) || isBusy || isUpdating} onClick={onSaveLayout}>
          <Save size={15} />
          {saveState === "error" ? "Retry save" : "Save layout"}
        </button>
      </div>
      {error ? <p className="binder-save-error" role="alert">{error}</p> : null}
      <form className="form-stack" onSubmit={updateMetadata}>
        <Field label="Binder name">
          <input value={name} maxLength={80} onChange={(event) => setName(event.target.value)} required />
        </Field>
        <Field label="Description">
          <textarea value={description} maxLength={500} onChange={(event) => setDescription(event.target.value)} placeholder="What belongs in this binder?" />
        </Field>
        <button className="button small" type="submit" disabled={isUpdating || isBusy || (!name.trim())}>
          <Check size={15} />
          {isUpdating ? "Saving" : "Save details"}
        </button>
      </form>
      <div className="binder-access-controls">
        <button
          className="button small"
          type="button"
          disabled={binder.isDefault || isUpdating || isBusy || ["dirty", "error", "saving"].includes(saveState)}
          onClick={() => void updateAccess({ isDefault: true })}
          title={["dirty", "error", "saving"].includes(saveState) ? "Save or discard layout changes first." : undefined}
        >
          <BookOpen size={15} />
          {binder.isDefault ? "Default binder" : "Make default"}
        </button>
        <button
          className={binder.visibility === "unlisted" ? "button small primary" : "button small"}
          type="button"
          disabled={isUpdating || isBusy}
          onClick={() => void updateAccess({ visibility: binder.visibility === "unlisted" ? "private" : "unlisted" })}
        >
          <Share2 size={15} />
          {binder.visibility === "unlisted" ? "Disable sharing" : "Create private link"}
        </button>
      </div>
      {binder.visibility === "unlisted" && sharePath ? (
        <div className="binder-share-link">
          <code>{sharePath}</code>
          <button className="icon-button" type="button" onClick={() => void copyShareLink()} aria-label="Copy binder share link">
            <Copy size={16} />
          </button>
          <a className="icon-button" href={sharePath} target="_blank" rel="noreferrer" aria-label="Open shared binder">
            <ExternalLink size={16} />
          </a>
          <small>Anyone with this hard-to-guess link can view the binder. It is not publicly listed.</small>
        </div>
      ) : null}
    </section>
  );
}

function BinderItemPicker({
  catalogueById,
  disabled = false,
  itemSearch,
  items,
  selectedCopyCounts,
  onItemSearchChange,
  onSetItemCopyCount,
}: {
  catalogueById: Map<string, CatalogueItem>;
  disabled?: boolean;
  itemSearch: string;
  items: CollectionItem[];
  selectedCopyCounts: Record<string, number>;
  onItemSearchChange: (value: string) => void;
  onSetItemCopyCount: (itemId: string, count: number) => void;
}) {
  return (
    <div className="binder-picker">
      <label className="search-box">
        <Search size={17} />
        <input disabled={disabled} value={itemSearch} onChange={(event) => onItemSearchChange(event.target.value)} placeholder="Search owned cards" />
      </label>
      <div className="binder-picker-list">
        {items.map((item) => {
          const catalogueItem = catalogueById.get(item.catalogueId);

          if (!catalogueItem) {
            return null;
          }

          const selectedCount = Math.min(item.quantity, selectedCopyCounts[item.id] ?? 0);

          return (
            <div className={selectedCount ? "binder-picker-row selected" : "binder-picker-row"} key={item.id}>
              <span className="item-image binder-picker-image">{renderItemImage(catalogueItem)}</span>
              <span className="binder-picker-copy-details">
                <strong>{catalogueItemTitle(catalogueItem)}</strong>
                <small>{catalogueItemSetLabel(catalogueItem)} | {selectedVariantLabel(catalogueItem, item.variant)} | {item.grade}</small>
              </span>
              <div className="binder-copy-stepper" aria-label={`Copies of ${catalogueItemTitle(catalogueItem)} in binder`}>
                <button
                  aria-label={`Remove one copy of ${catalogueItemTitle(catalogueItem)}`}
                  className="icon-button"
                  disabled={disabled || selectedCount === 0}
                  onClick={() => onSetItemCopyCount(item.id, selectedCount - 1)}
                  type="button"
                >
                  <Minus size={15} />
                </button>
                <output aria-live="polite">{selectedCount} / {item.quantity}</output>
                <button
                  aria-label={`Add one copy of ${catalogueItemTitle(catalogueItem)}`}
                  className="icon-button"
                  disabled={disabled || selectedCount >= item.quantity}
                  onClick={() => onSetItemCopyCount(item.id, selectedCount + 1)}
                  type="button"
                >
                  <Plus size={15} />
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function BinderFocusModal({
  catalogueItem,
  item,
  onClose,
  onOpenItem,
}: {
  catalogueItem: CatalogueItem;
  item: CollectionItem;
  onClose: () => void;
  onOpenItem: () => void;
}) {
  const value = getOwnedValue(item, catalogueItem);
  const dialogRef = useDialogFocus<HTMLElement>(true);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="card-zoom-backdrop binder-focus-backdrop" onClick={onClose} role="presentation">
      <article
        aria-label={`${catalogueItemTitle(catalogueItem)} binder card`}
        aria-modal="true"
        className="binder-focus-card"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <button className="icon-button card-zoom-close" type="button" onClick={onClose} aria-label="Close binder card">
          <X size={18} />
        </button>
        <div className="binder-focus-image">{renderItemImage(catalogueItem)}</div>
        <div className="binder-focus-copy">
          <h2>{catalogueItemTitle(catalogueItem)}</h2>
          <p>{catalogueItemSetLabel(catalogueItem)} | No. {catalogueItem.number}</p>
          <div className="tag-row">
            <span className="tag">{selectedVariantLabel(catalogueItem, item.variant)}</span>
            <span className="tag">{item.condition}</span>
            {item.grade !== "Raw" && item.grade !== "N/A" ? <span className="tag">{item.grade}</span> : null}
          </div>
          <MetricList
            rows={[
              ["Value", formatValuation(value)],
              ["Quantity", item.quantity],
              ["Location", item.location],
            ]}
          />
          <button className="button primary" type="button" onClick={onOpenItem}>
            Open lot
          </button>
        </div>
      </article>
    </div>
  );
}

function AddScreen({
  appState,
  cacheCatalogueItems,
  catalogueById,
  dataSource,
  sets,
  storageLocations,
  addSearch,
  setAddSearch,
  setAppState,
  addToCollection,
  createManualSealedProduct,
  addToWishlist,
  navigate,
}: ScreenContext) {
  const [catalogueSetFilter, setCatalogueSetFilter] = useState("all");
  const [catalogueRarityFilter, setCatalogueRarityFilter] = useState("all");
  const [catalogueLanguageFilter, setCatalogueLanguageFilter] = useState("all");
  const [catalogueSort, setCatalogueSort] = useState<CatalogueSort>("value-desc");
  const [catalogueSearchResults, setCatalogueSearchResults] = useState<CatalogueItem[]>([]);
  const [catalogueSearchInfo, setCatalogueSearchInfo] = useState({
    hasMore: false,
    nextOffset: null as number | null,
    returned: 0,
    windowExhausted: false,
  });
  const [catalogueSearchError, setCatalogueSearchError] = useState("");
  const [catalogueSearchNotice, setCatalogueSearchNotice] = useState("");
  const [catalogueLoadMoreError, setCatalogueLoadMoreError] = useState("");
  const [isSearchingCatalogue, setIsSearchingCatalogue] = useState(false);
  const [isLoadingMoreCatalogue, setIsLoadingMoreCatalogue] = useState(false);
  const [addCondition, setAddCondition] = useState("Near mint");
  const [addQuantity, setAddQuantity] = useState(1);
  const [addVariant, setAddVariant] = useState<string | undefined>(undefined);
  const [addLanguage, setAddLanguage] = useState("English");
  const [isSaving, setIsSaving] = useState(false);
  const [isSavingWishlist, setIsSavingWishlist] = useState(false);
  const [quickAddId, setQuickAddId] = useState<string | null>(null);
  const [zoomedCatalogueItemId, setZoomedCatalogueItemId] = useState<string | null>(null);
  const [showSelectedPriceHistory, setShowSelectedPriceHistory] = useState(false);
  const addDetailsPanelRef = useRef<HTMLElement | null>(null);
  const requestedPriceHistoryIdRef = useRef<string | null>(null);
  const catalogueLoadMoreAbortRef = useRef<AbortController | null>(null);
  const catalogueQuerySignature = [
    addSearch.trim(),
    appState.addType,
    catalogueLanguageFilter,
    catalogueRarityFilter,
    catalogueSetFilter,
    catalogueSort,
  ].join("\u0000");
  const catalogueQuerySignatureRef = useRef(catalogueQuerySignature);
  const catalogueSelectionQueryRef = useRef(catalogueQuerySignature);
  catalogueQuerySignatureRef.current = catalogueQuerySignature;

  useEffect(() => {
    if (catalogueSelectionQueryRef.current !== catalogueQuerySignature) {
      setAppState((current) => ({
        ...current,
        selectedCatalogueId: "",
        selectedCatalogueVariant: "",
      }));
      catalogueSelectionQueryRef.current = catalogueQuerySignature;
    }
    catalogueLoadMoreAbortRef.current?.abort();
    catalogueLoadMoreAbortRef.current = null;
    setCatalogueSearchResults([]);
    setCatalogueSearchInfo({ hasMore: false, nextOffset: null, returned: 0, windowExhausted: false });
    setCatalogueSearchError("");
    setCatalogueSearchNotice("");
    setCatalogueLoadMoreError("");
    setIsSearchingCatalogue(true);
    setIsLoadingMoreCatalogue(false);
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      try {
        const params = new URLSearchParams({
          limit: "80",
          language: catalogueLanguageFilter,
          offset: "0",
          q: addSearch.trim(),
          rarity: catalogueRarityFilter,
          set: catalogueSetFilter,
          sort: catalogueSort,
          type: appState.addType,
        });
        const response = await fetch(`/api/catalogue/search?${params.toString()}`, {
          cache: "no-store",
          signal: controller.signal,
        });

        if (!response.ok) {
          throw new Error(`Catalogue search failed with ${response.status}`);
        }

        const data = (await response.json()) as AppCatalogueSearchData;

        if (dataSource === "database" && data.source !== "database") {
          throw new Error(data.notice ?? "The live catalogue could not be reached. Sample search results were hidden.");
        }

        setCatalogueSearchResults(data.catalogue);
        setCatalogueSearchInfo({
          hasMore: data.hasMore,
          nextOffset: data.nextOffset,
          returned: data.returned,
          windowExhausted: data.windowExhausted,
        });
        setCatalogueSearchNotice(data.notice ?? "");
        cacheCatalogueItems(data.catalogue);
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        console.warn("Catalogue search failed.", error);
        setCatalogueSearchError(error instanceof Error ? error.message : "Catalogue search is not available right now.");
        setCatalogueSearchResults([]);
        setCatalogueSearchInfo({ hasMore: false, nextOffset: null, returned: 0, windowExhausted: false });
      } finally {
        if (!controller.signal.aborted) {
          setIsSearchingCatalogue(false);
        }
      }
    }, 220);

    return () => {
      window.clearTimeout(timeout);
      controller.abort();
      catalogueLoadMoreAbortRef.current?.abort();
      catalogueLoadMoreAbortRef.current = null;
    };
  }, [
    addSearch,
    appState.addType,
    cacheCatalogueItems,
    catalogueLanguageFilter,
    catalogueRarityFilter,
    catalogueSetFilter,
    catalogueSort,
    catalogueQuerySignature,
    dataSource,
    setAppState,
  ]);

  const results = catalogueSearchResults;
  const normalizedSearch = normalizeSearchText(addSearch);
  const setOptionGroups = groupedSetOptions(sets.map((item) => item.name), sets);
  const rarityOptions = uniqueValues([
    ...results.map((item) => item.rarity),
    catalogueRarityFilter === "all" ? "" : catalogueRarityFilter,
  ]).sort((left, right) => left.localeCompare(right));
  const hasNarrowedResults =
    Boolean(normalizedSearch) ||
    catalogueLanguageFilter !== "all" ||
    catalogueSetFilter !== "all" ||
    catalogueRarityFilter !== "all";
  const visibleResults = results;
  const selected =
    results.find((item) => item.id === appState.selectedCatalogueId) ??
    catalogueById.get(appState.selectedCatalogueId);
  const locationOptions = storageOptionNames(
    storageLocations,
    selected ? defaultStorageLocation(storageLocations, selected.type) : undefined,
  );
  const selectedVariant = selected
    ? selected.type === "sealed"
      ? undefined
      : selectedVariantLabel(selected, addVariant)
    : undefined;
  const selectedAdjustedValue = selected
    ? adjustedMarketValueMinor(selected, selectedVariant, addCondition, addQuantity)
    : null;
  const selectedBaseValue = selected ? catalogueMarketValueMinor(selected, selectedVariant) : null;
  const selectedConditionMultiplier = collectionConditionMultiplier(addCondition, selected?.type);
  const selectedCatalogueLanguageLabel = selected?.languageLabel ?? "English";
  const usesDifferentLotLanguage = selected?.type === "card" && addLanguage !== selectedCatalogueLanguageLabel;
  const selectedNeedsLocalPricing =
    selected?.type === "card" && selected.language && selected.language !== "en" && !selected.hasPrice;
  const zoomedCatalogueItem = zoomedCatalogueItemId
    ? catalogueById.get(zoomedCatalogueItemId) ?? results.find((item) => item.id === zoomedCatalogueItemId)
    : undefined;

  useEffect(() => {
    setAddCondition(selected?.type === "sealed" ? "Sealed" : "Near mint");
    setAddQuantity(1);
    setAddVariant(appState.selectedCatalogueVariant || undefined);
    setAddLanguage(selected?.languageLabel ?? "English");
  }, [appState.selectedCatalogueVariant, selected?.id, selected?.languageLabel, selected?.type]);

  const revealSelectedPriceHistory = useCallback(() => {
    window.requestAnimationFrame(() => {
      const panel = addDetailsPanelRef.current;
      panel?.scrollIntoView({ behavior: "smooth", block: "start" });
      panel?.scrollTo({ behavior: "smooth", top: 0 });
      panel?.focus({ preventScroll: true });
    });
  }, []);

  useEffect(() => {
    const openRequestedHistory = Boolean(selected?.id) && requestedPriceHistoryIdRef.current === selected?.id;
    requestedPriceHistoryIdRef.current = null;
    setShowSelectedPriceHistory(openRequestedHistory);

    if (openRequestedHistory) {
      revealSelectedPriceHistory();
    }
  }, [revealSelectedPriceHistory, selected?.id]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || isSaving) {
      return;
    }

    setIsSaving(true);
    await addToCollection(selected.id, new FormData(event.currentTarget));
    setIsSaving(false);
  }

  async function handleQuickAdd(itemId: string) {
    if (quickAddId) {
      return;
    }

    setQuickAddId(itemId);
    await addToCollection(itemId);
    setQuickAddId(null);
  }

  async function handleAddToWishlist(itemId: string) {
    if (isSavingWishlist) {
      return;
    }

    setIsSavingWishlist(true);
    await addToWishlist(itemId, selected?.id === itemId ? selectedVariant : undefined);
    setIsSavingWishlist(false);
  }

  function openPriceHistory(item: CatalogueItem) {
    if (selected?.id === item.id) {
      setShowSelectedPriceHistory(true);
      revealSelectedPriceHistory();
      return;
    }

    requestedPriceHistoryIdRef.current = item.id;
    setAppState((current) => ({
      ...current,
      addType: item.type,
      selectedCatalogueId: item.id,
      selectedCatalogueVariant: "",
    }));
  }

  async function loadMoreCatalogue() {
    const offset = catalogueSearchInfo.nextOffset;
    if (
      offset === null ||
      !catalogueSearchInfo.hasMore ||
      catalogueSearchInfo.windowExhausted ||
      isLoadingMoreCatalogue ||
      isSearchingCatalogue
    ) {
      return;
    }

    catalogueLoadMoreAbortRef.current?.abort();
    const controller = new AbortController();
    const requestSignature = catalogueQuerySignature;
    catalogueLoadMoreAbortRef.current = controller;
    setIsLoadingMoreCatalogue(true);
    setCatalogueLoadMoreError("");

    try {
      const params = new URLSearchParams({
        limit: "80",
        language: catalogueLanguageFilter,
        offset: String(offset),
        q: addSearch.trim(),
        rarity: catalogueRarityFilter,
        set: catalogueSetFilter,
        sort: catalogueSort,
        type: appState.addType,
      });
      const response = await fetch(`/api/catalogue/search?${params.toString()}`, {
        cache: "no-store",
        signal: controller.signal,
      });
      const body = (await response.json().catch(() => ({}))) as Partial<AppCatalogueSearchData> & { error?: string };
      if (!response.ok || !Array.isArray(body.catalogue)) {
        throw new Error(body.error ?? `Catalogue page failed with ${response.status}.`);
      }
      if (dataSource === "database" && body.source !== "database") {
        throw new Error(body.notice ?? "The live catalogue could not be reached. Sample search results were hidden.");
      }
      if (catalogueQuerySignatureRef.current !== requestSignature) return;

      const nextItems = body.catalogue;
      setCatalogueSearchResults((current) => {
        const existingIds = new Set(current.map((item) => item.id));
        return [...current, ...nextItems.filter((item) => !existingIds.has(item.id))];
      });
      setCatalogueSearchInfo({
        hasMore: body.hasMore === true,
        nextOffset: typeof body.nextOffset === "number" ? body.nextOffset : null,
        returned: typeof body.returned === "number" ? body.returned : nextItems.length,
        windowExhausted: body.windowExhausted === true,
      });
      setCatalogueSearchNotice(body.notice ?? "");
      cacheCatalogueItems(nextItems);
    } catch (error) {
      if (controller.signal.aborted || catalogueQuerySignatureRef.current !== requestSignature) return;
      console.warn("Unable to load more catalogue results.", error);
      setCatalogueLoadMoreError(error instanceof Error ? error.message : "More catalogue results could not be loaded.");
    } finally {
      if (catalogueLoadMoreAbortRef.current === controller) {
        catalogueLoadMoreAbortRef.current = null;
        setIsLoadingMoreCatalogue(false);
      }
    }
  }

  return (
    <section className="page">
      <PageHeader
        title={appState.addType === "sealed" ? "Add sealed product" : "Add card"}
        action={
          <button className="button" onClick={() => navigate("collection")}>
            <X size={17} />
            Cancel
          </button>
        }
      />

      <div className="segmented add-type-tabs" aria-label="Item type">
        <button
          aria-pressed={appState.addType === "card"}
          className={appState.addType === "card" ? "active" : ""}
          onClick={() => {
            setAppState((current) => ({
              ...current,
              addType: "card",
              selectedCatalogueId: "",
              selectedCatalogueVariant: "",
            }));
            setCatalogueRarityFilter("all");
          }}
          type="button"
        >
          <Layers3 size={16} />
          Cards
        </button>
        <button
          aria-pressed={appState.addType === "sealed"}
          className={appState.addType === "sealed" ? "active" : ""}
          onClick={() => {
            setAppState((current) => ({
              ...current,
              addType: "sealed",
              selectedCatalogueId: "",
              selectedCatalogueVariant: "",
            }));
            setCatalogueRarityFilter("all");
          }}
          type="button"
        >
          <PackagePlus size={16} />
          Sealed
        </button>
      </div>

      <div className="screen-split">
        <section className="section-block">
          <div className="add-search-sticky">
            <label className="search-box">
              <Search size={18} />
              <input
                value={addSearch}
                onChange={(event) => setAddSearch(event.target.value)}
                placeholder={appState.addType === "sealed" ? "Search sealed products or sets" : "Search cards, sets, or collector numbers"}
              />
            </label>

            <div className="catalogue-controls">
              <label className="sort-control">
                Set
                <select value={catalogueSetFilter} onChange={(event) => setCatalogueSetFilter(event.target.value)}>
                  <option value="all">All sets by era</option>
                  {setOptionGroups.map((group) => (
                    <optgroup key={group.label} label={group.label}>
                      {group.options.map((option) => (
                        <option key={option.name} value={option.name}>
                          {formatSetOptionLabel(option)}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </label>
              <label className="sort-control">
                Rarity / product type
                <select value={catalogueRarityFilter} onChange={(event) => setCatalogueRarityFilter(event.target.value)}>
                  <option value="all">All rarities and products</option>
                  {rarityOptions.map((rarity) => (
                    <option key={rarity} value={rarity}>{rarity}</option>
                  ))}
                </select>
              </label>
              <label className="sort-control">
                Card language
                <select value={catalogueLanguageFilter} onChange={(event) => setCatalogueLanguageFilter(event.target.value)}>
                  <option value="all">All catalogue languages</option>
                  {CATALOGUE_LANGUAGE_OPTIONS.map((language) => (
                    <option key={language.code} value={language.code}>
                      {language.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="sort-control">
                Sort
                <select value={catalogueSort} onChange={(event) => setCatalogueSort(event.target.value as CatalogueSort)}>
                  <option value="value-desc">Highest value</option>
                  <option value="value-asc">Lowest value</option>
                  <option value="set-number-asc">Set number low to high</option>
                  <option value="set-number-desc">Set number high to low</option>
                  <option value="name-asc">Name A-Z</option>
                  <option value="name-desc">Name Z-A</option>
                  <option value="rarity">Rarity</option>
                </select>
              </label>
            </div>
          </div>

          {appState.addType === "sealed" ? (
            <ManualSealedProductPanel sets={sets} onCreate={createManualSealedProduct} />
          ) : null}

          {catalogueSearchNotice ? <p className="catalogue-search-notice" role="status">{catalogueSearchNotice}</p> : null}
          <p className="result-meta">
            {isSearchingCatalogue && !visibleResults.length
              ? "Searching catalogue"
              : `${visibleResults.length} catalogue item${visibleResults.length === 1 ? "" : "s"} loaded`}
            {catalogueSearchInfo.hasMore && catalogueSearchInfo.nextOffset !== null ? " · More available" : ""}
          </p>
          <div aria-busy={isSearchingCatalogue} className="item-list">
            {visibleResults.length ? visibleResults.map((item) => (
              <CatalogueResult
                key={item.id}
                item={item}
                quickAddBusy={quickAddId === item.id}
                quickAddDisabled={Boolean(quickAddId)}
                onQuickAdd={() => void handleQuickAdd(item.id)}
                onViewHistory={() => openPriceHistory(item)}
                selected={item.id === selected?.id}
                onClick={() => setAppState((current) => ({
                  ...current,
                  addType: item.type,
                  selectedCatalogueId: item.id,
                  selectedCatalogueVariant: "",
                }))}
              />
            )) : (
              <EmptyState
                title={isSearchingCatalogue ? "Searching catalogue" : "No matching catalogue items"}
                description={
                  catalogueSearchError ||
                  (hasNarrowedResults
                    ? "Try fewer filters, a shorter search, or create a private manual sealed product."
                    : "Search by card name, product name, set name, or collector number.")
                }
              />
            )}
          </div>
          {visibleResults.length ? (
            <div className="catalogue-pagination" aria-live="polite">
              {catalogueLoadMoreError ? (
                <div className="inline-error-state" role="alert">
                  <span>{catalogueLoadMoreError}</span>
                  <button className="button small" disabled={isLoadingMoreCatalogue} onClick={() => void loadMoreCatalogue()} type="button">
                    <RefreshCw size={15} />
                    Retry
                  </button>
                </div>
              ) : null}
              {catalogueSearchInfo.windowExhausted ? (
                <p className="catalogue-window-note">
                  The safe 1,000-result browsing window has been reached. Narrow the search, set, rarity, or language to continue.
                </p>
              ) : !catalogueLoadMoreError && catalogueSearchInfo.hasMore && catalogueSearchInfo.nextOffset !== null ? (
                <button
                  className="button catalogue-load-more"
                  disabled={isLoadingMoreCatalogue || isSearchingCatalogue}
                  onClick={() => void loadMoreCatalogue()}
                  type="button"
                >
                  <Plus size={17} />
                  {isLoadingMoreCatalogue ? "Loading more" : "Load more catalogue items"}
                </button>
              ) : !catalogueLoadMoreError && visibleResults.length ? (
                <span className="catalogue-end-note">All matching results in this search window are loaded.</span>
              ) : null}
            </div>
          ) : null}
        </section>

        <section className="tool-panel add-details-panel" ref={addDetailsPanelRef} tabIndex={-1}>
          <h2>Owned details</h2>
          {selected ? (
            <CataloguePreview
              item={selected}
              onImageOpen={selected.type === "card" ? () => setZoomedCatalogueItemId(selected.id) : undefined}
            />
          ) : (
            <EmptyState title="Choose an item" description="Search or select a catalogue result to add owned-copy details." />
          )}
          {selected ? (
            <div className="valuation-preview">
              <span>Estimated owned value</span>
              <strong>{formatValuation(selectedAdjustedValue)}</strong>
              <small>
                {selectedBaseValue === null
                  ? selected.type === "sealed"
                    ? "No market estimate is available for this product yet."
                    : "No market estimate is available for this variant yet."
                  : selected.type === "sealed"
                    ? `${addQuantity} x ${selected.rarity} at sealed market. No condition adjustment.`
                    : `${addQuantity} x ${selectedVariant ?? "Market"} at ${addCondition}. ${conditionAdjustmentLabel(selectedConditionMultiplier)}`}
              </small>
            </div>
          ) : null}
          {selected ? (
            <>
              <button
                aria-expanded={showSelectedPriceHistory}
                className="button"
                onClick={() => setShowSelectedPriceHistory((current) => !current)}
                type="button"
              >
                <ChartNoAxesCombined size={17} />
                {showSelectedPriceHistory ? "Hide price history" : "View price history"}
              </button>
              {showSelectedPriceHistory ? (
                <PriceTrendPanel item={selected} preferredVariant={selectedVariant} />
              ) : null}
            </>
          ) : null}
          {selected ? (
            <form className="form-stack" key={selected.id} onSubmit={handleSubmit}>
              <div className="field-grid">
                <Field label="Condition">
                  <select name="condition" value={addCondition} onChange={(event) => setAddCondition(event.target.value)}>
                    <option>Near mint</option>
                    <option>Mint</option>
                    <option>Excellent</option>
                    <option>Light played</option>
                    <option>Played</option>
                    <option>Poor</option>
                    <option>Sealed</option>
                    <option>Unknown</option>
                  </select>
                </Field>
                <Field label="Language">
                  <select name="language" value={addLanguage} onChange={(event) => setAddLanguage(event.target.value)}>
                    {LOT_LANGUAGE_OPTIONS.map((language) => (
                      <option key={language.code}>{language.label}</option>
                    ))}
                  </select>
                </Field>
                <Field label="Quantity">
                  <input
                    name="quantity"
                    type="number"
                    min={1}
                    value={addQuantity}
                    onChange={(event) => setAddQuantity(Math.max(1, Number(event.target.value) || 1))}
                  />
                </Field>
                <Field label="Paid (lot total)">
                  <input name="paid" inputMode="decimal" placeholder="£0.00" />
                </Field>
                <Field label="Purchase date">
                  <input name="purchaseDate" type="date" defaultValue={dateStamp()} />
                </Field>
                <Field label="Manual lot value">
                  <input name="overrideValue" inputMode="decimal" placeholder="£0.00" />
                </Field>
                <Field label="Location">
                  <select name="location" defaultValue={defaultStorageLocation(storageLocations, selected.type)}>
                    {locationOptions.map((location) => (
                      <option key={location}>{location}</option>
                    ))}
                  </select>
                </Field>
                {selected.type === "sealed" ? (
                  <Field label="Product type">
                    <input value={selected.rarity} readOnly />
                    <input name="variant" type="hidden" value="Factory sealed" />
                  </Field>
                ) : (
                  <Field label="Variant">
                    <VariantSelect item={selected} value={selectedVariant} onChange={setAddVariant} />
                  </Field>
                )}
              </div>
              <p className="form-note">
                Paid and manual value are totals for this lot, including all {addQuantity} cop{addQuantity === 1 ? "y" : "ies"}.
              </p>
              {usesDifferentLotLanguage ? (
                <p className="form-note">
                  This lot language differs from the selected {selectedCatalogueLanguageLabel} catalogue printing. Use a
                  manual value if the market should be priced from the lot language rather than this catalogue record.
                </p>
              ) : null}
              {selectedNeedsLocalPricing ? (
                <p className="form-note">
                  This {selectedCatalogueLanguageLabel} printing is in the catalogue, but local market pricing has not
                  been imported yet. Add a manual value for now if you have a sale comp or receipt.
                </p>
              ) : null}
              <Field label="Valuation note">
                <textarea name="valuationNote" placeholder="Source or reason for valuation" />
              </Field>
              <Field label="Notes">
                <textarea name="notes" placeholder="Optional" />
              </Field>
              <div className="actions">
                <button className="button primary" type="submit" disabled={isSaving || isSavingWishlist}>
                  <Check size={17} />
                  {isSaving ? "Saving" : "Save to collection"}
                </button>
                <button
                  className="button"
                  type="button"
                  disabled={isSaving || isSavingWishlist}
                  onClick={() => void handleAddToWishlist(selected.id)}
                >
                  <Heart size={17} />
                  {isSavingWishlist ? "Saving" : "Add to wishlist"}
                </button>
              </div>
            </form>
          ) : null}
        </section>
      </div>
      {zoomedCatalogueItem ? (
        <CardImageZoomModal item={zoomedCatalogueItem} onClose={() => setZoomedCatalogueItemId(null)} />
      ) : null}
    </section>
  );
}

function ManualSealedProductPanel({
  sets,
  onCreate,
}: {
  sets: SetProgress[];
  onCreate: (formData: FormData) => Promise<boolean>;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [isSaving, setIsSaving] = useState(false);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    const created = await onCreate(new FormData(event.currentTarget));
    setIsSaving(false);

    if (created) {
      event.currentTarget.reset();
      setIsOpen(false);
    }
  }

  return (
    <div className="manual-product-panel">
      <button className="button full" type="button" onClick={() => setIsOpen((open) => !open)}>
        <PackagePlus size={17} />
        Manual sealed product
      </button>
      {isOpen ? (
        <form className="form-stack" onSubmit={handleSubmit}>
          <div className="field-grid">
            <Field label="Product name">
              <input name="name" placeholder="Ultra Premium Collection" required />
            </Field>
            <Field label="Product type">
              <select name="productType" defaultValue="Other">
                {sealedProductTypes.map((type) => (
                  <option key={type}>{type}</option>
                ))}
              </select>
            </Field>
            <Field label="Related set">
              <select name="relatedSetId" defaultValue="none">
                <option value="none">No set</option>
                {sets.map((set) => (
                  <option key={set.id} value={set.id}>
                    {set.name}
                  </option>
                ))}
              </select>
            </Field>
            <Field label="Estimated value">
              <input name="estimatedValue" inputMode="decimal" placeholder="£0.00" />
            </Field>
          </div>
          <Field label="Notes">
            <textarea name="notes" placeholder="Optional" />
          </Field>
          <div className="actions">
            <button className="button primary" type="submit" disabled={isSaving}>
              <Check size={17} />
              {isSaving ? "Creating" : "Create product"}
            </button>
            <button className="button" type="button" onClick={() => setIsOpen(false)}>
              <X size={17} />
              Cancel
            </button>
          </div>
        </form>
      ) : null}
    </div>
  );
}

function ItemDetailScreen({
  appState,
  archiveCollectionItem,
  catalogueById,
  collection,
  collectionEvents,
  duplicateItem,
  navigate,
  recordCollectionSale,
  storageLocations,
  updateCollectionItem,
}: ScreenContext) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSelling, setIsSelling] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDuplicating, setIsDuplicating] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const [isRecordingSale, setIsRecordingSale] = useState(false);
  const owned = collection.find((item) => item.id === appState.selectedItemId) ?? collection[0];

  if (!owned) {
    return <EmptyState title="No collection items yet" description="Add an item before opening owned-copy details." />;
  }

  const item = catalogueById.get(owned.catalogueId);

  if (!item) {
    return <EmptyState title="Item not found" description="This owned lot no longer matches a catalogue item." />;
  }

  const value = getOwnedValue(owned, item);
  const cost = owned.purchasePriceMinor ?? null;
  const gain = value !== null && cost !== null ? value - cost : null;
  const itemName = catalogueItemTitle(item);
  const locationOptions = storageOptionNames(storageLocations, owned.location);
  const itemEvents = collectionEvents.filter((event) => event.itemId === owned.id).slice(0, 6);
  const needsExactGradedPrice = isGradedCollectionItem(owned) &&
    collectionItemValuation(owned, item).kind === "unvalued";

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) {
      return;
    }

    setIsSaving(true);

    const saved = await updateCollectionItem(owned.id, new FormData(event.currentTarget));
    setIsSaving(false);

    if (saved) {
      setIsEditing(false);
    }
  }

  async function handleRemove() {
    if (isRemoving) {
      return;
    }

    if (!window.confirm(`Remove ${itemName} from your collection?`)) {
      return;
    }

    setIsRemoving(true);
    await archiveCollectionItem(owned.id);
    setIsRemoving(false);
  }

  async function handleSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isRecordingSale) {
      return;
    }

    setIsRecordingSale(true);
    const recorded = await recordCollectionSale(owned.id, new FormData(event.currentTarget));
    setIsRecordingSale(false);

    if (recorded) {
      setIsSelling(false);
    }
  }

  async function handleDuplicate() {
    if (isDuplicating) {
      return;
    }

    setIsDuplicating(true);
    await duplicateItem(owned.id);
    setIsDuplicating(false);
  }

  return (
    <section className="page">
      <PageHeader
        title={itemName}
        action={
          <div className="actions">
            <a className="button" href={ebaySoldSearchUrl(item)} rel="noreferrer" target="_blank">
              <Search size={17} />
              eBay solds
            </a>
            <button className="button" onClick={() => navigate("collection")}>
              <ArrowLeft size={17} />
              Collection
            </button>
          </div>
        }
      />

      <div className="item-identity-strip" aria-label="Item identity">
        <span><small>Set</small><strong>{catalogueItemSetLabel(item)}</strong></span>
        <span><small>Number</small><strong>{item.number}</strong></span>
        <span><small>{item.type === "sealed" ? "Product" : "Rarity"}</small><strong>{item.rarity}</strong></span>
        <span><small>Language</small><strong>{item.languageLabel ?? owned.language}</strong></span>
      </div>

      <div className="detail-layout">
        <div className="detail-media-stack">
          <div className="detail-image">{renderItemImage(item)}</div>
          <section className="tool-panel detail-summary-panel">
            <div className="panel-title-row">
              <h2>Owned lot</h2>
              <span className={valuationPillClass(item, owned)}>{valuationStatusLabel(item, owned)}</span>
            </div>
            <div className="tag-row">
              <span className="tag">{item.type === "sealed" ? "Sealed product" : "Card"}</span>
              <span className="tag blue">Qty {owned.quantity}</span>
              <span className="tag">{owned.condition}</span>
            </div>
            <MetricList
              rows={[
                ["Value", formatValuation(value)],
                ["Gain/loss", formatMoney(gain), gain !== null && gain >= 0 ? "positive" : ""],
                ["Location", owned.location],
              ]}
            />
          </section>
        </div>
        <div className="detail-stack">
          <PriceTrendPanel item={item} owned={owned} overrideValueMinor={owned.overrideValueMinor} />
          <section className="tool-panel detail-action-panel">
            <div className="panel-title-row">
              <h2>Lot actions</h2>
              <span className="tag">{isEditing ? "Editing" : isSelling ? "Recording sale" : "Ready"}</span>
            </div>
            <div className="detail-action-grid">
              <button
                className={isEditing ? "button primary" : "button"}
                onClick={() => {
                  setIsSelling(false);
                  setIsEditing((current) => !current);
                }}
              >
                {isEditing ? <X size={17} /> : <Settings size={17} />}
                {isEditing ? "Cancel edit" : "Edit details"}
              </button>
              <button
                className={isSelling ? "button primary" : "button"}
                onClick={() => {
                  setIsEditing(false);
                  setIsSelling((current) => !current);
                }}
              >
                {isSelling ? <X size={17} /> : <History size={17} />}
                {isSelling ? "Cancel sale" : "Record sale"}
              </button>
              <button className="button" onClick={() => void handleDuplicate()} disabled={isDuplicating}>
                <Plus size={17} />
                {isDuplicating ? "Duplicating" : "Duplicate lot"}
              </button>
              <button className="button danger" onClick={handleRemove} disabled={isRemoving}>
                <Trash2 size={17} />
                {isRemoving ? "Removing" : "Remove"}
              </button>
            </div>
          </section>
          {isEditing ? (
            <section className="tool-panel">
              <div className="panel-title-row">
                <h2>Edit owned details</h2>
                <span className="tag blue">{item.type === "sealed" ? "Sealed" : "Card"}</span>
              </div>
              <p className="muted">Update only what changed. Unknown values can stay blank and be filled later.</p>
              <form className="form-stack" onSubmit={handleUpdate}>
                <div className="field-grid">
                  <Field label="Condition">
                    <select name="condition" defaultValue={owned.condition}>
                      <option>Near Mint</option>
                      <option>Excellent</option>
                      <option>Light Played</option>
                      <option>Played</option>
                      <option>Mint</option>
                      <option>Sealed</option>
                      <option>Unknown</option>
                    </select>
                  </Field>
                  <Field label="Language">
                    <select name="language" defaultValue={owned.language}>
                      {LOT_LANGUAGE_OPTIONS.map((language) => (
                        <option key={language.code}>{language.label}</option>
                      ))}
                      {LOT_LANGUAGE_OPTIONS.some((language) => language.label === owned.language) ? null : (
                        <option>{owned.language}</option>
                      )}
                    </select>
                  </Field>
                  <Field label="Quantity">
                    <input name="quantity" type="number" min={1} defaultValue={owned.quantity} />
                  </Field>
                  <Field label="Paid (lot total)">
                    <input
                      name="paid"
                      inputMode="decimal"
                      defaultValue={moneyInputValue(owned.purchasePriceMinor)}
                      placeholder="£0.00"
                    />
                  </Field>
                  <Field label="Purchase date">
                    <input
                      name="purchaseDate"
                      type="date"
                      defaultValue={owned.purchaseDate ?? ""}
                    />
                  </Field>
                  <Field label="Manual lot value">
                    <input
                      name="overrideValue"
                      inputMode="decimal"
                      defaultValue={moneyInputValue(owned.overrideValueMinor)}
                      placeholder="£0.00"
                    />
                  </Field>
                  {item.type === "card" ? (
                    <>
                      <Field label="Grade company">
                        <select name="gradeCompany" defaultValue={gradeCompanyFromLabel(owned.grade)}>
                          <option>Raw</option>
                          <option>PSA</option>
                          <option>BGS</option>
                          <option>CGC</option>
                          <option>ACE</option>
                          <option>SGC</option>
                          <option>Other</option>
                        </select>
                      </Field>
                      <Field label="Grade score">
                        <input
                          name="gradeScore"
                          inputMode="decimal"
                          min={1}
                          max={10}
                          step={0.5}
                          type="number"
                          defaultValue={gradeScoreFromLabel(owned.grade)}
                          placeholder="10"
                        />
                      </Field>
                    </>
                  ) : null}
                  <Field label="Location">
                    <select name="location" defaultValue={owned.location}>
                      {locationOptions.map((location) => (
                        <option key={location}>{location}</option>
                      ))}
                    </select>
                  </Field>
                  {item.type === "sealed" ? (
                    <Field label="Product type">
                      <input value={item.rarity} readOnly />
                      <input name="variant" type="hidden" value="Factory sealed" />
                    </Field>
                  ) : (
                    <Field label="Variant">
                      <VariantSelect item={item} defaultValue={selectedVariantLabel(item, owned.variant)} />
                    </Field>
                  )}
                </div>
                <p className="form-note">
                  Paid and manual value are totals for the complete lot, not per-copy amounts.
                </p>
                <Field label="Valuation note">
                  <textarea
                    name="valuationNote"
                    defaultValue={owned.valuationNote ?? ""}
                    placeholder="Source or reason for valuation"
                  />
                </Field>
                <Field label="Notes">
                  <textarea name="notes" defaultValue={owned.notes ?? ""} placeholder="Optional" />
                </Field>
                <div className="actions">
                  <button className="button primary" type="submit" disabled={isSaving}>
                    <Check size={17} />
                    {isSaving ? "Saving" : "Save changes"}
                  </button>
                  <button className="button" type="button" onClick={() => setIsEditing(false)}>
                    <X size={17} />
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          ) : (
            <MetricPanel
              title="Owned details"
              rows={[
                ["Quantity", owned.quantity],
                ["Condition", owned.condition],
                ["Language", owned.language],
                ["Variant", selectedVariantLabel(item, owned.variant)],
                ["Grade", owned.grade],
                ["Purchased", owned.purchaseDate ? formatEventDate(owned.purchaseDate) : "Not recorded"],
                ["Location", owned.location],
              ]}
            />
          )}
          <MetricPanel
            title="Value"
            rows={[
              ["Estimated value", formatValuation(value)],
              ["Cost basis", formatMoney(cost)],
              ["Gain/loss", formatMoney(gain), gain !== null && gain >= 0 ? "positive" : ""],
              ["Confidence", valuationStatusLabel(item, owned)],
              ["Source", valuationSourceLabel(item, owned)],
              ["Market observed", valuationObservedLabel(item, owned)],
            ]}
          />
          {needsExactGradedPrice ? (
            <section className="tool-panel graded-pricing-note">
              <div className="panel-title-row">
                <h2>Graded pricing</h2>
                <span className="tag amber">Exact price needed</span>
              </div>
              <p className="muted">
                This lot is marked {owned.grade}, but Mint Binder does not have a graded price snapshot for this card yet.
                Its value is left unestimated rather than inheriting the raw-card or another variant&apos;s price.
              </p>
              <p className="muted">
                Add a Manual value and record the source in Valuation note until an exact {owned.grade} price for {selectedVariantLabel(item, owned.variant)} is available.
              </p>
            </section>
          ) : null}
          <section className="tool-panel">
            <h2>Valuation note</h2>
            <p className="muted">{owned.valuationNote || "No valuation note yet."}</p>
          </section>
          {isSelling ? (
            <section className="tool-panel">
              <div className="panel-title-row">
                <h2>Record sale</h2>
                <span className="tag amber">{owned.quantity > 1 ? "Reduces or removes lot" : "Removes lot"}</span>
              </div>
              <p className="muted">
                Record how many copies sold and the total proceeds. Any remaining copies stay in the active lot.
              </p>
              <form className="form-stack" onSubmit={handleSale}>
                <div className="field-grid">
                  <Field label="Quantity sold">
                    <input
                      name="quantity"
                      type="number"
                      min={1}
                      max={owned.quantity}
                      step={1}
                      defaultValue={owned.quantity}
                    />
                  </Field>
                  <Field label="Sale amount (total)">
                    <input
                      name="amount"
                      inputMode="decimal"
                      defaultValue={moneyInputValue(value ?? undefined)}
                      placeholder="£0.00"
                    />
                  </Field>
                  <Field label="Sale date">
                    <input name="occurredAt" type="date" defaultValue={dateStamp()} />
                  </Field>
                </div>
                <Field label="Notes">
                  <textarea name="notes" placeholder="Optional" />
                </Field>
                <div className="actions">
                  <button className="button primary" type="submit" disabled={isRecordingSale}>
                    <Check size={17} />
                    {isRecordingSale ? "Recording" : "Record sale"}
                  </button>
                  <button className="button" type="button" onClick={() => setIsSelling(false)}>
                    <X size={17} />
                    Cancel
                  </button>
                </div>
              </form>
            </section>
          ) : null}
          <section className="tool-panel">
            <h2>Notes</h2>
            <p className="muted">{owned.notes || "No notes yet."}</p>
          </section>
          <section className="tool-panel">
            <div className="panel-title-row">
              <h2>History</h2>
              <History size={18} />
            </div>
            <EventList events={itemEvents} />
          </section>
        </div>
      </div>
    </section>
  );
}

function SetsScreen({
  activeSetGoal,
  activeSetGoalNotice,
  appState,
  isLoadingSetGoal,
  reloadActiveSetGoal,
  sets,
  setSearch,
  setSetSearch,
  setAppState,
}: ScreenContext) {
  const [sort, setSort] = useState<SetListSort>("release-desc");
  const [languageFilter, setLanguageFilter] = useState<"en" | "ja" | "zh" | "ko">("en");
  const normalizedSetSearch = normalizeSearchText(setSearch);
  const languageOptions: Array<{ codes: string[]; label: string; value: "en" | "ja" | "zh" | "ko" }> = [
    { codes: ["en"], label: "English", value: "en" },
    { codes: ["ja"], label: "Japanese", value: "ja" },
    { codes: ["zh-cn", "zh-tw"], label: "Chinese", value: "zh" },
    { codes: ["ko"], label: "Korean", value: "ko" },
  ];
  const activeLanguages = languageOptions.find((option) => option.value === languageFilter)?.codes ?? ["en"];
  const activeGoalSet = activeSetGoal ? sets.find((set) => set.id === activeSetGoal.cardSetId) : undefined;
  const filteredSets = sets
    .filter((set) => activeLanguages.includes(set.language ?? "en"))
    .filter((set) => matchesSetSearch(set, normalizedSetSearch))
    .sort((left, right) => sortSets(left, right, sort));

  return (
    <section className="page">
      <PageHeader title="Sets" />
      <SetGoalOverview
        goal={activeSetGoal}
        goalSet={activeGoalSet}
        isLoading={isLoadingSetGoal}
        notice={activeSetGoalNotice}
        onOpenGoal={() => {
          if (!activeSetGoal) return;
          setAppState((current) => ({ ...current, screen: "setDetail", selectedSetId: activeSetGoal.cardSetId }));
        }}
        onRetry={() => void reloadActiveSetGoal()}
      />
      <div className="segmented set-language-tabs" aria-label="Set language">
        {languageOptions.map((option) => {
          const count = sets.filter((set) => option.codes.includes(set.language ?? "en")).length;

          return (
            <button
              aria-pressed={languageFilter === option.value}
              className={languageFilter === option.value ? "active" : ""}
              key={option.value}
              onClick={() => setLanguageFilter(option.value)}
              type="button"
            >
              {option.label}
              <span>{count}</span>
            </button>
          );
        })}
      </div>
      <section className="catalogue-toolbar">
        <label className="search-box">
          <Search size={18} />
          <input value={setSearch} onChange={(event) => setSetSearch(event.target.value)} placeholder="Search sets" />
        </label>
        <label className="sort-control">
          Sort
          <select value={sort} onChange={(event) => setSort(event.target.value as SetListSort)}>
            <option value="release-desc">Newest first</option>
            <option value="release-asc">Oldest first</option>
            <option value="name-asc">Name A-Z</option>
            <option value="name-desc">Name Z-A</option>
            <option value="completion-desc">Completion high to low</option>
            <option value="completion-asc">Completion low to high</option>
          </select>
        </label>
      </section>
      <p className="set-results-summary muted">
        {filteredSets.length} {languageOptions.find((option) => option.value === languageFilter)?.label} set{filteredSets.length === 1 ? "" : "s"}
      </p>
      {filteredSets.length ? (
        <div className="set-list">
          {filteredSets.map((set) => (
            <SetProgressCard
              isActiveGoal={activeSetGoal?.cardSetId === set.id}
              key={set.id}
              set={set}
              onClick={() => setAppState({ ...appState, selectedSetId: set.id, screen: "setDetail" })}
            />
          ))}
        </div>
      ) : (
        <EmptyState title={`No ${languageOptions.find((option) => option.value === languageFilter)?.label} sets found`} />
      )}
    </section>
  );
}

function SetGoalOverview({
  goal,
  goalSet,
  isLoading,
  notice,
  onOpenGoal,
  onRetry,
}: {
  goal: ActiveSetGoal | null;
  goalSet?: SetProgress;
  isLoading: boolean;
  notice: string;
  onOpenGoal: () => void;
  onRetry: () => void;
}) {
  if (notice) {
    return (
      <div className="data-error-state" role="alert">
        <p>{notice}</p>
        <button className="button small" type="button" onClick={onRetry}>
          <RefreshCw size={15} />
          Retry goal
        </button>
      </div>
    );
  }

  if (isLoading) {
    return <section className="tool-panel set-goal-overview" aria-busy="true"><p className="muted">Loading your active set goal…</p></section>;
  }

  if (!goal) {
    return (
      <section className="tool-panel set-goal-overview empty">
        <div>
          <p className="eyebrow">Set Builder</p>
          <h2>Turn a set into a focused collecting goal.</h2>
          <p className="muted">Open any set to choose a completion target, set wishlist priority, and plan the missing cards.</p>
        </div>
        <Target size={24} aria-hidden="true" />
      </section>
    );
  }

  const completion = goalSet ? completionPercent(goalSet.owned, goalSet.total) : 0;
  const title = goalSet ? setTitle(goalSet) : goal.set.name;

  return (
    <section className="tool-panel set-goal-overview active">
      <div className="set-goal-overview-copy">
        <p className="eyebrow">Active Set Builder goal</p>
        <h2>{title}</h2>
        <p className="muted">
          {goalSet ? `${goalSet.owned} of ${goalSet.total} owned` : "Progress will appear when the catalogue is loaded"}
          {` · ${goal.wishlistPriority} wishlist priority`}
        </p>
      </div>
      <div className="set-goal-overview-progress">
        <strong>{completion}%</strong>
        <span>Target {goal.targetCompletionPercent}%</span>
        <ProgressBar value={goal.targetCompletionPercent ? (completion / goal.targetCompletionPercent) * 100 : 0} />
      </div>
      <button className="button primary" type="button" onClick={onOpenGoal}>
        Open goal
        <ArrowRight size={17} />
      </button>
    </section>
  );
}

function SetDetailScreen({
  activeSetGoal,
  activeSetGoalNotice,
  appState,
  catalogueItems,
  catalogueComplete,
  collection,
  isLoadingCatalogue,
  isLoadingSetGoal,
  loadedCatalogueSetNames,
  loadSetCatalogueData,
  sets,
  wishlist,
  setAppState,
  addToWishlist,
  navigate,
  refreshAppData,
  reloadActiveSetGoal,
  setActiveSetGoal,
  setActiveSetGoalNotice,
  showToast,
}: ScreenContext) {
  const [cardSearch, setCardSearch] = useState("");
  const [rarityFilter, setRarityFilter] = useState("all");
  const [sort, setSort] = useState<SetDetailSort>("number-asc");
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const set = sets.find((item) => item.id === appState.selectedSetId) ?? sets[0];
  const setCards = set
    ? catalogueItems.filter((item) =>
      item.type === "card" && (item.setId ? item.setId === set.id : item.set === set.name),
    )
    : [];
  const hasSetCatalogue = Boolean(set && (catalogueComplete || loadedCatalogueSetNames.includes(set.id)));

  useEffect(() => {
    if (!set || hasSetCatalogue || isLoadingCatalogue) {
      return;
    }

    void loadSetCatalogueData(set.name, { quiet: true, setId: set.id });
  }, [hasSetCatalogue, isLoadingCatalogue, loadSetCatalogueData, set]);

  if (!set) {
    return <EmptyState title="No sets found" />;
  }

  if (!hasSetCatalogue) {
    return (
      <section className="page">
        <PageHeader
          title={setTitle(set)}
          action={
            <button className="button" onClick={() => navigate("sets")}>
              <ArrowLeft size={17} />
              Sets
            </button>
          }
        />
        <EmptyState
          title={isLoadingCatalogue ? "Loading set cards" : "Set cards not loaded"}
          description="Opening card printings, prices, and variants for this set."
          action={
            <button
              className="button primary"
              onClick={() => void loadSetCatalogueData(set.name, { setId: set.id })}
              disabled={isLoadingCatalogue}
            >
              <Search size={17} />
              {isLoadingCatalogue ? "Loading" : "Load cards"}
            </button>
          }
        />
      </section>
    );
  }

  const done = completionPercent(set.owned, set.total);
  const normalizedCardSearch = normalizeSearchText(cardSearch);
  const rarityOptions = uniqueValues(setCards.map((item) => item.rarity)).sort((left, right) =>
    left.localeCompare(right),
  );
  const setMarketValue = setCards.reduce((total, item) => total + (catalogueMarketValueMinor(item) ?? 0), 0);
  const missingCount = Math.max(set.total - set.owned, 0);
  const wantedCount = setCards.filter((item) => wishlist.some((entry) => entry.catalogueId === item.id)).length;
  const previewItem = previewItemId ? catalogueItems.find((item) => item.id === previewItemId) : undefined;
  const previewOwned = previewItem ? collection.find((entry) => entry.catalogueId === previewItem.id) : undefined;
  const previewWanted = previewItem ? wishlist.some((entry) => entry.catalogueId === previewItem.id) : false;

  const visibleCards = setCards.filter((item) => {
    const owned = collection.some((entry) => entry.catalogueId === item.id);
    const wanted = wishlist.some((entry) => entry.catalogueId === item.id);

    if (appState.setFilter === "owned") {
      return owned;
    }

    if (appState.setFilter === "missing") {
      return !owned;
    }

    if (appState.setFilter === "want") {
      return wanted;
    }

    return true;
  }).filter((item) => {
    const matchesSearch = matchesCatalogueSearch(item, normalizedCardSearch);
    const matchesRarity = rarityFilter === "all" || item.rarity === rarityFilter;

    return matchesSearch && matchesRarity;
  }).sort((left, right) => sortCatalogueItems(left, right, sort));

  function resetSetFilters() {
    setCardSearch("");
    setRarityFilter("all");
    setAppState((current) => ({ ...current, setFilter: "all" }));
  }

  return (
    <section className="page">
      <PageHeader
        title={setTitle(set)}
        action={
          <button className="button" onClick={() => navigate("sets")}>
            <ArrowLeft size={17} />
            Sets
          </button>
        }
      />
      <section className="tool-panel set-detail-panel">
        <div className="panel-title-row">
          <div className="set-detail-heading">
            <SetArtwork set={set} />
            <div>
              <h2>Set progress</h2>
              <p className="muted">{set.owned} of {set.total} cards owned</p>
            </div>
          </div>
          <span className={done === 100 ? "tag green" : "tag blue"}>{done === 100 ? "Complete" : `${done}%`}</span>
        </div>
        <div className="set-progress-hero">
          <div className="set-progress-copy">
            <strong>{done}%</strong>
            <span>{visibleCards.length} shown</span>
          </div>
          <ProgressBar value={done} />
        </div>
        <div className="set-summary-grid">
          <span><b>{set.owned}</b>Owned</span>
          <span><b>{missingCount}</b>Missing</span>
          <span><b>{wantedCount}</b>Wanted</span>
          <span><b>{formatMoney(setMarketValue)}</b>Market</span>
        </div>
        <div className="segmented set-filter-tabs" aria-label="Set card filter">
          {(["all", "owned", "missing", "want"] as const).map((filter) => (
            <button
              key={filter}
              className={appState.setFilter === filter ? "active" : ""}
              onClick={() => setAppState((current) => ({ ...current, setFilter: filter }))}
            >
              {capitalize(filter)}
            </button>
          ))}
        </div>
      </section>

      <SetBuilderPanel
        activeGoal={activeSetGoal}
        cards={setCards}
        collection={collection}
        currentSet={set}
        isLoadingGoal={isLoadingSetGoal}
        notice={activeSetGoalNotice}
        onFocus={(filter) => {
          setAppState((current) => ({ ...current, setFilter: filter }));
          window.requestAnimationFrame(() => document.getElementById("set-card-results")?.scrollIntoView({
            behavior: window.matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth",
            block: "start",
          }));
        }}
        onGoalChange={setActiveSetGoal}
        onGoalNoticeChange={setActiveSetGoalNotice}
        onPreview={setPreviewItemId}
        onRefreshData={refreshAppData}
        onRetryGoal={reloadActiveSetGoal}
        showToast={showToast}
        wishlist={wishlist}
      />

      <section className="catalogue-toolbar">
        <label className="search-box">
          <Search size={18} />
          <input value={cardSearch} onChange={(event) => setCardSearch(event.target.value)} placeholder="Search this set" />
        </label>
        <div className="catalogue-controls">
          <label className="sort-control">
            Rarity
            <select value={rarityFilter} onChange={(event) => setRarityFilter(event.target.value)}>
              <option value="all">All</option>
              {rarityOptions.map((rarity) => (
                <option key={rarity} value={rarity}>{rarity}</option>
              ))}
            </select>
          </label>
          <label className="sort-control">
            Sort
            <select value={sort} onChange={(event) => setSort(event.target.value as SetDetailSort)}>
              <option value="number-asc">Set number low to high</option>
              <option value="number-desc">Set number high to low</option>
              <option value="value-desc">Highest value</option>
              <option value="value-asc">Lowest value</option>
              <option value="name-asc">Name A-Z</option>
              <option value="name-desc">Name Z-A</option>
              <option value="rarity">Rarity</option>
            </select>
          </label>
        </div>
      </section>

      <div className="set-card-grid" id="set-card-results">
        {visibleCards.length ? visibleCards.map((item) => {
          const owned = collection.find((entry) => entry.catalogueId === item.id);
          const wanted = wishlist.some((entry) => entry.catalogueId === item.id);
          const statusLabel = owned ? "Owned" : wanted ? "Want" : "";
          const statusClass = owned ? "set-print-status owned" : wanted ? "set-print-status wanted" : "";

          return (
            <article
              className={owned ? "set-print-card owned" : wanted ? "set-print-card wanted" : "set-print-card"}
              key={item.id}
            >
              <button
                aria-label={`View ${catalogueItemTitle(item)} details`}
                className="set-print-open"
                onClick={() => setPreviewItemId(item.id)}
                type="button"
              />
              <div className="item-image set-print-image">{renderItemImage(item)}</div>
              <div className="set-print-body">
                <div className="set-print-header">
                  <div className="set-print-title">
                    <h3>{catalogueItemTitle(item)}</h3>
                    <p>No. {item.number}</p>
                  </div>
                  {statusLabel ? (
                    <span className={statusClass}>
                      {owned ? <Check size={14} /> : <Heart size={14} />}
                      {statusLabel}
                    </span>
                  ) : null}
                </div>
                <div className="set-print-meta">
                  <span className="set-print-rarity">{item.rarity}</span>
                </div>
                <CatalogueVariantPrices item={item} limit={3} />
                <div className="set-print-actions">
                  {owned ? (
                    <button
                      className="button"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setAppState((current) => ({ ...current, selectedItemId: owned.id }));
                        navigate("item");
                      }}
                    >
                      Open
                    </button>
                  ) : (
                    <button
                      className="button primary"
                      type="button"
                      onClick={(event) => {
                        event.stopPropagation();
                        setAppState((current) => ({
                          ...current,
                          selectedCatalogueId: item.id,
                          selectedCatalogueVariant: "",
                          addType: "card",
                        }));
                        navigate("add");
                      }}
                    >
                      <Plus size={17} />
                      Add
                    </button>
                  )}
                  <button
                    aria-pressed={wanted}
                    className="button"
                    type="button"
                    disabled={wanted}
                    onClick={(event) => {
                      event.stopPropagation();
                      void addToWishlist(item.id);
                    }}
                  >
                    <Heart size={17} />
                    {wanted ? "Wanted" : "Want"}
                  </button>
                </div>
              </div>
            </article>
          );
        }) : (
          <EmptyState
            title="No matching cards"
            description="Try a different search, rarity, or set filter."
            action={
              <button className="button" type="button" onClick={resetSetFilters}>
                Reset filters
              </button>
            }
          />
        )}
      </div>
      {previewItem ? (
        <CataloguePreviewModal
          item={previewItem}
          owned={previewOwned}
          wanted={previewWanted}
          onAdd={() => {
            setPreviewItemId(null);
            setAppState((current) => ({
              ...current,
              selectedCatalogueId: previewItem.id,
              selectedCatalogueVariant: "",
              addType: "card",
            }));
            navigate("add");
          }}
          onClose={() => setPreviewItemId(null)}
          onOpenOwned={() => {
            if (!previewOwned) {
              return;
            }

            setPreviewItemId(null);
            setAppState((current) => ({ ...current, selectedItemId: previewOwned.id }));
            navigate("item");
          }}
          onWant={() => void addToWishlist(previewItem.id)}
        />
      ) : null}
    </section>
  );
}

type SetBuilderChase = {
  item: CatalogueItem;
  marketValueMinor: number;
  reason: string;
  targetPriceMinor?: number;
  wishlistPriority?: WishlistItem["priority"];
};

function SetBuilderPanel({
  activeGoal,
  cards,
  collection,
  currentSet,
  isLoadingGoal,
  notice,
  onFocus,
  onGoalChange,
  onGoalNoticeChange,
  onPreview,
  onRefreshData,
  onRetryGoal,
  showToast,
  wishlist,
}: {
  activeGoal: ActiveSetGoal | null;
  cards: CatalogueItem[];
  collection: CollectionItem[];
  currentSet: SetProgress;
  isLoadingGoal: boolean;
  notice: string;
  onFocus: (filter: AppState["setFilter"]) => void;
  onGoalChange: (goal: ActiveSetGoal | null) => void;
  onGoalNoticeChange: (notice: string) => void;
  onPreview: (itemId: string) => void;
  onRefreshData: (options?: { quiet?: boolean }) => Promise<boolean>;
  onRetryGoal: (options?: { quiet?: boolean }) => Promise<boolean>;
  showToast: (message: string, tone?: ToastTone) => void;
  wishlist: WishlistItem[];
}) {
  const [goalTarget, setGoalTarget] = useState(100);
  const [goalPriority, setGoalPriority] = useState<WishlistItem["priority"]>("High");
  const [isSavingGoal, setIsSavingGoal] = useState(false);
  const [isClearingGoal, setIsClearingGoal] = useState(false);
  const [isBulkPickerOpen, setIsBulkPickerOpen] = useState(false);
  const [isBulkAdding, setIsBulkAdding] = useState(false);
  const [selectedMissingIds, setSelectedMissingIds] = useState<string[]>([]);
  const [builderError, setBuilderError] = useState("");
  const [bulkResult, setBulkResult] = useState<SetGoalWishlistBulkResult | null>(null);
  const ownedCatalogueIds = new Set(collection.map((item) => item.catalogueId));
  const wishlistByCatalogueId = new Map(wishlist.map((item) => [item.catalogueId, item]));
  const missingCards = cards.filter((item) => !ownedCatalogueIds.has(item.id));
  const eligibleMissingCards = missingCards.filter((item) => !wishlistByCatalogueId.has(item.id));
  const eligibleMissingIds = new Set(eligibleMissingCards.map((item) => item.id));
  const selectedEligibleIds = selectedMissingIds.filter((itemId) => eligibleMissingIds.has(itemId)).slice(0, 500);
  const rankedEligibleCards = sortSetBuilderCandidates(eligibleMissingCards, wishlistByCatalogueId);
  const currentCompletion = completionPercent(currentSet.owned, currentSet.total);
  const goalForCurrentSet = activeGoal?.cardSetId === currentSet.id ? activeGoal : null;
  const targetOwnedCount = Math.min(currentSet.total, Math.ceil(currentSet.total * (goalTarget / 100)));
  const cardsNeededForTarget = Math.max(0, targetOwnedCount - currentSet.owned);
  const wantedMissingCount = missingCards.filter((item) => wishlistByCatalogueId.has(item.id)).length;
  const chase = nextBestSetBuilderChase(missingCards, wishlistByCatalogueId);

  useEffect(() => {
    setGoalTarget(goalForCurrentSet?.targetCompletionPercent ?? 100);
    setGoalPriority(goalForCurrentSet?.wishlistPriority ?? "High");
    setSelectedMissingIds([]);
    setBulkResult(null);
    setBuilderError("");
  }, [currentSet.id, goalForCurrentSet?.id, goalForCurrentSet?.targetCompletionPercent, goalForCurrentSet?.wishlistPriority]);

  async function saveGoal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSavingGoal || isClearingGoal) return;
    setIsSavingGoal(true);
    setBuilderError("");
    try {
      const response = await fetch("/api/set-goal", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          cardSetId: currentSet.id,
          targetCompletionPercent: goalTarget,
          wishlistPriority: goalPriority,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as SetGoalResponse & { error?: string };
      if (!response.ok || !body.goal) throw new Error(body.error ?? `Set goal save failed with ${response.status}.`);
      onGoalChange(body.goal);
      onGoalNoticeChange("");
      showToast(`${setTitle(currentSet)} is now your active Set Builder goal.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : "The set goal could not be saved.";
      setBuilderError(message);
      showToast(message, "error");
    } finally {
      setIsSavingGoal(false);
    }
  }

  async function clearGoal() {
    if (!goalForCurrentSet || isClearingGoal || isSavingGoal) return;
    if (!window.confirm("Clear this active set goal? Existing wishlist entries will stay intact.")) return;
    setIsClearingGoal(true);
    setBuilderError("");
    try {
      const response = await fetch("/api/set-goal", { method: "DELETE" });
      const body = (await response.json().catch(() => ({}))) as { error?: string };
      if (!response.ok) throw new Error(body.error ?? `Set goal clear failed with ${response.status}.`);
      onGoalChange(null);
      showToast("Active set goal cleared. Your wishlist was not changed.");
    } catch (error) {
      const message = error instanceof Error ? error.message : "The set goal could not be cleared.";
      setBuilderError(message);
      showToast(message, "error");
    } finally {
      setIsClearingGoal(false);
    }
  }

  function toggleMissingSelection(itemId: string, selected: boolean) {
    setBulkResult(null);
    setSelectedMissingIds((current) => selected
      ? uniqueValues([...current, itemId]).slice(0, 500)
      : current.filter((id) => id !== itemId));
  }

  async function addSelectedMissingToWishlist() {
    if (!goalForCurrentSet || !selectedEligibleIds.length || isBulkAdding) return;
    setIsBulkAdding(true);
    setBuilderError("");
    setBulkResult(null);
    try {
      const response = await fetch("/api/set-goal/wishlist", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ cardPrintingIds: selectedEligibleIds }),
      });
      const body = (await response.json().catch(() => ({}))) as {
        error?: string;
        result?: SetGoalWishlistBulkResult;
      };
      if (!response.ok || !body.result) throw new Error(body.error ?? `Bulk wishlist update failed with ${response.status}.`);
      setBulkResult(body.result);
      setSelectedMissingIds([]);
      const refreshed = await onRefreshData({ quiet: true });
      if (!refreshed) {
        throw new Error("The wishlist was updated, but the latest app data could not be reloaded. Refresh the page to see every change.");
      }
      showToast(
        body.result.added
          ? `${body.result.added} missing card${body.result.added === 1 ? "" : "s"} added to the wishlist.`
          : "Those cards were already owned or wishlisted; no duplicates were created.",
        body.result.added ? "success" : "warning",
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "Missing cards could not be added to the wishlist.";
      setBuilderError(message);
      showToast(message, "error");
    } finally {
      setIsBulkAdding(false);
    }
  }

  return (
    <section className="tool-panel set-builder-panel" aria-labelledby="set-builder-title">
      <div className="panel-title-row set-builder-heading">
        <div>
          <p className="eyebrow">Set Builder</p>
          <h2 id="set-builder-title">Plan the next cards, not just the finish line.</h2>
          <p className="muted">One saved goal follows you across devices. Wishlist actions use the saved priority and skip owned or duplicate cards.</p>
        </div>
        <span className={goalForCurrentSet ? "tag green" : "tag blue"}>
          {isLoadingGoal ? "Loading goal" : goalForCurrentSet ? "Active goal" : activeGoal ? "Another goal active" : "Not active"}
        </span>
      </div>

      {notice ? (
        <div className="data-error-state" role="alert">
          <p>{notice}</p>
          <button className="button small" type="button" onClick={() => void onRetryGoal()}>
            <RefreshCw size={15} />
            Retry goal
          </button>
        </div>
      ) : null}

      {activeGoal && !goalForCurrentSet ? (
        <div className="set-builder-active-note">
          <Info size={18} />
          <span><strong>{activeGoal.set.name}</strong> is currently active. Saving below will switch the goal to this set.</span>
        </div>
      ) : null}

      <div className="set-builder-grid">
        <form className="set-builder-goal-form" onSubmit={saveGoal}>
          <div className="panel-title-row">
            <h3>Goal settings</h3>
            <Target size={18} />
          </div>
          <div className="set-builder-form-fields">
            <Field label="Completion target (%)">
              <input
                inputMode="numeric"
                max={100}
                min={1}
                onChange={(event) => setGoalTarget(Math.max(1, Math.min(100, Number(event.target.value) || 1)))}
                type="number"
                value={goalTarget}
              />
            </Field>
            <Field label="Wishlist priority">
              <select value={goalPriority} onChange={(event) => setGoalPriority(event.target.value as WishlistItem["priority"])}>
                {(["Low", "Medium", "High", "Grail"] as const).map((priority) => <option key={priority}>{priority}</option>)}
              </select>
            </Field>
          </div>
          <div className="set-builder-progress-copy">
            <div>
              <strong>{currentCompletion}% now</strong>
              <span>{goalTarget}% target · {cardsNeededForTarget ? `${cardsNeededForTarget} more card${cardsNeededForTarget === 1 ? "" : "s"}` : "target reached"}</span>
            </div>
            <ProgressBar value={goalTarget ? (currentCompletion / goalTarget) * 100 : 0} />
          </div>
          <div className="actions">
            <button className="button primary" disabled={isSavingGoal || isClearingGoal || isLoadingGoal} type="submit">
              <Save size={17} />
              {isSavingGoal ? "Saving goal" : goalForCurrentSet ? "Save goal" : activeGoal ? "Switch active goal" : "Start this goal"}
            </button>
            {goalForCurrentSet ? (
              <button className="button danger" disabled={isClearingGoal || isSavingGoal} onClick={() => void clearGoal()} type="button">
                <X size={17} />
                {isClearingGoal ? "Clearing" : "Clear goal"}
              </button>
            ) : null}
          </div>
        </form>

        <article className="set-builder-chase-card">
          <div className="panel-title-row">
            <h3>Next-best chase</h3>
            <Sparkles size={18} />
          </div>
          {chase ? (
            <>
              <div className="set-builder-chase-main">
                <div className="item-image set-builder-chase-image">{renderItemImage(chase.item)}</div>
                <div>
                  <strong>{catalogueItemTitle(chase.item)}</strong>
                  <span>No. {chase.item.number} · {chase.item.rarity}</span>
                  <b>{formatMoney(chase.marketValueMinor)}</b>
                </div>
              </div>
              <p>{chase.reason}</p>
              <div className="tag-row">
                <span className={valuationTagClass(chase.item)}>{chase.item.confidence} confidence</span>
                {chase.item.priceSource ? <span className="tag">{priceSourceLabel(chase.item.priceSource)}</span> : null}
                {chase.item.priceObservedAt ? <span className="tag">Observed {formatEventDate(chase.item.priceObservedAt)}</span> : null}
                {chase.wishlistPriority ? <span className="tag">{chase.wishlistPriority} priority</span> : null}
                {chase.targetPriceMinor !== undefined ? <span className="tag blue">Target {formatMoney(chase.targetPriceMinor)}</span> : null}
              </div>
              <button className="button" type="button" onClick={() => onPreview(chase.item.id)}>
                View card
                <ArrowRight size={16} />
              </button>
            </>
          ) : (
            <p className="muted">A price-aware recommendation will appear when at least one missing card has a usable market estimate.</p>
          )}
        </article>
      </div>

      <div className="set-builder-focus-row">
        <button className="button" type="button" onClick={() => onFocus("missing")}>
          <Search size={16} />
          Focus {missingCards.length} missing
        </button>
        <button className="button" type="button" onClick={() => onFocus("want")}>
          <Heart size={16} />
          Focus {wantedMissingCount} wanted
        </button>
        <span>{eligibleMissingCards.length} missing card{eligibleMissingCards.length === 1 ? " is" : "s are"} not yet on the wishlist.</span>
      </div>

      <div className="set-builder-bulk">
        <div className="panel-title-row">
          <div>
            <h3>Bulk wishlist</h3>
            <p className="muted">Select exact missing printings. The server rechecks ownership, set membership, and duplicates before writing.</p>
          </div>
          <button
            aria-expanded={isBulkPickerOpen}
            className="button small"
            disabled={!eligibleMissingCards.length}
            onClick={() => setIsBulkPickerOpen((open) => !open)}
            type="button"
          >
            {isBulkPickerOpen ? "Hide cards" : "Choose cards"}
          </button>
        </div>

        {isBulkPickerOpen && eligibleMissingCards.length ? (
          <>
            <div className="set-builder-selection-actions">
              <button
                className="button small"
                disabled={!cardsNeededForTarget}
                onClick={() => setSelectedMissingIds(rankedEligibleCards.slice(0, Math.min(cardsNeededForTarget, 500)).map((item) => item.id))}
                type="button"
              >
                Select {Math.min(cardsNeededForTarget, eligibleMissingCards.length)} {cardsNeededForTarget > eligibleMissingCards.length ? "available toward target" : "to target"}
              </button>
              <button className="button small" onClick={() => setSelectedMissingIds(rankedEligibleCards.slice(0, 500).map((item) => item.id))} type="button">
                Select all{eligibleMissingCards.length > 500 ? " (first 500)" : ""}
              </button>
              <button className="button small" disabled={!selectedEligibleIds.length} onClick={() => setSelectedMissingIds([])} type="button">
                Clear
              </button>
              <strong>{selectedEligibleIds.length} selected</strong>
            </div>
            <div className="set-builder-checklist" role="group" aria-label={`Missing cards in ${setTitle(currentSet)}`}>
              {rankedEligibleCards.map((item) => {
                const value = catalogueMarketValueMinor(item);
                return (
                  <label className="set-builder-check-row" key={item.id}>
                    <input
                      checked={selectedEligibleIds.includes(item.id)}
                      onChange={(event) => toggleMissingSelection(item.id, event.target.checked)}
                      type="checkbox"
                    />
                    <span>
                      <strong>{catalogueItemTitle(item)}</strong>
                      <small>No. {item.number} · {item.rarity}</small>
                    </span>
                    <b>{formatValuation(value)}</b>
                  </label>
                );
              })}
            </div>
          </>
        ) : null}

        {builderError ? <p className="auth-error" role="alert">{builderError}</p> : null}
        {bulkResult ? (
          <p className="set-builder-result" role="status">
            Added {bulkResult.added}; already wanted {bulkResult.alreadyWishlisted}; owned skipped {bulkResult.ownedSkipped}; concurrent duplicates skipped {bulkResult.concurrentDuplicatesSkipped}.
          </p>
        ) : null}
        <div className="set-builder-bulk-footer">
          <span>{goalForCurrentSet ? `${goalForCurrentSet.wishlistPriority} saved priority will be applied.` : "Save this set as the active goal before bulk adding."}</span>
          <button
            className="button primary"
            disabled={!goalForCurrentSet || !selectedEligibleIds.length || isBulkAdding}
            onClick={() => void addSelectedMissingToWishlist()}
            type="button"
          >
            <Heart size={17} />
            {isBulkAdding ? "Adding safely" : `Add ${selectedEligibleIds.length || "selected"} to wishlist`}
          </button>
        </div>
      </div>
    </section>
  );
}

function sortSetBuilderCandidates(cards: CatalogueItem[], wishlistByCatalogueId: Map<string, WishlistItem>) {
  return [...cards].sort((left, right) => {
    const leftMarket = catalogueMarketValueMinor(left);
    const rightMarket = catalogueMarketValueMinor(right);
    const leftTarget = wishlistByCatalogueId.get(left.id)?.targetPriceMinor;
    const rightTarget = wishlistByCatalogueId.get(right.id)?.targetPriceMinor;
    const leftGroup = leftMarket !== null && leftTarget !== undefined && leftMarket <= leftTarget
      ? 0
      : leftMarket !== null && leftTarget !== undefined
        ? 1
        : leftMarket !== null
          ? 2
          : 3;
    const rightGroup = rightMarket !== null && rightTarget !== undefined && rightMarket <= rightTarget
      ? 0
      : rightMarket !== null && rightTarget !== undefined
        ? 1
        : rightMarket !== null
          ? 2
          : 3;
    if (leftGroup !== rightGroup) return leftGroup - rightGroup;
    if (leftGroup === 0 && leftMarket !== null && rightMarket !== null && leftTarget !== undefined && rightTarget !== undefined) {
      return (rightTarget - rightMarket) - (leftTarget - leftMarket);
    }
    if (leftGroup === 1 && leftMarket !== null && rightMarket !== null && leftTarget !== undefined && rightTarget !== undefined) {
      return (leftMarket - leftTarget) - (rightMarket - rightTarget);
    }
    if (leftMarket !== null || rightMarket !== null) return (leftMarket ?? Number.POSITIVE_INFINITY) - (rightMarket ?? Number.POSITIVE_INFINITY);
    return compareCatalogueNumbers(left.number, right.number);
  });
}

function nextBestSetBuilderChase(
  missingCards: CatalogueItem[],
  wishlistByCatalogueId: Map<string, WishlistItem>,
): SetBuilderChase | null {
  const item = sortSetBuilderCandidates(missingCards, wishlistByCatalogueId)
    .find((candidate) => catalogueMarketValueMinor(candidate) !== null);
  if (!item) return null;
  const marketValueMinor = catalogueMarketValueMinor(item) as number;
  const wanted = wishlistByCatalogueId.get(item.id);
  const targetPriceMinor = wanted?.targetPriceMinor;
  const reason = targetPriceMinor !== undefined
    ? marketValueMinor <= targetPriceMinor
      ? `The current ${formatMoney(marketValueMinor)} estimate is at or below your saved ${formatMoney(targetPriceMinor)} wishlist target.`
      : `This is the closest priced missing card to its saved target: ${formatMoney(marketValueMinor)} is ${formatMoney(marketValueMinor - targetPriceMinor)} above ${formatMoney(targetPriceMinor)}.`
    : "This is the lowest current market estimate among missing cards with usable price data.";
  return {
    item,
    marketValueMinor,
    reason,
    targetPriceMinor,
    wishlistPriority: wanted?.priority,
  };
}

function CatalogueVariantPrices({
  detailed = false,
  item,
  limit,
}: {
  detailed?: boolean;
  item: CatalogueItem;
  limit?: number;
}) {
  const rows = catalogueVariantPriceRows(item);
  const visibleRows = typeof limit === "number" ? rows.slice(0, limit) : rows;
  const hiddenCount = rows.length - visibleRows.length;

  return (
    <div
      aria-label={`${catalogueItemTitle(item)} variant market prices`}
      className={detailed ? "variant-price-list detailed" : "variant-price-list compact"}
      role="group"
    >
      <div aria-hidden="true" className="variant-price-heading">
        <span>Finish</span>
        <span>Market value</span>
      </div>
      <dl>
        {visibleRows.map((option) => {
          const metadata = detailed
            ? [
                option.confidence ? `${option.confidence} confidence` : "",
                option.source ? priceSourceLabel(option.source) : "",
                option.observedAt ? formatEventDate(option.observedAt) : "",
              ].filter(Boolean).join(" · ")
            : "";
          const displayValue = option.valueMinor;
          const hasPrice = displayValue !== undefined;

          return (
            <div className="variant-price-row" key={option.label}>
              <dt>
                <span title={option.label}>{option.label}</span>
                {metadata ? <small>{metadata}</small> : null}
              </dt>
              <dd className={hasPrice ? "variant-price-value" : "variant-price-value missing"}>
                {displayValue !== undefined ? formatMoney(displayValue) : "Not priced"}
              </dd>
            </div>
          );
        })}
      </dl>
      {hiddenCount > 0 ? (
        <p className="variant-price-more">+{hiddenCount} more {hiddenCount === 1 ? "price" : "prices"} in details</p>
      ) : null}
    </div>
  );
}

function CataloguePreviewModal({
  item,
  owned,
  wanted,
  onAdd,
  onClose,
  onOpenOwned,
  onWant,
}: {
  item: CatalogueItem;
  owned?: CollectionItem;
  wanted: boolean;
  onAdd: () => void;
  onClose: () => void;
  onOpenOwned: () => void;
  onWant: () => void;
}) {
  const [showDetails, setShowDetails] = useState(false);
  const [showPriceHistory, setShowPriceHistory] = useState(false);
  const dialogRef = useDialogFocus<HTMLElement>(true);
  const variantPriceRows = catalogueVariantPriceRows(item);
  const pricedVariantCount = variantPriceRows.filter((option) => option.valueMinor !== undefined).length;
  const titleId = `catalogue-preview-${item.id}`;

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="catalogue-preview-backdrop" onClick={onClose} role="presentation">
      <article
        aria-labelledby={titleId}
        aria-modal="true"
        className="catalogue-preview-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <button className="icon-button catalogue-preview-close" type="button" onClick={onClose} aria-label="Close preview">
          <X size={18} />
        </button>
        <div className="catalogue-preview-media">
          <div className="item-image catalogue-preview-image">{renderItemImage(item)}</div>
        </div>
        <div className="catalogue-preview-content">
          <div className="catalogue-preview-title-row">
            <div>
              <h2 id={titleId}>{catalogueItemTitle(item)}</h2>
              <p>{catalogueItemSetLabel(item)} | No. {item.number}</p>
            </div>
            <button
              aria-pressed={showDetails}
              className={showDetails ? "icon-button info active" : "icon-button info"}
              onClick={() => setShowDetails((current) => !current)}
              type="button"
            >
              <Info size={18} />
              <span className="sr-only">Toggle card details</span>
            </button>
          </div>
          <div className="set-print-meta">
            <span className="set-print-rarity">{item.rarity}</span>
            {owned ? <span className="set-print-status owned"><Check size={14} />Owned</span> : null}
            {!owned && wanted ? <span className="set-print-status wanted"><Heart size={14} />Want</span> : null}
          </div>
          <CatalogueVariantPrices detailed item={item} />
          {showDetails ? (
            <dl className="catalogue-preview-details">
              <div>
                <dt>Pricing method</dt>
                <dd>Each finish uses its own latest matching market observation. An unpriced finish never borrows another finish&apos;s value.</dd>
              </div>
              <div>
                <dt>Price coverage</dt>
                <dd>{pricedVariantCount} of {variantPriceRows.length} {variantPriceRows.length === 1 ? "finish" : "finishes"} priced</dd>
              </div>
              <div>
                <dt>Available finishes</dt>
                <dd>{variantPriceRows.map((option) => option.label).join(", ")}</dd>
              </div>
            </dl>
          ) : null}
          {showPriceHistory ? <PriceTrendPanel item={item} /> : null}
          <div className="catalogue-preview-actions">
            {owned ? (
              <button className="button primary" type="button" onClick={onOpenOwned}>
                Open owned lot
              </button>
            ) : (
              <button className="button primary" type="button" onClick={onAdd}>
                <Plus size={17} />
                Add
              </button>
            )}
            <button className="button" type="button" disabled={wanted} onClick={onWant}>
              <Heart size={17} />
              {wanted ? "Wanted" : "Want"}
            </button>
            <button
              aria-expanded={showPriceHistory}
              className="button catalogue-history-action"
              onClick={() => setShowPriceHistory((current) => !current)}
              type="button"
            >
              <ChartNoAxesCombined size={17} />
              {showPriceHistory ? "Hide price history" : "View price history"}
            </button>
          </div>
        </div>
      </article>
    </div>
  );
}

function WishlistScreen({
  appState,
  catalogueById,
  collection,
  wishlist,
  wishlistTotal,
  navigate,
  removeWishlistItem,
  setAppState,
  startAdd,
  updateWishlistItem,
}: ScreenContext) {
  const [editingId, setEditingId] = useState("");
  const [previewItemId, setPreviewItemId] = useState<string | null>(null);
  const [savingId, setSavingId] = useState("");
  const [sort, setSort] = useState<WishlistSort>("priority-desc");
  const [wishlistSearch, setWishlistSearch] = useState("");
  type WishlistRow = {
    catalogueItem: CatalogueItem;
    currentValue: number | null;
    delta: number | null;
    isEditing: boolean;
    item: WishlistItem;
    targetValue: number | null;
    variantLabel?: string;
  };

  const wishlistInsight = wishlist.reduce(
    (summary, item) => {
      const catalogueItem = catalogueById.get(item.catalogueId);
      const currentValue = catalogueItem ? wishlistMarketValueMinor(catalogueItem, item) : null;
      const targetValue = item.targetPriceMinor ?? currentValue;

      if (item.priority === "Grail") {
        summary.grailCount += 1;
      }

      if (currentValue !== null && targetValue !== null) {
        summary.pricedCount += 1;

        if (currentValue <= targetValue) {
          summary.targetHits += 1;
        }
      }

      return summary;
    },
    { grailCount: 0, pricedCount: 0, targetHits: 0 },
  );
  const sortedWishlist = [...wishlist].sort((left, right) => sortWishlistItems(left, right, catalogueById, sort));
  const normalizedWishlistSearch = wishlistSearch.trim().toLowerCase();
  const wishlistRows = sortedWishlist
    .map<WishlistRow | null>((item) => {
      const catalogueItem = catalogueById.get(item.catalogueId);

      if (!catalogueItem) {
        return null;
      }

      const currentValue = wishlistMarketValueMinor(catalogueItem, item);
      const targetValue = item.targetPriceMinor ?? currentValue;
      const delta = currentValue === null || targetValue === null ? null : targetValue - currentValue;

      return {
        catalogueItem,
        currentValue,
        delta,
        isEditing: editingId === item.id,
        item,
        targetValue,
        variantLabel: wishlistVariantSelectionLabel(item, catalogueItem),
      };
    })
    .filter((row): row is WishlistRow => row !== null)
    .filter((row) => {
      if (!normalizedWishlistSearch) {
        return true;
      }

      return [
        row.catalogueItem.name,
        catalogueItemTitle(row.catalogueItem),
        row.catalogueItem.set,
        catalogueItemSetLabel(row.catalogueItem),
        row.catalogueItem.number,
        row.variantLabel ?? "",
        row.item.priority,
        row.item.notes ?? "",
      ].join(" ").toLowerCase().includes(normalizedWishlistSearch);
    });
  const watchCount = wishlistRows.filter((row) => {
    if (row.delta === null || row.delta >= 0 || !row.targetValue) {
      return false;
    }

    return Math.abs(row.delta) <= Math.max(500, Math.round(row.targetValue * 0.1));
  }).length;
  const previewItem = previewItemId ? catalogueById.get(previewItemId) : undefined;
  const previewOwned = previewItem
    ? collection.find((item) => item.catalogueId === previewItem.id)
    : undefined;
  const previewWishlist = previewItem
    ? wishlist.find((item) => item.catalogueId === previewItem.id)
    : undefined;

  async function handleUpdate(event: FormEvent<HTMLFormElement>, itemId: string) {
    event.preventDefault();
    if (savingId) {
      return;
    }

    setSavingId(itemId);
    const saved = await updateWishlistItem(itemId, new FormData(event.currentTarget));
    setSavingId("");

    if (saved) {
      setEditingId("");
    }
  }

  function renderWishlistEditForm(item: WishlistItem, catalogueItem: CatalogueItem) {
    const variantLabel = wishlistVariantSelectionLabel(item, catalogueItem);

    return (
      <form
        className="form-stack wishlist-edit-form"
        onClick={(event) => event.stopPropagation()}
        onSubmit={(event) => void handleUpdate(event, item.id)}
      >
        <div className="panel-title-row compact-row">
          <strong>Edit target</strong>
          <span className={`priority-pill priority-${item.priority.toLowerCase()}`}>{item.priority}</span>
        </div>
        <div className="field-grid">
          {catalogueItem.type === "card" ? (
            <Field label="Card finish">
              <select name="variant" defaultValue={variantLabel ?? ""}>
                {!variantLabel ? <option value="">Preferred market finish</option> : null}
                {catalogueVariantLabels(catalogueItem, variantLabel).map((variant) => (
                  <option key={variant} value={variant}>{variant}</option>
                ))}
              </select>
            </Field>
          ) : null}
          <Field label="Priority">
            <select name="priority" defaultValue={item.priority}>
              <option>Low</option>
              <option>Medium</option>
              <option>High</option>
              <option>Grail</option>
            </select>
          </Field>
          <Field label="Target price">
            <input
              name="targetPrice"
              inputMode="decimal"
              defaultValue={moneyInputValue(item.targetPriceMinor)}
              placeholder="£0.00"
            />
          </Field>
        </div>
        <Field label="Notes">
          <textarea name="notes" defaultValue={item.notes ?? ""} placeholder="Optional buying notes" />
        </Field>
        <div className="actions item-action-grid">
          <button className="button primary" type="submit" disabled={savingId === item.id}>
            <Check size={17} />
            {savingId === item.id ? "Saving" : "Save target"}
          </button>
          <button className="button" type="button" onClick={() => setEditingId("")}>
            <X size={17} />
            Cancel
          </button>
        </div>
      </form>
    );
  }

  function renderWishlistActions(row: WishlistRow, mode: "card" | "table") {
    const isCard = mode === "card";

    return (
      <div
        className={isCard ? "wishlist-card-actions" : "wishlist-table-actions"}
        onClick={(event) => event.stopPropagation()}
      >
        <button
          className={isCard ? "button primary" : "icon-button primary"}
          type="button"
          onClick={() =>
            setAppState((current) => ({
              ...current,
              addType: row.catalogueItem.type,
              screen: "add",
              selectedCatalogueId: row.item.catalogueId,
              selectedCatalogueVariant: row.variantLabel ?? "",
            }))
          }
          aria-label="Add owned-copy details"
          title="Add owned-copy details"
        >
          <Check size={17} />
          {isCard ? "Add owned" : <span className="sr-only">Add owned-copy details</span>}
        </button>
        <button
          className={isCard ? "button wishlist-icon-action" : "icon-button"}
          type="button"
          onClick={() => setEditingId(row.item.id)}
          aria-label="Edit target"
          title="Edit target"
        >
          <Settings size={17} />
          <span className="sr-only">Edit target</span>
        </button>
        <button
          className={isCard ? "button wishlist-icon-action danger" : "icon-button danger"}
          type="button"
          onClick={() => void removeWishlistItem(row.item.id)}
          aria-label="Remove target"
          title="Remove target"
        >
          <Trash2 size={17} />
          <span className="sr-only">Remove target</span>
        </button>
      </div>
    );
  }

  function renderWishlistCard(row: WishlistRow) {
    const statusText = row.delta === null ? "Needs estimate" : wishlistDeltaText(row.delta);
    const statusClass =
      row.delta === null ? "wishlist-status neutral" : row.delta >= 0 ? "wishlist-status ready" : "wishlist-status watch";

    return (
      <article
        aria-label={`View ${catalogueItemTitle(row.catalogueItem)}`}
        className="collection-lot-card wishlist-lot-card clickable"
        key={row.item.id}
        onClick={() => !row.isEditing && setPreviewItemId(row.catalogueItem.id)}
        onKeyDown={(event) => {
          if (!row.isEditing && (event.key === "Enter" || event.key === " ")) {
            event.preventDefault();
            setPreviewItemId(row.catalogueItem.id);
          }
        }}
        role="button"
        tabIndex={0}
      >
        <div className="wishlist-card-top">
          <div className="item-image collection-lot-image">{renderItemImage(row.catalogueItem)}</div>
          <div className="wishlist-card-copy">
            <h3>{catalogueItemTitle(row.catalogueItem)}</h3>
            <p className="collection-lot-set">{catalogueItemSetLabel(row.catalogueItem)} | {row.catalogueItem.number}</p>
            {row.variantLabel ? <span className="tag blue">{row.variantLabel}</span> : null}
          </div>
          <span className={`priority-pill priority-${row.item.priority.toLowerCase()}`}>{row.item.priority}</span>
        </div>
        <div className="wishlist-card-body">
          {row.isEditing ? (
            renderWishlistEditForm(row.item, row.catalogueItem)
          ) : (
            <>
              <div className="wishlist-card-meta">
                <span className="wishlist-card-price">
                  <small>Target</small>
                  <strong>{formatValuation(row.targetValue)}</strong>
                </span>
                <span className="wishlist-card-market">
                  <small>Market</small>
                  <strong>{formatValuation(row.currentValue)}</strong>
                </span>
                <span className={statusClass}>{statusText}</span>
              </div>
              {renderWishlistActions(row, "card")}
            </>
          )}
        </div>
      </article>
    );
  }

  return (
    <section className="page">
      <PageHeader
        title="Wishlist"
        action={
          <button className="button primary" onClick={() => startAdd("card")}>
            <Plus size={17} />
            Add target
          </button>
        }
      />
      <div className="summary-strip wishlist-overview-strip">
        <span><small>Wanted</small><strong>{wishlist.length}</strong><em>{wishlistInsight.grailCount} grail</em></span>
        <span><small>Target total</small><strong>{formatMoney(wishlistTotal)}</strong></span>
        <span><small>Ready now</small><strong className={wishlistInsight.targetHits ? "positive" : ""}>{wishlistInsight.targetHits}</strong></span>
        <span><small>Watch band</small><strong>{watchCount}</strong></span>
      </div>
      {wishlist.length ? (
        <div className="toolbar wishlist-toolbar">
          <div className="collection-toolbar-head">
            <label className="search-box">
              <Search size={17} />
              <input
                value={wishlistSearch}
                onChange={(event) => setWishlistSearch(event.target.value)}
                placeholder="Search name, set, notes"
              />
            </label>
            <div className="toolbar-actions">
              <label className="sort-control compact-sort-control">
                <ArrowDownUp size={16} />
                <span className="sr-only">Sort wishlist</span>
                <select value={sort} onChange={(event) => setSort(event.target.value as WishlistSort)}>
                  <option value="priority-desc">Priority</option>
                  <option value="target-desc">Target high to low</option>
                  <option value="target-asc">Target low to high</option>
                  <option value="market-desc">Market high to low</option>
                  <option value="market-asc">Market low to high</option>
                  <option value="set-number-asc">Set number low to high</option>
                  <option value="set-number-desc">Set number high to low</option>
                  <option value="name-asc">Name A-Z</option>
                  <option value="name-desc">Name Z-A</option>
                </select>
              </label>
              <div className="segmented compact" aria-label="Wishlist view">
                <button
                  className={appState.wishlistView === "list" ? "active" : ""}
                  type="button"
                  onClick={() => setAppState((current) => ({ ...current, wishlistView: "list" }))}
                  aria-label="Table view"
                >
                  <List size={16} />
                </button>
                <button
                  className={appState.wishlistView === "grid" ? "active" : ""}
                  type="button"
                  onClick={() => setAppState((current) => ({ ...current, wishlistView: "grid" }))}
                  aria-label="Cards view"
                >
                  <Grid2X2 size={16} />
                </button>
              </div>
            </div>
          </div>
          <p className="result-meta">
            {wishlistRows.length} of {wishlist.length} targets | {wishlistInsight.targetHits} ready now
          </p>
        </div>
      ) : null}
      <div className="wishlist-results">
        {wishlistRows.length ? (
          appState.wishlistView === "grid" ? (
            <div className="collection-grid wishlist-grid">
              {wishlistRows.map((row) => renderWishlistCard(row))}
            </div>
          ) : (
            <>
              <div className="mobile-list wishlist-mobile-list">
                {wishlistRows.map((row) => renderWishlistCard(row))}
              </div>
              <div className="table-wrap wishlist-table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Target</th>
                      <th>Priority</th>
                      <th>Buy price</th>
                      <th>Market</th>
                      <th>Status</th>
                      <th>Notes</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {wishlistRows.map((row) => (
                      <Fragment key={row.item.id}>
                        <tr
                          aria-label={`View ${catalogueItemTitle(row.catalogueItem)}`}
                          className="wishlist-table-row clickable-row"
                          onClick={() => !row.isEditing && setPreviewItemId(row.catalogueItem.id)}
                          onKeyDown={(event) => {
                            if (!row.isEditing && (event.key === "Enter" || event.key === " ")) {
                              event.preventDefault();
                              setPreviewItemId(row.catalogueItem.id);
                            }
                          }}
                          role="button"
                          tabIndex={0}
                        >
                          <td>
                            <div className="table-item wishlist-table-item">
                              <div className="table-thumb">{renderItemImage(row.catalogueItem)}</div>
                              <div>
                                <strong>{catalogueItemTitle(row.catalogueItem)}</strong>
                                <span>{catalogueItemSetLabel(row.catalogueItem)} | {row.catalogueItem.number}</span>
                                {row.variantLabel ? <span>{row.variantLabel}</span> : null}
                              </div>
                            </div>
                          </td>
                          <td>
                            <span className={`priority-pill priority-${row.item.priority.toLowerCase()}`}>
                              {row.item.priority}
                            </span>
                          </td>
                          <td><strong>{formatValuation(row.targetValue)}</strong></td>
                          <td className="wishlist-market-cell"><strong>{formatValuation(row.currentValue)}</strong></td>
                          <td>
                            <span className={
                              row.delta === null
                                ? "wishlist-table-status neutral"
                                : row.delta >= 0
                                  ? "wishlist-table-status ready"
                                  : "wishlist-table-status watch"
                            }>
                              {row.delta === null ? "Needs estimate" : wishlistDeltaText(row.delta)}
                            </span>
                          </td>
                          <td className="wishlist-table-note">{row.item.notes || "No notes"}</td>
                          <td>{renderWishlistActions(row, "table")}</td>
                        </tr>
                        {row.isEditing ? (
                          <tr className="wishlist-edit-row">
                            <td colSpan={7}>{renderWishlistEditForm(row.item, row.catalogueItem)}</td>
                          </tr>
                        ) : null}
                      </Fragment>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )
        ) : (
          <EmptyState
            title={wishlist.length ? "No matching wishlist targets" : "No wishlist items"}
            description={
              wishlist.length
                ? "Try a different search or sort your full target list."
                : "Add cards or sealed products you want to track before buying."
            }
            action={
              <button className="button primary" type="button" onClick={() => startAdd("card")}>
                <Plus size={17} />
                Add target
              </button>
            }
          />
        )}
      </div>
      {previewItem ? (
        <CataloguePreviewModal
          item={previewItem}
          owned={previewOwned}
          wanted
          onAdd={() => {
            setPreviewItemId(null);
            setAppState((current) => ({
              ...current,
              addType: previewItem.type,
              selectedCatalogueId: previewItem.id,
              selectedCatalogueVariant: previewWishlist?.variant ?? "",
            }));
            navigate("add");
          }}
          onClose={() => setPreviewItemId(null)}
          onOpenOwned={() => {
            if (!previewOwned) {
              return;
            }

            setPreviewItemId(null);
            setAppState((current) => ({ ...current, selectedItemId: previewOwned.id }));
            navigate("item");
          }}
          onWant={() => undefined}
        />
      ) : null}
    </section>
  );
}

function AlertsScreen({
  appState,
  intelligence,
  startPlusCheckout,
  setAppState,
}: ScreenContext) {
  const [alertView, setAlertView] = useState<"all" | "targets" | "prices" | "collection">("all");
  const alerts = intelligence.actionQueue.filter((alert) => alert.category !== "Momentum");
  const priceAlerts = intelligence.priceAlerts;
  const targetAlerts = priceAlerts.filter((alert) => alert.category === "Wishlist");
  const confidenceAlerts = priceAlerts.filter((alert) => alert.category === "Price confidence");
  const targetHits = targetAlerts.filter((alert) => alert.status === "Hit").length;
  const visiblePriceAlerts = alertView === "all"
    ? priceAlerts
    : alertView === "targets"
      ? targetAlerts
      : alertView === "prices"
        ? confidenceAlerts
        : [];
  const visibleCollectionAlerts = alertView === "all" || alertView === "collection" ? alerts : [];

  function openAlert(alert: InsightAction) {
    if (alert.category === "Wishlist") {
      setAppState((current) => ({ ...current, screen: "wishlist" }));
      return;
    }

    if (alert.category === "Storage") {
      setAppState((current) => ({ ...current, screen: "settings" }));
      return;
    }

    if (alert.category === "Momentum") {
      setAppState((current) => ({ ...current, screen: "analytics" }));
      return;
    }

    if (alert.id === "unvalued-lots") {
      setAppState((current) => ({
        ...current,
        screen: "collection",
        collectionFilter: "unknown",
        collectionValueFilter: "unvalued",
      }));
      return;
    }

    if (alert.id === "manual-valuations") {
      setAppState((current) => ({
        ...current,
        screen: "collection",
        collectionFilter: "all",
        collectionValueFilter: "manual",
      }));
      return;
    }

    if (alert.id === "weak-price-confidence") {
      setAppState((current) => ({
        ...current,
        screen: "collection",
        collectionFilter: "all",
        collectionValueFilter: "weak",
      }));
      return;
    }

    setAppState((current) => ({ ...current, screen: "collection", collectionFilter: "all" }));
  }

  function openPriceAlert(alert: CollectionIntelligence["priceAlerts"][number]) {
    if (alert.collectionItemId) {
      setAppState((current) => ({
        ...current,
        screen: "item",
        selectedItemId: alert.collectionItemId ?? current.selectedItemId,
      }));
      return;
    }

    setAppState((current) => ({
      ...current,
      screen: "wishlist",
    }));
  }

  return (
    <section className="page">
      <PageHeader
        title="Alerts"
        action={
          <span className="status-pill">
            <Bell size={17} />
            {alerts.length + (appState.plus ? priceAlerts.length : 0)} open
          </span>
        }
      />
      <div className="alert-summary-strip">
        <span><strong>{targetHits}</strong><small>targets ready to buy</small></span>
        <span><strong>{confidenceAlerts.length}</strong><small>prices to review</small></span>
        <span><strong>{alerts.length}</strong><small>collection actions</small></span>
      </div>
      <div className="segmented alert-view-tabs" aria-label="Alert type">
        <button
          aria-pressed={alertView === "all"}
          className={alertView === "all" ? "active" : ""}
          onClick={() => setAlertView("all")}
          type="button"
        >
          All <span>{alerts.length + (appState.plus ? priceAlerts.length : 0)}</span>
        </button>
        <button
          aria-pressed={alertView === "targets"}
          className={alertView === "targets" ? "active" : ""}
          onClick={() => setAlertView("targets")}
          type="button"
        >
          Buy targets <span>{targetAlerts.length}</span>
        </button>
        <button
          aria-pressed={alertView === "prices"}
          className={alertView === "prices" ? "active" : ""}
          onClick={() => setAlertView("prices")}
          type="button"
        >
          Price quality <span>{confidenceAlerts.length}</span>
        </button>
        <button
          aria-pressed={alertView === "collection"}
          className={alertView === "collection" ? "active" : ""}
          onClick={() => setAlertView("collection")}
          type="button"
        >
          Collection <span>{alerts.length}</span>
        </button>
      </div>

      {alertView !== "collection" ? (
        <section className="tool-panel alerts-panel">
          <div className="panel-title-row">
            <div>
              <h2>{alertView === "targets" ? "Buy targets" : alertView === "prices" ? "Price quality" : "Price decisions"}</h2>
              <p className="muted">Prices that are close to your target or need a closer look.</p>
            </div>
            <span className="plan-pill"><Sparkles size={17} />Plus</span>
          </div>
          {!appState.plus ? (
            <div className="locked-preview">
              <div>
                <strong>Automated price alerts are a Plus feature.</strong>
                <p className="muted">Plus adds email digests when targets hit or a weak estimate needs review.</p>
              </div>
              <div className="upgrade-actions">
                <button className="button primary" onClick={() => void startPlusCheckout("monthly")}>
                  <CreditCard size={17} />
                  Monthly
                </button>
                <button className="button" onClick={() => void startPlusCheckout("yearly")}>
                  <Sparkles size={17} />
                  Yearly
                </button>
              </div>
            </div>
          ) : visiblePriceAlerts.length ? (
            <div className="alert-list compact-alert-list">
              {visiblePriceAlerts.map((alert) => (
                <article className={`alert-row compact-alert-row alert-${alert.status.toLowerCase()}`} key={alert.id}>
                  <span className={`decision-icon ${alert.status === "Hit" ? "good" : alert.status === "Refresh" ? "action" : "watch"}`}>
                    {alert.status === "Hit" ? <Check size={17} /> : alert.status === "Refresh" ? <RefreshCw size={17} /> : <Bell size={17} />}
                  </span>
                  <div className="alert-main">
                    <div className="tag-row">
                      <span className={`tag ${priceAlertTagClass(alert.status)}`}>{alert.status}</span>
                      <span className="tag">{alert.category}</span>
                    </div>
                    <strong>{alert.itemName}</strong>
                    <p className="alert-lead">{alert.explanation}</p>
                    <div className="alert-value-strip">
                      <span><small>Current</small><b>{formatMoney(alert.currentValueMinor)}</b></span>
                      {alert.targetValueMinor !== undefined ? (
                        <span><small>Target</small><b>{formatMoney(alert.targetValueMinor)}</b></span>
                      ) : null}
                      <span><small>Checked</small><b>{alert.priceObservedAt ? formatEventDate(alert.priceObservedAt) : "Pending"}</b></span>
                    </div>
                    {alert.priceSource ? <span className="alert-source">{priceSourceLabel(alert.priceSource)}</span> : null}
                  </div>
                  <button className="button small" onClick={() => openPriceAlert(alert)}>
                    {alert.category === "Wishlist" ? "View target" : "Review value"}
                    <ArrowRight size={16} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="No price alerts" description="No targets or weak estimates need attention right now." />
          )}
        </section>
      ) : null}
      {alertView === "all" || alertView === "collection" ? (
        <section className="tool-panel alerts-panel">
          <div className="panel-title-row">
            <div>
              <h2>Collection actions</h2>
              <p className="muted">Practical fixes that improve the accuracy and organisation of your collection.</p>
            </div>
            <span className="status-pill">{visibleCollectionAlerts.length} open</span>
          </div>
          {visibleCollectionAlerts.length ? (
            <div className="alert-list compact-alert-list">
              {visibleCollectionAlerts.map((alert) => (
                <article className="alert-row compact-alert-row" key={alert.id}>
                  <span className={`decision-icon ${alert.tone === "good" ? "good" : alert.tone === "action" ? "action" : "watch"}`}>
                    <Info size={17} />
                  </span>
                  <div className="alert-main">
                    <div className="tag-row">
                      <span className={`tag ${actionTagClass(alert.tone)}`}>{alert.category}</span>
                      <span className={`tag ${impactTagClass(alert.impact)}`}>{alert.impact}</span>
                    </div>
                    <strong>{alert.title}</strong>
                    <p className="alert-lead">{alert.detail}</p>
                  </div>
                  <button className="button small" onClick={() => openAlert(alert)}>
                    {alert.actionLabel}
                    <ArrowRight size={16} />
                  </button>
                </article>
              ))}
            </div>
          ) : (
            <EmptyState title="Collection review is clear" />
          )}
        </section>
      ) : null}
    </section>
  );
}

function AnalyticsScreen({
  appState,
  intelligence,
  navigate,
  setAppState,
  startPlusCheckout,
  summary,
  wishlistTotal,
}: ScreenContext) {
  const gain = summary.value - summary.cost;
  const duplicateValue = intelligence.duplicates.reduce((total, item) => total + item.valueMinor, 0);
  const leadAction = intelligence.actionQueue[0];
  const realizedSales = intelligence.realizedSales;
  const portfolioRangeDelta = portfolioRangeChange(intelligence.portfolioHistory, "30d");

  if (!appState.plus) {
    return (
      <section className="page">
        <PageHeader title="Insights" action={<span className="status-pill"><Lock size={17} />Free</span>} />
        <div className="insights-summary-grid">
          <StatCard label="Portfolio value" value={formatMoney(summary.value)} note={`${summary.items} tracked lots`} />
          <StatCard label="Total gain/loss" value={formatSignedMoney(gain)} note={`Cost basis ${formatMoney(summary.cost)}`} positive={gain >= 0} />
          <StatCard label="Priced holdings" value={`${intelligence.valuationCoverage.coveragePercent}%`} note={`${intelligence.valuationCoverage.knownLots} of ${intelligence.valuationCoverage.totalLots} lots`} />
          <StatCard label="Buy targets hit" value={intelligence.wishlistOpportunities.length.toString()} note={`${formatMoney(wishlistTotal)} target list`} />
        </div>
        <div className="insights-free-grid">
          <TopHoldings
            holdings={intelligence.topHoldings}
            onOpen={(holding) => setAppState((current) => ({ ...current, screen: "item", selectedItemId: holding.id }))}
          />
          <section className="tool-panel">
            <div className="panel-title-row">
              <h2>Collection snapshot</h2>
              <span className="status-pill">{intelligence.healthScore}/100</span>
            </div>
            <MetricList
              rows={[
                ["Best performer", intelligence.bestPerformer ? gainLabel(intelligence.bestPerformer) : "Add purchase prices"],
                ["Next action", leadAction?.title ?? "Collection looks tidy"],
                ["Needs estimate", `${intelligence.valuationCoverage.unvaluedLots} lots`],
                ["Weak prices", `${intelligence.weakConfidence.count} holdings`],
                ["Recent activity", `${intelligence.activity.last30Days} changes in 30 days`],
              ]}
            />
          </section>
          <section className="tool-panel upgrade-panel">
            <div className="panel-title-row">
              <div>
                <h2>Unlock deeper insights</h2>
                <p className="muted">Value history, price alerts, performance and collection health in one view.</p>
              </div>
              <span className="tag green">£19.99 yearly</span>
            </div>
            <div className="upgrade-actions">
              <button className="button primary" onClick={() => void startPlusCheckout("monthly")}>
                <CreditCard size={17} />
                £2.49 monthly
              </button>
              <button className="button" onClick={() => void startPlusCheckout("yearly")}>
                <Sparkles size={17} />
                £19.99 yearly
              </button>
              <button className="button" onClick={() => navigate("settings")}>
                <Settings size={17} />
                Compare
              </button>
            </div>
          </section>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <PageHeader
        title="Insights"
        action={
          <span className="status-pill">
            <RefreshCw size={16} />
            {intelligence.latestPricingAt ? `Priced ${formatEventDate(intelligence.latestPricingAt)}` : "Waiting for prices"}
          </span>
        }
      />
      <div className="insights-summary-grid">
        <StatCard label="Portfolio value" value={formatMoney(summary.value)} note={`${summary.items} tracked lots`} />
        <StatCard
          label="30-day change"
          value={portfolioRangeDelta ? formatSignedMoney(portfolioRangeDelta.valueMinor) : "Unknown"}
          note={portfolioRangeDelta ? formatSignedPercent(portfolioRangeDelta.percent) : "Needs more pricing history"}
          positive={Boolean(portfolioRangeDelta && portfolioRangeDelta.valueMinor >= 0)}
        />
        <StatCard label="Total gain/loss" value={formatSignedMoney(gain)} note={`Cost basis ${formatMoney(summary.cost)}`} positive={gain >= 0} />
        <StatCard
          label="Priced holdings"
          value={`${intelligence.valuationCoverage.coveragePercent}%`}
          note={`${intelligence.valuationCoverage.knownLots} of ${intelligence.valuationCoverage.totalLots} lots`}
          positive={intelligence.valuationCoverage.coveragePercent === 100}
        />
      </div>
      <div className="insights-primary-grid">
        <PortfolioHistoryPanel history={intelligence.portfolioHistory} currentValueMinor={summary.value} />
        <section className="tool-panel insights-next-actions">
          <div className="panel-title-row">
            <div>
              <h2>Needs attention</h2>
              <p className="muted">The most useful next steps for this collection.</p>
            </div>
            <span className="status-pill">{intelligence.actionQueue.length + intelligence.priceAlerts.length} open</span>
          </div>
          {intelligence.actionQueue.length || intelligence.priceAlerts.length ? (
            <div className="decision-list">
              {intelligence.priceAlerts.slice(0, 2).map((alert) => (
                <button className="decision-row" key={alert.id} onClick={() => navigate("alerts")}>
                  <span className={`decision-icon ${alert.status === "Hit" ? "good" : "watch"}`}>
                    {alert.status === "Hit" ? <Check size={17} /> : <Bell size={17} />}
                  </span>
                  <span>
                    <strong>{alert.itemName}</strong>
                    <small>{alert.explanation}</small>
                  </span>
                  <ArrowRight size={17} />
                </button>
              ))}
              {intelligence.actionQueue.slice(0, 3).map((action) => (
                <button className="decision-row" key={action.id} onClick={() => navigate("alerts")}>
                  <span className={`decision-icon ${action.tone === "good" ? "good" : action.tone === "action" ? "action" : "watch"}`}>
                    <Info size={17} />
                  </span>
                  <span>
                    <strong>{action.title}</strong>
                    <small>{action.detail}</small>
                  </span>
                  <ArrowRight size={17} />
                </button>
              ))}
            </div>
          ) : (
            <EmptyState title="Nothing needs attention" description="Your collection data and targets are up to date." />
          )}
          <button className="button" onClick={() => navigate("alerts")}>
            <Bell size={17} />
            Open alerts
          </button>
        </section>
      </div>
      <div className="insights-secondary-grid">
        <div className="insights-column">
          <TopHoldings
            holdings={intelligence.topHoldings}
            onOpen={(holding) => setAppState((current) => ({ ...current, screen: "item", selectedItemId: holding.id }))}
          />
          <PortfolioMix rows={intelligence.portfolioMix} />
        </div>
        <div className="insights-column">
          <section className="tool-panel">
            <div className="panel-title-row">
              <h2>Collection health</h2>
              <span className="status-pill">{intelligence.healthScore}/100</span>
            </div>
            <MetricList
              rows={[
                ["Status", intelligence.healthLabel],
                ["Needs estimate", `${intelligence.valuationCoverage.unvaluedLots} lots`],
                ["Weak prices", `${intelligence.weakConfidence.count} holdings`],
                ["Manual values", `${intelligence.valuationCoverage.manualLots} lots`],
                ["Duplicates", `${intelligence.duplicates.length} groups | ${formatMoney(duplicateValue)}`],
              ]}
            />
          </section>
          <section className="tool-panel">
            <div className="panel-title-row">
              <h2>Performance</h2>
              <Sparkles size={18} />
            </div>
            <MetricList
              rows={[
                ["Best holding", intelligence.bestPerformer ? gainLabel(intelligence.bestPerformer) : "Add purchase prices"],
                ["Sales proceeds", formatMoney(realizedSales.proceedsMinor)],
                ["Realised gain", formatSignedMoney(realizedSales.gainMinor), realizedSales.gainMinor >= 0 ? "positive" : ""],
                ["Recent activity", `${intelligence.activity.last30Days} changes in 30 days`],
                ["Wishlist targets hit", intelligence.wishlistOpportunities.length],
              ]}
            />
          </section>
        </div>
      </div>
    </section>
  );
}

function OperationsLockedScreen() {
  return (
    <section className="page">
      <PageHeader title="Operations" action={<span className="status-pill"><ShieldCheck size={17} />Admin</span>} />
      <EmptyState title="Admin access required." />
    </section>
  );
}




function SettingsScreen({
  appState,
  viewer,
  dataSource,
  dataNotice,
  isLoadingData,
  notificationPreferences,
  subscription,
  resetSampleData,
  storageLocations,
  createStorageLocation,
  deleteStorageLocation,
  exportCollectionCsv,
  exportInsuranceReport,
  cancelPlusSubscription,
  openBillingPortal,
  startPlusCheckout,
  updateNotificationPreferences,
  downloadImportTemplate,
  previewCollectionCsv,
  importCollectionCsv,
  navigate,
  showToast,
  setThemeId,
  themeId,
}: ScreenContext) {
  return (
    <section className="page">
      <PageHeader
        title="Settings"
        action={
          canUseOperationsForUser(viewer.role) ? (
            <button className="button" onClick={() => navigate("ops")}>
              <TerminalSquare size={17} />
              Admin operations
            </button>
          ) : null
        }
      />
      <div className="settings-overview-grid">
        <AccountPanel showToast={showToast} viewer={viewer} />
        <MetricPanel
          title="Plan"
          rows={[
            ["Plan", appState.plus ? "Plus" : "Free"],
            ["Billing", billingStatusLabel(subscription)],
            ["Currency", "\u00a3 GBP"],
          ]}
        />
      </div>
      <div className="settings-columns">
        <div className="settings-stack">
          <BillingPanel
            plus={appState.plus}
            subscription={subscription}
            onCancelSubscription={cancelPlusSubscription}
            onOpenBillingPortal={openBillingPortal}
            onStartCheckout={startPlusCheckout}
          />
          <NotificationPreferencesPanel
            plus={appState.plus}
            preferences={notificationPreferences}
            onUpdate={updateNotificationPreferences}
          />
          <StoragePanel
            locations={storageLocations}
            onCreate={createStorageLocation}
            onDelete={deleteStorageLocation}
          />
        </div>
        <div className="settings-stack">
          <SettingsShortcutsPanel navigate={navigate} />
          <ThemePanel
            plus={appState.plus}
            selectedThemeId={themeId}
            onSelectTheme={setThemeId}
            onStartCheckout={startPlusCheckout}
          />
          <DataPanel
            plus={appState.plus}
            onExportCollection={exportCollectionCsv}
            onExportInsuranceReport={exportInsuranceReport}
            onDownloadTemplate={downloadImportTemplate}
            onPreviewCollectionImport={previewCollectionCsv}
            onImportCollection={importCollectionCsv}
            onResetSampleData={resetSampleData}
            samplePreviewEnabled={developmentSamplePreviewEnabled}
          />
          <MetricPanel
            title="Data source"
            rows={[
              ["Mode", isLoadingData ? "Loading" : dataSource === "database" ? "Prisma database" : "Local sample preview"],
              ["Status", dataNotice || "Connected"],
            ]}
          />
          {canUseOperationsForUser(viewer.role) ? <OperationsEntryPanel onOpen={() => navigate("ops")} /> : null}
        </div>
      </div>
    </section>
  );
}

function AccountPanel({
  showToast,
  viewer,
}: {
  showToast: (message: string, tone?: ToastTone) => void;
  viewer: Viewer;
}) {
  const [isExporting, setIsExporting] = useState(false);
  const [isExportOpen, setIsExportOpen] = useState(false);
  const [exportPassword, setExportPassword] = useState("");
  const [exportError, setExportError] = useState("");
  const [showExportPassword, setShowExportPassword] = useState(false);
  const [isSendingVerification, setIsSendingVerification] = useState(false);
  const [isDeleteOpen, setIsDeleteOpen] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteEmail, setDeleteEmail] = useState("");
  const [deletePassword, setDeletePassword] = useState("");
  const [deleteConfirmation, setDeleteConfirmation] = useState("");
  const [deleteError, setDeleteError] = useState("");
  const [showDeletePassword, setShowDeletePassword] = useState(false);
  const confirmationPhrase = "DELETE MY ACCOUNT";
  const canDelete =
    deleteConfirmation === confirmationPhrase &&
    deleteEmail.trim().toLowerCase() === viewer.email.trim().toLowerCase() &&
    deletePassword.length >= 8;

  async function exportAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isExporting) return;
    setIsExporting(true);
    setExportError("");
    try {
      const response = await fetch("/api/account/export", {
        cache: "no-store",
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: exportPassword }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Account export failed with ${response.status}.`);
      }
      downloadBlob(`mintbinder-account-${dateStamp()}.json`, await response.blob());
      setExportPassword("");
      setIsExportOpen(false);
      showToast("Account JSON export downloaded.");
    } catch (error) {
      setExportError(error instanceof Error ? error.message : "Account export could not be downloaded.");
    } finally {
      setIsExporting(false);
    }
  }

  async function resendVerification() {
    if (isSendingVerification) return;
    setIsSendingVerification(true);
    try {
      const response = await fetch("/api/auth/verification", { method: "POST" });
      const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) throw new Error(body.error ?? `Verification request failed with ${response.status}.`);
      showToast(body.message ?? "Verification email sent.");
    } catch (error) {
      showToast(error instanceof Error ? error.message : "Verification email could not be sent.", "error");
    } finally {
      setIsSendingVerification(false);
    }
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canDelete || isDeleting) return;
    setIsDeleting(true);
    setDeleteError("");
    try {
      const response = await fetch("/api/account", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmation: deleteConfirmation,
          email: deleteEmail,
          password: deletePassword,
        }),
      });
      const body = (await response.json().catch(() => ({}))) as { error?: string; message?: string };
      if (!response.ok) throw new Error(body.error ?? `Account deletion failed with ${response.status}.`);
      window.localStorage.removeItem(binderStorageKey(viewer.email));
      window.localStorage.removeItem(defaultBinderSettingsStorageKey(viewer.email));
      window.localStorage.removeItem(binderMigrationStorageKey(viewer.email));
      await signOut({ redirect: false });
      window.location.assign("/");
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "Account deletion failed. Nothing was deleted.");
      setIsDeleting(false);
    }
  }

  return (
    <section className="tool-panel account-panel">
      <div className="panel-title-row">
        <h2>Account</h2>
        <UserRound size={18} />
      </div>
      <MetricList
        rows={[
          ["Name", viewer.name],
          ["Email", viewer.email],
          ["Email status", viewer.emailVerified ? "Verified" : "Verification pending"],
          ["Role", viewer.role === "ADMIN" ? "Admin" : "User"],
        ]}
      />
      <div className="actions">
        <button className="button" type="button" disabled={isExporting} onClick={() => {
          setExportError("");
          setIsExportOpen((open) => !open);
        }}>
          <Download size={17} />
          {isExportOpen ? "Cancel account export" : "Export account JSON"}
        </button>
        {viewer.emailVerified ? (
          <span className="account-verification verified" role="status">
            <ShieldCheck size={17} />
            Email verified
          </span>
        ) : (
          <button className="button" type="button" disabled={isSendingVerification} onClick={() => void resendVerification()}>
            <Mail size={17} />
            {isSendingVerification ? "Sending" : "Resend verification email"}
          </button>
        )}
        <Link className="button" href="/auth/forgot-password">
          <Lock size={17} />
          Reset password
        </Link>
      </div>
      {isExportOpen ? (
        <form className="form-stack account-export-form" onSubmit={exportAccount}>
          <p className="muted">For your security, confirm your current password before downloading the complete account archive.</p>
          <Field label="Current password">
            <input
              autoComplete="current-password"
              maxLength={128}
              minLength={8}
              onChange={(event) => setExportPassword(event.target.value)}
              required
              type={showExportPassword ? "text" : "password"}
              value={exportPassword}
            />
          </Field>
          <label className="check-row auth-password-visibility">
            <input type="checkbox" checked={showExportPassword} onChange={(event) => setShowExportPassword(event.target.checked)} />
            <span>Show password</span>
          </label>
          {exportError ? <p className="auth-error" role="alert">{exportError}</p> : null}
          <button className="button primary" type="submit" disabled={isExporting || exportPassword.length < 8}>
            <Download size={17} />
            {isExporting ? "Preparing export" : "Confirm and download"}
          </button>
        </form>
      ) : null}
      <div className="account-danger-zone">
        <button className="button danger" type="button" onClick={() => setIsDeleteOpen((open) => !open)}>
          <Trash2 size={17} />
          {isDeleteOpen ? "Cancel account deletion" : "Delete account…"}
        </button>
        {isDeleteOpen ? (
          <form className="form-stack account-delete-form" onSubmit={deleteAccount}>
            <div className="account-delete-warning" role="alert">
              <strong>This permanently deletes the account.</strong>
              <span>Collection, wishlist, binder, alert, storage, and billing records cannot be recovered. Download the JSON export first.</span>
            </div>
            <Field label="Confirm account email">
              <input autoComplete="email" inputMode="email" value={deleteEmail} onChange={(event) => setDeleteEmail(event.target.value)} required />
            </Field>
            <Field label="Current password">
              <input autoComplete="current-password" type={showDeletePassword ? "text" : "password"} value={deletePassword} onChange={(event) => setDeletePassword(event.target.value)} minLength={8} required />
            </Field>
            <label className="check-row auth-password-visibility">
              <input type="checkbox" checked={showDeletePassword} onChange={(event) => setShowDeletePassword(event.target.checked)} />
              <span>Show password</span>
            </label>
            <Field label={`Type “${confirmationPhrase}”`}>
              <input value={deleteConfirmation} onChange={(event) => setDeleteConfirmation(event.target.value)} autoComplete="off" required />
            </Field>
            {deleteError ? <p className="auth-error" role="alert">{deleteError}</p> : null}
            <button className="button danger" type="submit" disabled={!canDelete || isDeleting}>
              <Trash2 size={17} />
              {isDeleting ? "Permanently deleting" : "Permanently delete account"}
            </button>
          </form>
        ) : null}
      </div>
    </section>
  );
}

function SettingsShortcutsPanel({ navigate }: { navigate: (screen: Screen) => void }) {
  return (
    <section className="tool-panel settings-shortcuts-panel">
      <div className="panel-title-row">
        <h2>More</h2>
        <Grid2X2 size={18} />
      </div>
      <div className="shortcut-grid">
        <button className="button" onClick={() => navigate("binders")}>
          <BookOpen size={17} />
          Binders
        </button>
        <button className="button" onClick={() => navigate("alerts")}>
          <Bell size={17} />
          Alerts
        </button>
        <button className="button" onClick={() => navigate("analytics")}>
          <BarChart3 size={17} />
          Insights
        </button>
        <button className="button" onClick={() => navigate("sets")}>
          <GalleryVerticalEnd size={17} />
          Sets
        </button>
      </div>
    </section>
  );
}

function TopHoldings({
  holdings,
  onOpen,
}: {
  holdings: HoldingInsight[];
  onOpen?: (holding: HoldingInsight) => void;
}) {
  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Top holdings</h2>
        <Layers3 size={18} />
      </div>
      {holdings.length ? (
        <div className="holding-rank-list">
          {holdings.slice(0, 5).map((holding, index) => (
            <button className="holding-rank-row" disabled={!onOpen} key={holding.id} onClick={() => onOpen?.(holding)}>
              <span className="holding-rank">{index + 1}</span>
              <span className="holding-rank-copy">
                <strong>{holding.name}</strong>
                <small>{holding.set}</small>
              </span>
              <span className="holding-rank-value">
                <strong>{formatMoney(holding.valueMinor)}</strong>
                {holding.gainMinor === null ? null : (
                  <small className={holding.gainMinor >= 0 ? "positive" : "negative"}>{formatSignedMoney(holding.gainMinor)}</small>
                )}
              </span>
              {onOpen ? <ArrowRight size={17} /> : null}
            </button>
          ))}
        </div>
      ) : (
        <p className="muted">Add collection items to rank holdings.</p>
      )}
    </section>
  );
}

function PortfolioHistoryPanel({
  currentValueMinor,
  history,
}: {
  currentValueMinor: number;
  history: CollectionIntelligence["portfolioHistory"];
}) {
  const latest = history[history.length - 1];
  const rangeChange = portfolioRangeChange(history, "30d");

  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <div>
          <h2>Value history</h2>
          <p className="muted">Portfolio value using the latest price available on each day.</p>
        </div>
        <span className="status-pill">{latest ? formatEventDate(latest.observedAt) : "No history"}</span>
      </div>
      {history.length ? (
        <PortfolioValueLineChart currentValueMinor={currentValueMinor} history={history} />
      ) : (
        <p className="muted">Run pricing imports to build a dated portfolio value history.</p>
      )}
      <div className="chart-summary-row">
        <span><small>Latest value</small><strong>{latest ? formatMoney(latest.valueMinor) : formatMoney(currentValueMinor)}</strong></span>
        <span><small>30-day change</small><strong className={rangeChange && rangeChange.valueMinor >= 0 ? "positive" : ""}>{rangeChange ? `${formatSignedMoney(rangeChange.valueMinor)} (${formatSignedPercent(rangeChange.percent)})` : "Building history"}</strong></span>
        <span><small>Price basis</small><strong>{latest ? `${latest.marketLots} market | ${latest.manualLots} manual` : "Unknown"}</strong></span>
      </div>
    </section>
  );
}

function PortfolioMix({
  rows,
}: {
  rows: CollectionIntelligence["portfolioMix"];
}) {
  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Portfolio mix</h2>
        <BarChart3 size={18} />
      </div>
      {rows.length ? (
        <div className="metric-list">
          {rows.map((row) => (
            <div className="metric-row" key={row.label}>
              <span>{row.label}</span>
              <strong>{formatMoney(row.valueMinor)} | {row.share}%</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No portfolio mix yet.</p>
      )}
    </section>
  );
}

function ThemePanel({
  onSelectTheme,
  onStartCheckout,
  plus,
  selectedThemeId,
}: {
  onSelectTheme: (themeId: ThemeId) => void;
  onStartCheckout: (plan: "monthly" | "yearly") => Promise<void>;
  plus: boolean;
  selectedThemeId: ThemeId;
}) {
  return (
    <section className="tool-panel theme-panel">
      <div className="panel-title-row">
        <h2>Themes</h2>
        <span className="plan-pill">
          <Palette size={17} />
          {plus ? "Plus palette" : "Core dark themes"}
        </span>
      </div>
      <p className="muted">
        Free includes Pulse and Graphite. Plus unlocks darker collector colour schemes for a more personal workspace.
      </p>
      <div className="theme-grid">
        {themeOptions.map((theme) => {
          const locked = theme.access === "plus" && !plus;
          const selected = theme.id === selectedThemeId;

          return (
            <button
              aria-pressed={selected}
              className={`theme-option${selected ? " selected" : ""}${locked ? " locked" : ""}`}
              disabled={locked}
              key={theme.id}
              onClick={() => onSelectTheme(theme.id)}
              type="button"
            >
              <span className="theme-swatches" aria-hidden="true">
                {theme.swatches.map((swatch) => (
                  <span key={swatch} style={{ background: swatch }} />
                ))}
              </span>
              <span className="theme-copy">
                <strong>{theme.name}</strong>
                <small>{theme.description}</small>
              </span>
              <span className={locked ? "tag amber" : selected ? "tag green" : "tag"}>
                {locked ? "Plus" : selected ? "Active" : theme.access === "free" ? "Free" : "Plus"}
              </span>
            </button>
          );
        })}
      </div>
      {!plus ? (
        <div className="locked-preview">
          <div>
            <strong>Want the full palette?</strong>
            <p className="muted">Plus adds a dozen extra dark schemes alongside analytics, alerts, and reports.</p>
          </div>
          <div className="upgrade-actions">
            <button className="button primary" onClick={() => void onStartCheckout("monthly")}>
              <CreditCard size={17} />
              Monthly
            </button>
            <button className="button" onClick={() => void onStartCheckout("yearly")}>
              <Sparkles size={17} />
              Yearly
            </button>
          </div>
        </div>
      ) : null}
    </section>
  );
}

function NotificationPreferencesPanel({
  onUpdate,
  plus,
  preferences,
}: {
  onUpdate: (preferences: NotificationPreferences) => Promise<boolean>;
  plus: boolean;
  preferences: NotificationPreferences;
}) {
  const [draft, setDraft] = useState(preferences);
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    setDraft(preferences);
  }, [preferences]);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    await onUpdate(draft);
    setIsSaving(false);
  }

  function updateDraft(next: Partial<NotificationPreferences>) {
    setDraft((current) => ({ ...current, ...next }));
  }

  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Notifications</h2>
        <span className="plan-pill">
          {plus ? <Mail size={17} /> : <Lock size={17} />}
          {plus ? "Email" : "Plus email"}
        </span>
      </div>
      {!plus ? (
        <p className="muted">You can set preferences now. Price-alert and wishlist-target emails send once Plus is active.</p>
      ) : null}
      <form className="form-stack" onSubmit={handleSubmit}>
        <label className="field">
          Digest frequency
          <select
            value={draft.digestFrequency}
            onChange={(event) =>
              updateDraft({ digestFrequency: event.currentTarget.value as NotificationPreferences["digestFrequency"] })
            }
          >
            <option value="Daily">Daily</option>
            <option value="Weekly">Weekly</option>
            <option value="Off">Off</option>
          </select>
        </label>
        <div className="preference-list">
          <PreferenceToggle
            checked={draft.priceAlertsEnabled}
            label="Send price alert digests"
            note="All price-watch email digests."
            onChange={(checked) => updateDraft({ priceAlertsEnabled: checked })}
          />
          <PreferenceToggle
            checked={draft.wishlistTargetAlertsEnabled}
            label="Wishlist target hits"
            note="Cards and sealed products at target."
            onChange={(checked) => updateDraft({ wishlistTargetAlertsEnabled: checked })}
          />
          <PreferenceToggle
            checked={draft.weakPriceAlertsEnabled}
            label="Weak price confidence"
            note="Owned items with low confidence values."
            onChange={(checked) => updateDraft({ weakPriceAlertsEnabled: checked })}
          />
        </div>
        <button className="button primary" type="submit" disabled={isSaving}>
          <Check size={17} />
          {isSaving ? "Saving" : "Save preferences"}
        </button>
      </form>
    </section>
  );
}

function OperationsEntryPanel({ onOpen }: { onOpen: () => void }) {
  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Operations</h2>
        <TerminalSquare size={18} />
      </div>
      <MetricList
        rows={[
          ["Import mode", "Controlled pages"],
          ["Job history", "Tracked"],
          ["Access", "JOB_SECRET"],
        ]}
      />
      <button className="button" onClick={onOpen}>
        <Database size={17} />
        Open operations
      </button>
    </section>
  );
}

function PreferenceToggle({
  checked,
  label,
  note,
  onChange,
}: {
  checked: boolean;
  label: string;
  note: string;
  onChange: (checked: boolean) => void;
}) {
  return (
    <label className="preference-row">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.currentTarget.checked)}
      />
      <span>
        <strong>{label}</strong>
        <small>{note}</small>
      </span>
    </label>
  );
}

function BillingPanel({
  plus,
  subscription,
  onCancelSubscription,
  onOpenBillingPortal,
  onStartCheckout,
}: {
  plus: boolean;
  subscription: AppSubscription;
  onCancelSubscription: () => Promise<void>;
  onOpenBillingPortal: () => Promise<void>;
  onStartCheckout: (plan: "monthly" | "yearly") => Promise<void>;
}) {
  const isSquare = subscription.provider === "square";
  const canCancelSquareRenewal = plus && isSquare && Boolean(subscription.providerSubscriptionId) && !subscription.cancelAtPeriodEnd;
  const periodLabel = billingPeriodLabel(subscription);

  return (
    <section className="tool-panel billing-panel-compact">
      <div className="panel-title-row">
        <h2>Billing</h2>
        {plus ? <span className="plan-pill"><Sparkles size={17} />Plus</span> : <span className="plan-pill"><Lock size={17} />Free</span>}
      </div>
      <div className="billing-status">
        <span><CreditCard size={16} />{billingProviderLabel(subscription.provider)}</span>
        <span><Check size={16} />{billingStatusLabel(subscription)}</span>
        {periodLabel ? <span><RefreshCw size={16} />{periodLabel}</span> : null}
      </div>
      <div className="feature-list">
        <span><Bell size={16} />Price alert emails</span>
        <span><ShieldCheck size={16} />Insurance report export</span>
        <span><RefreshCw size={16} />Automated price refreshes</span>
        <span><Mail size={16} />Wishlist target digests</span>
      </div>
      <div className="actions">
        {!plus ? (
          <>
            <button className="button primary" onClick={() => void onStartCheckout("monthly")}>
              <CreditCard size={17} />
              Monthly
            </button>
            <button className="button" onClick={() => void onStartCheckout("yearly")}>
              <Sparkles size={17} />
              Yearly
            </button>
          </>
        ) : null}
        <button className="button" onClick={() => void onOpenBillingPortal()} disabled={!plus}>
          <Settings size={17} />
          Manage billing
        </button>
        {canCancelSquareRenewal ? (
          <button className="button danger" onClick={() => void onCancelSubscription()}>
            <X size={17} />
            Cancel renewal
          </button>
        ) : null}
      </div>
    </section>
  );
}

function DataPanel({
  plus,
  onExportCollection,
  onExportInsuranceReport,
  onDownloadTemplate,
  onPreviewCollectionImport,
  onImportCollection,
  onResetSampleData,
  samplePreviewEnabled,
}: {
  plus: boolean;
  onExportCollection: () => void;
  onExportInsuranceReport: () => Promise<void>;
  onDownloadTemplate: () => void;
  onPreviewCollectionImport: (file: File) => Promise<CollectionImportPreview | null>;
  onImportCollection: (file: File) => Promise<CollectionImportResult>;
  onResetSampleData: () => void;
  samplePreviewEnabled: boolean;
}) {
  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPreview, setImportPreview] = useState<CollectionImportPreview | null>(null);
  const [isPreviewing, setIsPreviewing] = useState(false);
  const [isImporting, setIsImporting] = useState(false);
  const [isExportingInsurance, setIsExportingInsurance] = useState(false);

  async function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];
    event.currentTarget.value = "";

    if (!file) {
      return;
    }

    setImportFile(file);
    setImportPreview(null);
    setIsPreviewing(true);
    const preview = await onPreviewCollectionImport(file);
    setImportPreview(preview);
    setIsPreviewing(false);

    if (!preview) {
      setImportFile(null);
    }
  }

  async function confirmImport() {
    if (!importFile || !importPreview?.importableCount || isImporting) {
      return;
    }

    setIsImporting(true);
    const result = await onImportCollection(importFile);
    setIsImporting(false);

    if (result.imported > 0 || result.failed === 0) {
      setImportFile(null);
      setImportPreview(null);
    }
  }

  function cancelImport() {
    if (isImporting) {
      return;
    }

    setImportFile(null);
    setImportPreview(null);
  }

  async function handleInsuranceExport() {
    if (isExportingInsurance) {
      return;
    }

    setIsExportingInsurance(true);
    try {
      await onExportInsuranceReport();
    } finally {
      setIsExportingInsurance(false);
    }
  }

  return (
    <section className="tool-panel">
      <h2>Data</h2>
      <div className="actions">
        <button className="button" onClick={onExportCollection}>
          <Download size={17} />
          Export CSV
        </button>
        <button
          aria-busy={isExportingInsurance}
          aria-describedby={isExportingInsurance ? "insurance-export-progress" : undefined}
          className={plus ? "button" : "button danger"}
          disabled={isExportingInsurance}
          onClick={() => void handleInsuranceExport()}
          type="button"
        >
          {isExportingInsurance ? <RefreshCw aria-hidden="true" className="spin" size={17} /> : plus ? <Download size={17} /> : <Lock size={17} />}
          {isExportingInsurance ? "Building report…" : "Insurance report"}
        </button>
        <label className="button file-button">
          <Upload size={17} />
          {isPreviewing ? "Checking CSV" : "Import CSV"}
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={isImporting || isPreviewing}
            onChange={handleImportChange}
          />
        </label>
        <button className="button" onClick={onDownloadTemplate}>
          <Download size={17} />
          Template CSV
        </button>
        {samplePreviewEnabled ? (
          <button className="button" onClick={onResetSampleData}>
            Load sample preview
          </button>
        ) : null}
      </div>
      {isExportingInsurance ? (
        <p className="insurance-export-progress" id="insurance-export-progress" role="status">
          Building your PDF, including card images and valuation evidence. This can take a little while; keep this page open.
        </p>
      ) : null}
      {isPreviewing ? <p className="muted" role="status">Validating the selected CSV…</p> : null}
      {importFile && importPreview ? (
        <section className="import-preview" aria-labelledby="import-preview-title">
          <div className="import-preview-heading">
            <div>
              <p className="eyebrow">Ready to review</p>
              <h3 id="import-preview-title">{importFile.name}</h3>
            </div>
            <span className={importPreview.skippedCount ? "tag amber" : "tag green"}>
              {importPreview.importableCount} ready
            </span>
          </div>
          <p className="muted">
            {importPreview.totalCount} rows checked. {importPreview.skippedCount} will be skipped. No rows are saved until you confirm.
          </p>
          <div className="import-preview-rows" role="list" aria-label="CSV validation results">
            {importPreview.rows.slice(0, 30).map((row) => (
              <div className={row.errors.length ? "import-preview-row invalid" : "import-preview-row valid"} key={row.rowNumber} role="listitem">
                <span>Row {row.rowNumber}</span>
                <strong>{row.itemName || row.catalogueId || "Unknown item"}</strong>
                <small>{row.errors.length ? row.errors.join(" ") : "Ready to import"}</small>
              </div>
            ))}
          </div>
          {importPreview.rows.length > 30 ? (
            <p className="muted">Showing the first 30 of {importPreview.rows.length} rows.</p>
          ) : null}
          <div className="actions">
            <button className="button primary" type="button" disabled={!importPreview.importableCount || isImporting} onClick={() => void confirmImport()}>
              <Upload size={17} />
              {isImporting ? "Importing" : `Import ${importPreview.importableCount} validated rows`}
            </button>
            <button className="button" type="button" disabled={isImporting} onClick={cancelImport}>
              Cancel
            </button>
          </div>
        </section>
      ) : null}
    </section>
  );
}

function StoragePanel({
  locations,
  onCreate,
  onDelete,
}: {
  locations: StorageLocation[];
  onCreate: (formData: FormData) => Promise<boolean>;
  onDelete: (id: string) => Promise<boolean>;
}) {
  const [isSaving, setIsSaving] = useState(false);
  const [deletingId, setDeletingId] = useState("");

  async function handleCreate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (isSaving) {
      return;
    }

    setIsSaving(true);
    const created = await onCreate(new FormData(event.currentTarget));
    setIsSaving(false);

    if (created) {
      event.currentTarget.reset();
    }
  }

  async function handleDelete(location: StorageLocation) {
    if (deletingId) {
      return;
    }

    if (!window.confirm(`Delete ${location.name}? Items in this location will move to Unassigned.`)) {
      return;
    }

    setDeletingId(location.id);
    await onDelete(location.id);
    setDeletingId("");
  }

  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Storage</h2>
        <MapPin size={18} />
      </div>
      <form className="form-stack" onSubmit={handleCreate}>
        <div className="field-grid">
          <Field label="Name">
            <input name="name" placeholder="Trade binder" required />
          </Field>
          <Field label="Type">
            <select name="type" defaultValue="Binder">
              {storageTypes.map((type) => (
                <option key={type}>{type}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Notes">
          <textarea name="notes" placeholder="Optional" />
        </Field>
        <button className="button primary" type="submit" disabled={isSaving}>
          <Plus size={17} />
          {isSaving ? "Adding" : "Add location"}
        </button>
      </form>
      <div className="storage-list">
        {locations.length ? (
          locations.map((location) => (
            <article className="storage-row" key={location.id}>
              <div className="storage-main">
                <strong>{location.name}</strong>
                <span>
                  {location.type} | {location.itemCount} lots | Qty {location.totalQuantity}
                </span>
                {location.notes ? <p className="muted">{location.notes}</p> : null}
              </div>
              <div className="storage-actions">
                <strong>{formatMoney(location.valueMinor)}</strong>
                <button
                  className="button small danger"
                  type="button"
                  aria-label={`Delete ${location.name}`}
                  disabled={deletingId === location.id}
                  onClick={() => void handleDelete(location)}
                >
                  <Trash2 size={16} />
                  {deletingId === location.id ? "Deleting" : "Delete"}
                </button>
              </div>
            </article>
          ))
        ) : (
          <p className="muted">No storage locations yet.</p>
        )}
      </div>
    </section>
  );
}

function EventList({ events }: { events: CollectionEvent[] }) {
  if (!events.length) {
    return <p className="muted">No collection history yet.</p>;
  }

  return (
    <div className="event-list">
      {events.map((event) => (
        <article className="event-row" key={event.id}>
          <span className="event-marker">{event.type.slice(0, 1)}</span>
          <div className="event-copy">
            <strong>
              {event.type} {event.itemName}
            </strong>
            <span>{eventSummary(event)}</span>
          </div>
        </article>
      ))}
    </div>
  );
}

function CollectionTable({
  items,
  catalogueById,
  openItem,
}: {
  items: CollectionItem[];
  catalogueById: Map<string, CatalogueItem>;
  openItem: (id: string) => void;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            <th>Item</th>
            <th>Condition</th>
            <th>Qty</th>
            <th>Cost</th>
            <th>Value</th>
            <th>Location</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {items.map((item) => {
            const catalogueItem = catalogueById.get(item.catalogueId);
            if (!catalogueItem) {
              return null;
            }

            return (
              <tr
                aria-label={`View ${catalogueItemTitle(catalogueItem)}`}
                className="clickable-row"
                key={item.id}
                onClick={() => openItem(item.id)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    openItem(item.id);
                  }
                }}
                role="button"
                tabIndex={0}
              >
                <td>
                  <div className="table-item">
                    <div className="table-thumb">{renderItemImage(catalogueItem)}</div>
                    <div>
                      <strong>{catalogueItemTitle(catalogueItem)}</strong>
                      <span>{catalogueItemSetLabel(catalogueItem)} | {catalogueItem.number}</span>
                    </div>
                  </div>
                </td>
                <td>
                  <strong>{item.condition}</strong>
                  <span className="table-subline">
                    {item.grade && item.grade !== "Raw" && item.grade !== "N/A"
                      ? item.grade
                      : catalogueItem.type === "sealed"
                        ? "Sealed"
                        : selectedVariantLabel(catalogueItem, item.variant)}
                  </span>
                </td>
                <td>{item.quantity}</td>
                <td>{formatMoney(item.purchasePriceMinor)}</td>
                <td><strong>{formatValuation(getOwnedValue(item, catalogueItem))}</strong></td>
                <td>{item.location}</td>
                <td><ArrowRight className="row-chevron" size={17} /></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function PortfolioRecentRow({
  item,
  catalogueItem,
  onClick,
}: {
  item: CollectionItem;
  catalogueItem?: CatalogueItem;
  onClick: () => void;
}) {
  if (!catalogueItem) {
    return null;
  }

  return (
    <button className="compact-item-row" type="button" onClick={onClick}>
      <span className="compact-item-thumb">{renderItemImage(catalogueItem)}</span>
      <span className="compact-item-copy">
        <strong>{catalogueItemTitle(catalogueItem)}</strong>
        <small>{catalogueItemSetLabel(catalogueItem)} | {item.condition}</small>
      </span>
      <span className="compact-item-value">
        <strong>{formatValuation(getOwnedValue(item, catalogueItem))}</strong>
        <small>Qty {item.quantity}</small>
      </span>
      <ArrowRight size={16} />
    </button>
  );
}

function OwnedItemCard({
  item,
  catalogueItem,
  onClick,
}: {
  item: CollectionItem;
  catalogueItem?: CatalogueItem;
  onClick: () => void;
}) {
  if (!catalogueItem) {
    return null;
  }

  const ownedValue = getOwnedValue(item, catalogueItem);
  const resolvedVariant = selectedVariantLabel(catalogueItem, item.variant);
  const variantLabel = catalogueItem.type === "card" && resolvedVariant !== "Standard" ? resolvedVariant : "";
  const gradeLabel = item.grade && item.grade !== "Raw" && item.grade !== "N/A" ? item.grade : "";
  const valuation = collectionItemValuation(item, catalogueItem);
  const marketValue = valuation.kind === "market" ? valuation.unitValueMinor : null;
  const usesManualValue = item.overrideValueMinor !== undefined;
  const needsExactPrice = valuation.kind === "unvalued" && (Boolean(gradeLabel) || Boolean(variantLabel));

  return (
    <article
      aria-label={`View ${catalogueItemTitle(catalogueItem)}`}
      className="collection-lot-card clickable"
      role="button"
      tabIndex={0}
      onClick={onClick}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onClick();
        }
      }}
    >
      <div className="item-image collection-lot-image">{renderItemImage(catalogueItem)}</div>
      <div className="collection-lot-body">
        <div className="collection-lot-head">
          <h3>{catalogueItemTitle(catalogueItem)}</h3>
          <div className="collection-lot-price">
            <strong>{formatValuation(ownedValue)}</strong>
            <details
              className="market-help collection-price-help"
              onClick={(event) => event.stopPropagation()}
              onKeyDown={(event) => event.stopPropagation()}
            >
              <summary aria-label={`Price confidence for ${catalogueItemTitle(catalogueItem)}`}>?</summary>
              <span className="market-help-popover">
                <MarketConfidencePopover
                  item={catalogueItem}
                  manualOverride={usesManualValue}
                  marketPoint={valuation.pricePoint}
                  marketValue={marketValue}
                />
              </span>
            </details>
          </div>
        </div>
        <p className="collection-lot-set">{catalogueItemSetLabel(catalogueItem)} | {catalogueItem.number}</p>
        <div className="collection-lot-meta">
          <span className="tag">{item.condition}</span>
          {variantLabel ? <span className="tag">{variantLabel}</span> : null}
          {gradeLabel ? <span className="tag">{gradeLabel}</span> : null}
          {needsExactPrice ? <span className="tag amber">Exact price needed</span> : null}
          <span className="tag">{item.language}</span>
          <span className="tag blue">Qty {item.quantity}</span>
        </div>
      </div>
    </article>
  );
}

function CatalogueResult({
  item,
  onQuickAdd,
  onViewHistory,
  quickAddBusy = false,
  quickAddDisabled = false,
  selected,
  onClick,
}: {
  item: CatalogueItem;
  onQuickAdd: () => void;
  onViewHistory: () => void;
  quickAddBusy?: boolean;
  quickAddDisabled?: boolean;
  selected: boolean;
  onClick: () => void;
}) {
  const title = catalogueItemTitle(item);
  const setLabel = catalogueItemSetLabel(item);

  return (
    <article className={selected ? "item-card catalogue-result-card selected" : "item-card catalogue-result-card"}>
      <button className="catalogue-result-main" type="button" onClick={onClick}>
        <div className="item-image">{renderItemImage(item)}</div>
        <div className="item-main">
          <div className="item-title-row">
            <div>
              <h3>{title}</h3>
              <p className="muted">{setLabel} | {item.number}</p>
            </div>
            {selected ? <span className="set-print-status owned">Selected</span> : <span className="set-print-rarity">{item.rarity}</span>}
          </div>
          <p className="item-value">{formatValuation(catalogueMarketValueMinor(item))}</p>
          {item.type === "card" && item.variantOptions?.length ? (
            <div className="tag-row">
              {item.language && item.language !== "en" ? (
                <span className="tag blue">{item.languageLabel ?? item.language}</span>
              ) : null}
              {item.variantOptions.slice(0, 3).map((option) => (
                <span className="tag" key={option.label}>{option.label}</span>
              ))}
            </div>
          ) : null}
        </div>
      </button>
      <div className="catalogue-result-actions">
        <button
          aria-label={`View price history for ${title}`}
          className="icon-button catalogue-result-history-button"
          onClick={onViewHistory}
          title="View price history"
          type="button"
        >
          <ChartNoAxesCombined size={18} />
        </button>
        <button
          className="icon-button quick-add-button"
          type="button"
          disabled={quickAddDisabled}
          onClick={onQuickAdd}
          aria-label={quickAddBusy ? `Adding ${title}` : `Quick add ${title}`}
        >
          {quickAddBusy ? <RefreshCw className="spin" size={18} /> : <Plus size={18} />}
        </button>
      </div>
    </article>
  );
}

function CataloguePreview({ item, onImageOpen }: { item: CatalogueItem; onImageOpen?: () => void }) {
  const variants = item.type === "card" ? item.variantOptions ?? [] : [];
  const title = catalogueItemTitle(item);
  const setLabel = catalogueItemSetLabel(item);

  return (
    <div className="selected-preview">
      {onImageOpen ? (
        <button
          className="item-image selected-preview-image-button"
          type="button"
          onClick={onImageOpen}
          aria-label={`Zoom ${title} image`}
        >
          {renderItemImage(item)}
        </button>
      ) : (
        <div className="item-image">{renderItemImage(item)}</div>
      )}
      <div>
        <h3>{title}</h3>
        <p className="muted">{setLabel} | {item.number}</p>
        <div className="tag-row item-meta-row">
          {item.language && item.language !== "en" ? (
            <span className="tag blue">{item.languageLabel ?? item.language}</span>
          ) : null}
          <span className="set-print-rarity">{item.rarity}</span>
          <span className={valuationTagClass(item)}>{valuationStatusLabel(item)}</span>
        </div>
        {variants.length ? (
          <div className="tag-row">
            {variants.slice(0, 3).map((option) => (
              <span className="tag" key={option.label}>{option.label}</span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function CardImageZoomModal({ item, onClose }: { item: CatalogueItem; onClose: () => void }) {
  const titleId = `card-image-zoom-${item.id}`;
  const dialogRef = useDialogFocus<HTMLElement>(true);
  const marketValue = catalogueMarketValueMinor(item);
  const title = catalogueItemTitle(item);
  const setLabel = catalogueItemSetLabel(item);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") {
        onClose();
      }
    }

    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [onClose]);

  return (
    <div className="card-zoom-backdrop" onClick={onClose} role="presentation">
      <article
        aria-labelledby={titleId}
        aria-modal="true"
        className="card-zoom-modal"
        onClick={(event) => event.stopPropagation()}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <button className="icon-button card-zoom-close" type="button" onClick={onClose} aria-label="Close card image">
          <X size={18} />
        </button>
        <div className="card-zoom-image">{renderItemImage(item)}</div>
        <div className="card-zoom-copy">
          <h2 id={titleId}>{title}</h2>
          <p>{setLabel} | No. {item.number}</p>
          <div className="tag-row">
            <span className="set-print-rarity">{item.rarity}</span>
            <span className={valuationTagClass(item)}>{valuationStatusLabel(item)}</span>
            <span className="tag">{formatValuation(marketValue)}</span>
          </div>
        </div>
      </article>
    </div>
  );
}

function VariantSelect({
  defaultValue,
  item,
  name = "variant",
  onChange,
  value,
}: {
  defaultValue?: string;
  item: CatalogueItem;
  name?: string;
  onChange?: (value: string) => void;
  value?: string;
}) {
  const options = catalogueVariantLabels(item, value ?? defaultValue);
  const selectedValue = value ?? defaultValue ?? options[0];

  if (onChange) {
    return (
      <select name={name} value={selectedValue} onChange={(event) => onChange(event.target.value)}>
        {options.map((option) => (
          <option key={option}>{option}</option>
        ))}
      </select>
    );
  }

  return (
    <select name={name} defaultValue={selectedValue}>
      {options.map((option) => (
        <option key={option}>{option}</option>
      ))}
    </select>
  );
}

function SetProgressCard({
  isActiveGoal = false,
  set,
  onClick,
}: {
  isActiveGoal?: boolean;
  set: SetProgress;
  onClick: () => void;
}) {
  const done = completionPercent(set.owned, set.total);
  const title = setTitle(set);

  return (
    <button className={isActiveGoal ? "set-card active-goal" : "set-card"} onClick={onClick}>
      <SetArtwork set={set} />
      <div className="set-card-header">
        <div>
          <strong>{title}</strong>
          <span>{set.series ?? "Pokemon TCG"}</span>
        </div>
        <b>{done}%</b>
      </div>
      {set.language && set.language !== "en" ? (
        <span className="tag blue">{set.languageLabel ?? set.language}</span>
      ) : null}
      {isActiveGoal ? <span className="tag green"><Target size={13} /> Active goal</span> : null}
      <ProgressBar value={done} />
      <span>{set.owned} / {set.total} owned</span>
    </button>
  );
}

function SetArtwork({ set }: { set: SetProgress }) {
  const [failedImage, setFailedImage] = useState<string | undefined>();
  const candidateImage = set.logoImage ?? set.symbolImage;
  const image = candidateImage && candidateImage !== failedImage ? candidateImage : undefined;
  const title = setTitle(set);

  if (image) {
    return (
      <div className="set-artwork">
        <Image
          className="set-artwork-image"
          src={image}
          alt={`${title} logo`}
          fill
          sizes="(min-width: 980px) 220px, 50vw"
          unoptimized={!isOptimizableCatalogueImageUrl(image)}
          onError={() => setFailedImage(image)}
        />
      </div>
    );
  }

  return <div className="set-artwork set-artwork-fallback">{setInitials(title)}</div>;
}

function PageHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="page-header">
      <h1>{title}</h1>
      {action ? <div className="actions">{action}</div> : null}
    </div>
  );
}

function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="section-header">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

function StatCard({
  label,
  value,
  note,
  positive,
}: {
  label: string;
  value: string;
  note: string;
  positive?: boolean;
}) {
  return (
    <article className="stat-card">
      <span>{label}</span>
      <strong className={positive ? "positive" : ""}>{value}</strong>
      <p>{note}</p>
    </article>
  );
}

function MetricPanel({ title, rows }: { title: string; rows: Array<[string, ReactNode, string?]> }) {
  return (
    <section className="tool-panel">
      <h2>{title}</h2>
      <MetricList rows={rows} />
    </section>
  );
}

function MetricList({ rows }: { rows: Array<[string, ReactNode, string?]> }) {
  return (
    <div className="metric-list">
      {rows.map(([label, value, className]) => (
        <div className="metric-row" key={label}>
          <span>{label}</span>
          <strong className={className}>{value}</strong>
        </div>
      ))}
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="field">
      <span>{label}</span>
      {children}
    </label>
  );
}

function EmptyState({
  action,
  description,
  title,
}: {
  action?: ReactNode;
  description?: string;
  title: string;
}) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      {description ? <p className="muted">{description}</p> : null}
      {action}
    </div>
  );
}

type InteractiveValueLinePoint = {
  badge?: string;
  badgeClassName?: string;
  detail?: string;
  footerDetail?: string;
  observedAt: string;
  source?: string;
  valueMinor: number;
};

type InteractiveValueLineChartProps = {
  className?: string;
  compact?: boolean;
  gradientId: string;
  label: string;
  points: InteractiveValueLinePoint[];
};

function PortfolioValueLineChart({
  compact = false,
  currentValueMinor,
  history,
}: {
  compact?: boolean;
  currentValueMinor: number;
  history: CollectionIntelligence["portfolioHistory"];
}) {
  const [range, setRange] = useState<PriceHistoryRange>("30d");
  const visibleHistory = filterDatedHistoryByRange(history, range);
  const chartHistory = visibleHistory.length ? visibleHistory : history;
  const change = portfolioRangeChange(history, range);
  const chartPoints = chartHistory.map((point): InteractiveValueLinePoint => ({
    badge: `${point.valuedLots} lots`,
    detail: `${formatMoney(point.marketValueMinor)} market | ${formatMoney(point.manualValueMinor)} manual`,
    footerDetail: `${point.marketLots} market | ${point.manualLots} manual`,
    observedAt: point.observedAt,
    source: "Portfolio value",
    valueMinor: point.valueMinor,
  }));

  if (!chartPoints.length) {
    return (
      <div className={compact ? "portfolio-value-chart compact empty" : "portfolio-value-chart empty"}>
        <p className="muted">{currentValueMinor ? "Pricing history will appear after the next run." : "No value history yet."}</p>
      </div>
    );
  }

  return (
    <div className={compact ? "portfolio-chart-shell compact" : "portfolio-chart-shell"}>
      <div className="portfolio-chart-toolbar">
        <div className="segmented compact price-history-ranges" aria-label="Portfolio history timeframe">
          {priceHistoryRanges.map((option) => (
            <button
              aria-pressed={range === option.value}
              className={range === option.value ? "active" : ""}
              key={option.value}
              onClick={() => setRange(option.value)}
              type="button"
            >
              {option.label}
            </button>
          ))}
        </div>
        <span className={change && change.valueMinor >= 0 ? "portfolio-range-change positive" : "portfolio-range-change"}>
          {change ? `${formatSignedMoney(change.valueMinor)} (${formatSignedPercent(change.percent)})` : "Building history"}
        </span>
      </div>
      <InteractiveValueLineChart
        className="portfolio-value-chart"
        compact={compact}
        gradientId={`${compact ? "portfolio-value-area-compact" : "portfolio-value-area"}-${range}`}
        label={`Portfolio value history line chart, ${priceHistoryRangeLabel(range)}`}
        points={chartPoints}
      />
    </div>
  );
}

function InteractiveValueLineChart({
  className,
  compact = false,
  gradientId,
  label,
  points,
}: InteractiveValueLineChartProps) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);
  const values = points.map((point) => point.valueMinor);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = Math.max(1, max - min);
  const width = 720;
  const height = compact ? 190 : 250;
  const plot = compact
    ? { bottom: 144, left: 90, right: 20, top: 18 }
    : { bottom: 204, left: 90, right: 20, top: 18 };
  const plotWidth = width - plot.left - plot.right;
  const plotHeight = plot.bottom - plot.top;
  const times = points.map((point) => Date.parse(point.observedAt));
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const timeSpan = Math.max(1, maxTime - minTime);
  const chartPoints = points.map((point, index) => {
    const parsed = Date.parse(point.observedAt);
    const x =
      points.length === 1
        ? plot.left + plotWidth / 2
        : Number.isFinite(parsed) && maxTime > minTime
          ? plot.left + ((parsed - minTime) / timeSpan) * plotWidth
          : plot.left + (index / Math.max(1, points.length - 1)) * plotWidth;
    const y = min === max ? plot.top + plotHeight / 2 : plot.bottom - ((point.valueMinor - min) / span) * plotHeight;

    return { point, x, y };
  });
  const linePoints = chartPoints.map((entry) => `${entry.x.toFixed(1)},${entry.y.toFixed(1)}`).join(" ");
  const areaPath = chartPoints.length
    ? `M ${chartPoints[0].x.toFixed(1)} ${plot.bottom} L ${linePoints.replaceAll(",", " ")} L ${chartPoints[chartPoints.length - 1].x.toFixed(1)} ${plot.bottom} Z`
    : "";
  const ticks = [0, 0.5, 1].map((ratio) => {
    const value = max - (max - min) * ratio;
    return {
      label: formatMoney(Math.round(value)),
      y: plot.top + plotHeight * ratio,
    };
  });
  const latest = points[points.length - 1];
  const first = points[0];
  const activeEntry = chartPoints[activeIndex ?? chartPoints.length - 1];
  const tooltipDetailLines = activeEntry?.point.detail?.split(" | ") ?? [];
  const tooltipWidth = 214;
  const tooltipHeight = tooltipDetailLines.length ? 54 + tooltipDetailLines.length * 14 : 52;
  const tooltipX = activeEntry
    ? Math.min(width - plot.right - tooltipWidth, Math.max(plot.left, activeEntry.x + (activeEntry.x > width - tooltipWidth - 32 ? -tooltipWidth - 12 : 12)))
    : plot.left;
  const tooltipY = activeEntry
    ? Math.min(plot.bottom - tooltipHeight - 8, Math.max(plot.top + 8, activeEntry.y - tooltipHeight - 10))
    : plot.top;

  function handlePointerMove(event: ReactPointerEvent<SVGSVGElement>) {
    const bounds = event.currentTarget.getBoundingClientRect();
    const relativeX = ((event.clientX - bounds.left) / Math.max(1, bounds.width)) * width;
    const nearestIndex = chartPoints.reduce(
      (nearest, entry, index) =>
        Math.abs(entry.x - relativeX) < Math.abs(chartPoints[nearest].x - relativeX) ? index : nearest,
      0,
    );

    setActiveIndex(nearestIndex);
  }

  return (
    <div className={`${compact ? "price-history-chart compact" : "price-history-chart"}${className ? ` ${className}` : ""}`}>
      <div className="price-history-plot">
        <svg
          aria-label={label}
          onPointerDown={handlePointerMove}
          onPointerLeave={() => setActiveIndex(null)}
          onPointerMove={handlePointerMove}
          role="img"
          viewBox={`0 0 ${width} ${height}`}
        >
          <defs>
            <linearGradient id={gradientId} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="var(--teal)" stopOpacity="0.32" />
              <stop offset="100%" stopColor="var(--blue)" stopOpacity="0.04" />
            </linearGradient>
          </defs>
          {ticks.map((tick) => (
            <g key={tick.y}>
              <line className="price-history-grid-line" x1={plot.left} x2={plot.right + plotWidth} y1={tick.y} y2={tick.y} />
              <text className="price-history-axis-label" x={plot.left - 10} y={tick.y + 4} textAnchor="end">
                {tick.label}
              </text>
            </g>
          ))}
          {areaPath ? <path className="price-history-area" d={areaPath} fill={`url(#${gradientId})`} /> : null}
          {linePoints ? <polyline className="price-history-line" points={linePoints} /> : null}
          {chartPoints.map(({ point, x, y }, index) => (
            <circle
              className="price-history-dot"
              cx={x}
              cy={y}
              key={`${point.observedAt}-${point.valueMinor}-${index}`}
              r={index === chartPoints.length - 1 ? 6 : 4.5}
            />
          ))}
          {activeEntry ? (
            <g>
              <line className="price-history-crosshair" x1={activeEntry.x} x2={activeEntry.x} y1={plot.top} y2={plot.bottom} />
              <circle className="price-history-active-dot" cx={activeEntry.x} cy={activeEntry.y} r={7} />
              <g>
                <rect className="price-history-tooltip-bg" height={tooltipHeight} rx={8} width={tooltipWidth} x={tooltipX} y={tooltipY} />
                <text className="price-history-tooltip-date" x={tooltipX + 12} y={tooltipY + 19}>
                  {formatEventDate(activeEntry.point.observedAt)}
                </text>
                <text className="price-history-tooltip-value" x={tooltipX + 12} y={tooltipY + 39}>
                  {formatMoney(activeEntry.point.valueMinor)}
                </text>
                {tooltipDetailLines.map((line, index) => (
                  <text
                    className="price-history-tooltip-detail"
                    key={line}
                    x={tooltipX + 12}
                    y={tooltipY + 58 + index * 14}
                  >
                    {line}
                  </text>
                ))}
              </g>
            </g>
          ) : null}
          {first ? (
            <text className="price-history-date-label" x={plot.left} y={height - 16}>
              {formatEventDate(first.observedAt)}
            </text>
          ) : null}
          {latest ? (
            <text className="price-history-date-label" x={width - plot.right} y={height - 16} textAnchor="end">
              {formatEventDate(latest.observedAt)}
            </text>
          ) : null}
        </svg>
      </div>
      {activeEntry ? (
        <div className="price-history-chart-footer">
          {activeEntry.point.badge ? (
            <span className={activeEntry.point.badgeClassName ?? "status-pill"}>{activeEntry.point.badge}</span>
          ) : null}
          <span>{formatMoney(activeEntry.point.valueMinor)} on {formatEventDate(activeEntry.point.observedAt)}</span>
          <span>{points.length} point{points.length === 1 ? "" : "s"}</span>
          {activeEntry.point.footerDetail ? <span>{activeEntry.point.footerDetail}</span> : null}
          {activeEntry.point.source ? <span>{activeEntry.point.source}</span> : null}
        </div>
      ) : null}
    </div>
  );
}

function PriceTrendPanel({
  item,
  owned,
  overrideValueMinor,
  preferredVariant,
}: {
  item: CatalogueItem;
  owned?: CollectionItem;
  overrideValueMinor?: number;
  preferredVariant?: string;
}) {
  const [range, setRange] = useState<PriceHistoryRange>("30d");
  const [remoteHistoryByRange, setRemoteHistoryByRange] = useState<Record<string, DetailedPricePoint[]>>({});
  const [historyLoadError, setHistoryLoadError] = useState("");
  const [isLoadingHistory, setIsLoadingHistory] = useState(false);
  const [historyRetryToken, setHistoryRetryToken] = useState(0);
  const [selectedHistorySeriesKey, setSelectedHistorySeriesKey] = useState("");
  const apiRange = priceHistoryApiRange(range);
  const shouldLoadRemoteHistory = isUuid(item.id);
  const remoteHistory = remoteHistoryByRange[apiRange];
  const allHistory: DetailedPricePoint[] = remoteHistory?.length ? remoteHistory : item.priceHistory ?? [];
  const relevantHistory = owned
    ? collectionItemPriceHistory(owned, { ...item, priceHistory: allHistory })
    : allHistory.filter((point) => !point.gradedCompany);
  const historySeries = groupPriceHistorySeries(relevantHistory);
  const historyPreferredVariant = preferredVariant ?? (
    owned ? effectiveCollectionVariant(owned, item) : undefined
  );
  const fallbackHistorySeriesKey = preferredPriceHistorySeriesKey(
    relevantHistory,
    owned ? undefined : historyPreferredVariant,
  );
  const activeHistorySeries = historySeries.find((series) => series.key === selectedHistorySeriesKey) ??
    historySeries.find((series) => series.key === fallbackHistorySeriesKey) ??
    (historyPreferredVariant ? undefined : historySeries[0]);
  const history = activeHistorySeries?.points ?? [];
  const visibleHistory = filterPriceHistoryByRange(history, range);
  const activeHistory = visibleHistory.length ? visibleHistory : history;
  const latest = activeHistory[activeHistory.length - 1];
  const first = activeHistory[0];
  const valueRange = priceRangeMinor(activeHistory);
  const delta = latest && first ? latest.valueMinor - first.valueMinor : null;
  const overallLatest = latest ?? preferredLatestPricePoint(history);
  const source = overallLatest?.source ?? item.priceSource;
  const observedAt = overallLatest?.observedAt ?? item.priceObservedAt;
  const latestMarketValue = overallLatest?.valueMinor ?? (
    owned
      ? collectionItemValuation(owned, item).unitValueMinor ?? null
      : catalogueMarketValueMinor(item, preferredVariant)
  );
  const deltaPercent = delta !== null && first?.valueMinor
    ? (delta / first.valueMinor) * 100
    : null;
  const sealedSources = item.type === "sealed" ? latestDetailedPointsBySource(allHistory) : [];

  useEffect(() => {
    setRange("30d");
    setRemoteHistoryByRange({});
    setHistoryLoadError("");
    setSelectedHistorySeriesKey("");
  }, [item.id]);

  useEffect(() => {
    setSelectedHistorySeriesKey("");
  }, [historyPreferredVariant]);

  useEffect(() => {
    if (!shouldLoadRemoteHistory || remoteHistoryByRange[apiRange]) {
      return;
    }

    const controller = new AbortController();
    setIsLoadingHistory(true);
    setHistoryLoadError("");

    void fetch(`/api/price-history?catalogueId=${encodeURIComponent(item.id)}&range=${apiRange}`, {
      cache: "no-store",
      signal: controller.signal,
    })
      .then(async (response) => {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          points?: Array<{
            bucket?: string;
            confidenceScore?: number;
            currency?: string;
            observedAt?: string;
            pointCount?: number;
            priceMinor?: number;
            sampleSize?: number | null;
            source?: string;
            variantLabel?: string | null;
            condition?: string | null;
            language?: string | null;
            gradedCompany?: string | null;
            gradedScore?: number | null;
          }>;
        };
        if (!response.ok) throw new Error(body.error ?? `Price history failed with ${response.status}.`);
        const points = (body.points ?? []).map(normalizeDetailedPricePoint).filter((point): point is DetailedPricePoint => Boolean(point));
        setRemoteHistoryByRange((current) => ({ ...current, [apiRange]: points }));
      })
      .catch((error) => {
        if (controller.signal.aborted) return;
        setHistoryLoadError(error instanceof Error ? error.message : "Long-range history is unavailable.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setIsLoadingHistory(false);
      });

    return () => controller.abort();
  }, [apiRange, historyRetryToken, item.id, remoteHistoryByRange, shouldLoadRemoteHistory]);

  return (
    <section className="tool-panel price-history-panel">
      <div className="panel-title-row">
        <div>
          <h2>Market price</h2>
          <p className="muted">{priceSourceLabel(source)}{observedAt ? ` | Updated ${formatEventDate(observedAt)}` : ""}</p>
        </div>
        <ChartNoAxesCombined size={18} />
      </div>
      <div className="price-history-headline">
        <span>
          <small>Current estimate</small>
          <strong>{formatValuation(latestMarketValue)}</strong>
        </span>
        <span>
          <small>{priceHistoryRangeLabel(range)} change</small>
          <strong className={delta !== null && delta >= 0 ? "positive" : ""}>
            {delta === null
              ? "Building history"
              : `${formatSignedMoney(delta)}${deltaPercent === null ? "" : ` (${formatSignedPercent(deltaPercent)})`}`}
          </strong>
        </span>
        {overrideValueMinor === undefined ? null : (
          <span>
            <small>Lot value</small>
            <strong>{formatMoney(overrideValueMinor)}</strong>
            <em>Manual estimate</em>
          </span>
        )}
      </div>
      {historySeries.length > 1 ? (
        <label className="field price-history-stream-field">
          <span>Market stream</span>
          <select
            aria-label="Price history market stream"
            onChange={(event) => setSelectedHistorySeriesKey(event.target.value)}
            value={activeHistorySeries?.key ?? ""}
          >
            {historySeries.map((series) => (
              <option key={series.key} value={series.key}>{series.label}</option>
            ))}
          </select>
          <small>Each line is one exact finish, grade, condition, language, source and currency.</small>
        </label>
      ) : null}
      <PriceHistoryRangeControls onRangeChange={setRange} range={range} />
      {history.length ? (
        <PriceHistoryLineChart history={history} range={range} />
      ) : (
        <p className="muted">No price history yet.</p>
      )}
      {isLoadingHistory ? <p className="muted" role="status">Loading {priceHistoryRangeLabel(range)} history…</p> : null}
      {historyLoadError ? (
        <div className="inline-error-state" role="alert">
          <span>{historyLoadError}</span>
          <button className="button small" type="button" onClick={() => setHistoryRetryToken((current) => current + 1)}>
            <RefreshCw size={15} />
            Retry
          </button>
        </div>
      ) : null}
      {item.type === "sealed" && sealedSources.length ? (
        <section className="sealed-source-comparison" aria-label="Sealed price sources">
          <div className="panel-title-row">
            <h3>Source comparison</h3>
            <span className="tag blue">{sealedSources.length} market{sealedSources.length === 1 ? "" : "s"}</span>
          </div>
          <div className="sealed-source-grid">
            {sealedSources.map((point) => (
              <article className="sealed-source-card" key={`${point.source}-${point.variantLabel ?? "all"}`}>
                <div>
                  <strong>{formatMoney(point.valueMinor)}</strong>
                  <span className={marketConfidenceBadgeClass(point.confidence)}>{point.confidence}</span>
                </div>
                <h4>{priceSourceLabel(point.source)}</h4>
                <dl>
                  <div><dt>Market</dt><dd>{priceMarketForSource(point.source)}</dd></div>
                  <div><dt>Observed</dt><dd>{formatEventDate(point.observedAt)}</dd></div>
                  <div><dt>Variant</dt><dd>{point.variantLabel || "Sealed"}</dd></div>
                  <div><dt>Sample</dt><dd>{point.sampleSize ?? "Not supplied"}</dd></div>
                  <div><dt>Snapshots</dt><dd>{point.pointCount ?? 1}</dd></div>
                  <div><dt>Currency</dt><dd>{point.currency ?? "GBP"}</dd></div>
                </dl>
              </article>
            ))}
          </div>
        </section>
      ) : null}
      <MetricList
        rows={[
          ["Range", valueRange ? `${formatMoney(valueRange.low)} - ${formatMoney(valueRange.high)}` : "Unknown"],
          ["Market basis", priceMarketRole(source)],
          ["Observed", observedAt ? formatEventDate(observedAt) : "Unknown"],
          ["Freshness", overallLatest ? priceFreshnessStatus(overallLatest) : "Unknown"],
        ]}
      />
    </section>
  );
}

type PriceHistoryRange = "7d" | "30d" | "3m" | "6m" | "1y" | "all";

const priceHistoryRanges: Array<{ days?: number; label: string; value: PriceHistoryRange }> = [
  { days: 7, label: "7d", value: "7d" },
  { days: 30, label: "30d", value: "30d" },
  { days: 92, label: "3m", value: "3m" },
  { days: 183, label: "6m", value: "6m" },
  { days: 365, label: "1y", value: "1y" },
  { label: "All", value: "all" },
];

function PriceHistoryRangeControls({
  onRangeChange,
  range,
}: {
  onRangeChange: (range: PriceHistoryRange) => void;
  range: PriceHistoryRange;
}) {
  return (
    <div className="segmented compact price-history-ranges" aria-label="Price history timeframe">
      {priceHistoryRanges.map((option) => (
        <button
          aria-pressed={range === option.value}
          className={range === option.value ? "active" : ""}
          key={option.value}
          onClick={() => onRangeChange(option.value)}
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function priceHistoryApiRange(range: PriceHistoryRange) {
  if (range === "3m") return "90d";
  if (range === "6m") return "1y";
  return range;
}

function normalizeDetailedPricePoint(value: {
  bucket?: string;
  confidenceScore?: number;
  currency?: string;
  observedAt?: string;
  pointCount?: number;
  priceMinor?: number;
  sampleSize?: number | null;
  source?: string;
  variantLabel?: string | null;
  condition?: string | null;
  language?: string | null;
  gradedCompany?: string | null;
  gradedScore?: number | null;
}): DetailedPricePoint | null {
  const observedAt = value.observedAt ?? value.bucket;
  const valueMinor = Number(value.priceMinor);
  if (!observedAt || Number.isNaN(Date.parse(observedAt)) || !Number.isFinite(valueMinor) || valueMinor < 0) return null;

  return {
    bucket: value.bucket,
    confidence: priceConfidenceFromScore(value.confidenceScore),
    condition: value.condition?.trim() || undefined,
    currency: value.currency,
    gradedCompany: value.gradedCompany?.trim() || undefined,
    gradedScore: Number.isFinite(value.gradedScore) ? value.gradedScore ?? undefined : undefined,
    language: value.language?.trim() || undefined,
    observedAt,
    pointCount: Number.isSafeInteger(value.pointCount) ? value.pointCount : undefined,
    sampleSize: value.sampleSize ?? null,
    source: value.source?.trim() || "unknown",
    valueMinor: Math.round(valueMinor),
    variantLabel: value.variantLabel?.trim() || undefined,
  };
}

function latestDetailedPointsBySource(history: DetailedPricePoint[]) {
  const latest = new Map<string, DetailedPricePoint>();
  for (const point of history) {
    const key = `${point.source}\u0000${point.variantLabel ?? ""}`;
    const current = latest.get(key);
    if (!current || Date.parse(point.observedAt) >= Date.parse(current.observedAt)) latest.set(key, point);
  }
  return [...latest.values()].sort((left, right) => right.valueMinor - left.valueMinor);
}

function isUuid(value: string) {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

function PriceHistoryLineChart({
  history,
  range,
}: {
  history: NonNullable<CatalogueItem["priceHistory"]>;
  range: PriceHistoryRange;
}) {
  const points = filterPriceHistoryByRange(history, range);
  const chartPoints = points.map((point): InteractiveValueLinePoint => ({
    badge: point.confidence,
    badgeClassName: marketConfidenceBadgeClass(point.confidence),
    footerDetail: priceSourceLabel(point.source),
    observedAt: point.observedAt,
    source: point.variantLabel ?? undefined,
    valueMinor: point.valueMinor,
  }));

  return (
    <div className="price-history-chart">
      <InteractiveValueLineChart
        gradientId={`price-history-area-${range}`}
        label={`Price history line chart, ${priceHistoryRangeLabel(range)}`}
        points={chartPoints}
      />
    </div>
  );
}

function filterPriceHistoryByRange(
  history: NonNullable<CatalogueItem["priceHistory"]>,
  range: PriceHistoryRange,
) {
  return filterDatedHistoryByRange(history, range);
}

function filterDatedHistoryByRange<T extends { observedAt: string }>(
  history: T[],
  range: PriceHistoryRange,
) {
  if (range === "all" || history.length <= 1) {
    return history;
  }

  const latest = history[history.length - 1];
  const latestTime = latest ? Date.parse(latest.observedAt) : NaN;
  const days = priceHistoryRanges.find((option) => option.value === range)?.days;

  if (!days || !Number.isFinite(latestTime)) {
    return history;
  }

  const startTime = latestTime - days * 24 * 60 * 60 * 1000;
  const filtered = history.filter((point) => Date.parse(point.observedAt) >= startTime);

  return filtered.length ? filtered : history.slice(-1);
}

function priceHistoryRangeLabel(range: PriceHistoryRange) {
  return priceHistoryRanges.find((option) => option.value === range)?.label ?? "All";
}

function useDialogFocus<T extends HTMLElement>(active: boolean) {
  const containerRef = useRef<T>(null);

  useEffect(() => {
    if (!active) {
      return;
    }

    const container = containerRef.current;

    if (!container) {
      return;
    }

    const dialog = container;

    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const focusableSelector = [
      "a[href]",
      "button:not([disabled])",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const focusFirst = () => {
      const first = dialog.querySelector<HTMLElement>(focusableSelector);
      (first ?? dialog).focus();
    };
    const frame = window.requestAnimationFrame(focusFirst);

    function keepFocusInside(event: KeyboardEvent) {
      if (event.key !== "Tab") {
        return;
      }

      const focusable = Array.from(dialog.querySelectorAll<HTMLElement>(focusableSelector))
        .filter((element) => element.offsetParent !== null);

      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];

      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    }

    document.addEventListener("keydown", keepFocusInside);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", keepFocusInside);

      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, [active]);

  return containerRef;
}

function useMediaQuery(query: string) {
  const [matches, setMatches] = useState(false);

  useEffect(() => {
    const media = window.matchMedia(query);
    const update = () => setMatches(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [query]);

  return matches;
}

function ProgressBar({ value }: { value: number }) {
  const boundedValue = Math.max(0, Math.min(100, value));

  return (
    <div
      aria-valuemax={100}
      aria-valuemin={0}
      aria-valuenow={Math.round(boundedValue)}
      className="progress"
      role="progressbar"
    >
      <span style={{ width: `${boundedValue}%` }} />
    </div>
  );
}

function renderItemImage(item: CatalogueItem) {
  return <CatalogueItemImage item={item} />;
}

function CatalogueItemImage({ item }: { item: CatalogueItem }) {
  const [failedImages, setFailedImages] = useState<string[]>([]);
  const image = catalogueItemImageCandidates(item).find((candidate) => !failedImages.includes(candidate));

  if (image) {
    return (
      <Image
        className="asset-image"
        data-item-type={item.type}
        src={image}
        alt={catalogueItemTitle(item)}
        fill
        sizes="(min-width: 760px) 340px, 96px"
        unoptimized={!isOptimizableCatalogueImageUrl(image)}
        onError={() => setFailedImages((current) => current.includes(image) ? current : [...current, image])}
      />
    );
  }

  if (item.type === "sealed") {
    return (
      <span className="sealed-art">
        <Boxes size={22} />
        {catalogueItemTitle(item)}
      </span>
    );
  }

  return <span className="image-fallback">No image</span>;
}

function getOwnedValue(item: CollectionItem, catalogueItem?: CatalogueItem) {
  return collectionItemValueMinor(item, catalogueItem) ?? null;
}

function isGradedCollectionItem(item: CollectionItem) {
  return item.grade !== "Raw" && item.grade !== "N/A";
}

function catalogueMarketValueMinor(item: CatalogueItem, variant?: string) {
  return catalogueValueMinorForVariant(item, variant) ?? null;
}

function adjustedMarketValueMinor(
  item: CatalogueItem,
  variant: string | undefined,
  condition: string,
  quantity = 1,
) {
  const marketValueMinor = catalogueMarketValueMinor(item, variant);

  if (marketValueMinor === null) {
    return null;
  }

  const normalizedQuantity = Number.isFinite(quantity) ? Math.max(1, quantity) : 1;

  return Math.round(marketValueMinor * collectionConditionMultiplier(condition, item.type)) * normalizedQuantity;
}

function conditionAdjustmentLabel(multiplier: number) {
  if (multiplier === 1) {
    return "No condition adjustment.";
  }

  const percent = Math.round((multiplier - 1) * 100);

  return `Condition adjustment ${percent > 0 ? "+" : ""}${percent}%.`;
}

function selectedVariantLabel(item: CatalogueItem, variant?: string) {
  return catalogueVariantSelectionLabel(item, variant);
}

function formatValuation(valueMinor?: number | null) {
  return valueMinor === null || valueMinor === undefined ? "Needs estimate" : formatMoney(valueMinor);
}

function MarketConfidencePopover({
  item,
  manualOverride = false,
  marketPoint,
  marketValue,
}: {
  item: CatalogueItem;
  manualOverride?: boolean;
  marketPoint?: NonNullable<CatalogueItem["priceHistory"]>[number];
  marketValue?: number | null;
}) {
  if (manualOverride) {
    return (
      <span className="market-help-content">
        <span className="market-help-heading">
          Value source <strong className="market-confidence-badge manual">Manual</strong>
        </span>
        <span>This value uses your manual override rather than a live market price.</span>
      </span>
    );
  }

  if (marketValue === null || marketValue === undefined) {
    return (
      <span className="market-help-content">
        <span className="market-help-heading">
          Value source <strong className="market-confidence-badge missing">Missing</strong>
        </span>
        <span>Use a manual value with a note, or refresh pricing when a source supports this item.</span>
      </span>
    );
  }

  const confidence = marketPoint ? effectivePriceConfidence(marketPoint) : item.confidence || "Unknown";
  const source = marketPoint?.source ?? item.priceSource;
  const observedAt = marketPoint?.observedAt ?? item.priceObservedAt;

  return (
    <span className="market-help-content">
      <span className="market-help-heading">
        Market confidence
        <strong className={marketConfidenceBadgeClass(confidence)}>{confidence}</strong>
      </span>
      <span className="market-help-row">
        <span>Market basis</span>
        <strong>{priceMarketRole(source)}</strong>
      </span>
      <span className="market-help-row">
        <span>Source</span>
        <strong>{priceSourceLabel(source)}</strong>
      </span>
      <span className="market-help-row">
        <span>Observed</span>
        <strong>{observedAt ? formatEventDate(observedAt) : "Unknown"}</strong>
      </span>
      <span className="market-help-row">
        <span>Freshness</span>
        <strong>{marketPoint ? priceFreshnessStatus(marketPoint) : item.priceStatus ?? "Unknown"}</strong>
      </span>
      <span>{marketConfidenceReason(confidence)}</span>
    </span>
  );
}

function marketConfidenceReason(confidence: string) {
  const normalized = confidence.trim().toLowerCase();

  if (normalized === "strong" || normalized === "high") {
    return "Direct marketplace market pricing from a trusted import source. Good for normal tracking.";
  }

  if (normalized === "fair" || normalized === "medium") {
    return "Usually based on a trend, average, mid, or single-source estimate. Check before buying or insuring higher-value items.";
  }

  return "Treat this as a guide only until a stronger or newer source is available.";
}

function marketConfidenceBadgeClass(confidence: string) {
  const normalized = confidence.trim().toLowerCase();

  if (normalized === "strong" || normalized === "high") {
    return "market-confidence-badge strong";
  }

  if (normalized === "fair" || normalized === "medium") {
    return "market-confidence-badge fair";
  }

  if (normalized === "weak") {
    return "market-confidence-badge weak";
  }

  return "market-confidence-badge missing";
}

function setInitials(name: string) {
  const words = name.match(/[A-Za-z0-9]+/g) ?? [];
  const initials = words.slice(0, 3).map((word) => word[0]).join("");

  return initials.toUpperCase() || "SET";
}

function valuationStatusLabel(item: CatalogueItem, owned?: CollectionItem) {
  if (owned?.overrideValueMinor !== undefined) {
    return "Manual value";
  }

  if (owned && collectionItemValuation(owned, item).kind === "unvalued") {
    return "Needs exact estimate";
  }

  const variantPrice = owned ? collectionItemMarketPricePoint(owned, item) : undefined;

  if ((variantPrice && priceFreshnessStatus(variantPrice) === "Stale") || (!variantPrice && item.priceStatus === "Stale")) {
    return "Price outdated";
  }

  if (variantPrice?.confidence) {
    return `Market confidence: ${effectivePriceConfidence(variantPrice)}`;
  }

  return item.hasPrice ? `Market confidence: ${item.confidence}` : "Needs estimate";
}

function valuationPillClass(item: CatalogueItem, owned?: CollectionItem) {
  if (owned?.overrideValueMinor !== undefined) {
    return "confidence-pill manual";
  }

  if (owned && collectionItemValuation(owned, item).kind === "unvalued") {
    return "confidence-pill missing";
  }

  const variantPrice = owned ? collectionItemMarketPricePoint(owned, item) : undefined;

  if ((variantPrice && priceFreshnessStatus(variantPrice) === "Stale") || (!variantPrice && item.priceStatus === "Stale")) {
    return "confidence-pill stale";
  }

  return item.hasPrice ? "confidence-pill" : "confidence-pill missing";
}

function valuationTagClass(item: CatalogueItem, owned?: CollectionItem) {
  if (owned?.overrideValueMinor !== undefined) {
    return "tag green";
  }

  if (owned && collectionItemValuation(owned, item).kind === "unvalued") {
    return "tag amber";
  }

  const variantPrice = owned ? collectionItemMarketPricePoint(owned, item) : undefined;

  if ((variantPrice && priceFreshnessStatus(variantPrice) === "Stale") || (!variantPrice && item.priceStatus === "Stale")) {
    return "tag amber";
  }

  return item.hasPrice ? "tag blue" : "tag amber";
}

function valuationSourceLabel(item: CatalogueItem, owned?: CollectionItem) {
  if (owned?.overrideValueMinor !== undefined) {
    return "Manual estimate";
  }

  if (owned && collectionItemValuation(owned, item).kind === "unvalued") {
    return "Needs estimate";
  }

  const variantPrice = owned ? collectionItemMarketPricePoint(owned, item) : undefined;

  if (variantPrice?.source) {
    return priceSourceLabel(variantPrice.source);
  }

  return item.hasPrice ? priceSourceLabel(item.priceSource) : "Needs estimate";
}

function valuationObservedLabel(item: CatalogueItem, owned?: CollectionItem) {
  if (owned?.overrideValueMinor !== undefined) {
    return "Manual estimate";
  }

  if (owned && collectionItemValuation(owned, item).kind === "unvalued") {
    return "Unknown";
  }

  const variantPrice = owned ? collectionItemMarketPricePoint(owned, item) : undefined;

  if (variantPrice?.observedAt) {
    return formatEventDate(variantPrice.observedAt);
  }

  return item.priceObservedAt ? formatEventDate(item.priceObservedAt) : "Unknown";
}

function gradeCompanyFromLabel(grade: string) {
  if (!grade || grade === "N/A" || grade === "Raw") {
    return "Raw";
  }

  return grade.split(" ")[0] ?? "Raw";
}

function gradeScoreFromLabel(grade: string) {
  const score = grade.match(/\d+(?:\.\d+)?/)?.[0];

  return score ?? "";
}

function gradeLabelFromForm(gradeCompany: string, gradeScore: string, itemType: ItemType) {
  if (itemType === "sealed") {
    return "N/A";
  }

  const company = gradeCompany.trim();
  const score = gradeScore.trim();

  if (!company || company === "Raw") {
    return "Raw";
  }

  return score ? `${company} ${score}` : company;
}

function gainLabel(holding: HoldingInsight) {
  if (holding.gainMinor === null) {
    return holding.name;
  }

  const prefix = holding.gainMinor >= 0 ? "+" : "";

  return `${holding.name} ${prefix}${formatMoney(holding.gainMinor)}`;
}

function portfolioRangeChange(
  history: CollectionIntelligence["portfolioHistory"],
  range: PriceHistoryRange,
) {
  const visible = filterDatedHistoryByRange(history, range);
  const first = visible[0];
  const latest = visible.at(-1);

  if (!first || !latest || first === latest) {
    return null;
  }

  const valueMinor = latest.valueMinor - first.valueMinor;

  return {
    percent: first.valueMinor > 0 ? (valueMinor / first.valueMinor) * 100 : 0,
    valueMinor,
  };
}

function formatSignedMoney(valueMinor: number) {
  const prefix = valueMinor > 0 ? "+" : "";

  return `${prefix}${formatMoney(valueMinor)}`;
}

function formatSignedPercent(value: number) {
  const prefix = value > 0 ? "+" : "";

  return `${prefix}${value.toLocaleString("en-GB", { maximumFractionDigits: 1, minimumFractionDigits: 1 })}%`;
}

function actionTagClass(tone: InsightAction["tone"]) {
  if (tone === "good") {
    return "green";
  }

  if (tone === "action") {
    return "blue";
  }

  return "amber";
}

function impactTagClass(impact: InsightAction["impact"]) {
  if (impact === "High") {
    return "red";
  }

  if (impact === "Medium") {
    return "amber";
  }

  return "green";
}

function priceAlertTagClass(status: CollectionIntelligence["priceAlerts"][number]["status"]) {
  if (status === "Hit") {
    return "green";
  }

  if (status === "Refresh") {
    return "blue";
  }

  return "amber";
}


function compareNullableNumbers(
  left: number | null,
  right: number | null,
  direction: "asc" | "desc",
) {
  const emptyValue = direction === "asc" ? Number.POSITIVE_INFINITY : Number.NEGATIVE_INFINITY;

  return (left ?? emptyValue) - (right ?? emptyValue);
}

function sortCatalogueItems(
  left: CatalogueItem,
  right: CatalogueItem,
  sort: CatalogueSort | SetDetailSort,
) {
  if (sort === "value-desc") {
    return (catalogueMarketValueMinor(right) ?? -1) - (catalogueMarketValueMinor(left) ?? -1) ||
      compareCatalogueNumbers(left.number, right.number);
  }

  if (sort === "value-asc") {
    return compareNullableNumbers(catalogueMarketValueMinor(left), catalogueMarketValueMinor(right), "asc") ||
      compareCatalogueNumbers(left.number, right.number);
  }

  if (sort === "name" || sort === "name-asc") {
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
      left.set.localeCompare(right.set, undefined, { sensitivity: "base" }) ||
      compareCatalogueNumbers(left.number, right.number);
  }

  if (sort === "name-desc") {
    return right.name.localeCompare(left.name, undefined, { sensitivity: "base" }) ||
      left.set.localeCompare(right.set, undefined, { sensitivity: "base" }) ||
      compareCatalogueNumbers(left.number, right.number);
  }

  if (sort === "rarity") {
    return left.rarity.localeCompare(right.rarity, undefined, { sensitivity: "base" }) ||
      compareCatalogueNumbers(left.number, right.number);
  }

  if (sort === "set-number" || sort === "set-number-asc") {
    return left.set.localeCompare(right.set, undefined, { sensitivity: "base" }) ||
      compareCatalogueNumbers(left.number, right.number);
  }

  if (sort === "set-number-desc") {
    return right.set.localeCompare(left.set, undefined, { sensitivity: "base" }) ||
      compareCatalogueNumbers(right.number, left.number);
  }

  if (sort === "number-desc") {
    return compareCatalogueNumbers(right.number, left.number);
  }

  return compareCatalogueNumbers(left.number, right.number);
}

function sortSets(left: SetProgress, right: SetProgress, sort: SetListSort) {
  if (sort === "release-asc") {
    return releaseTime(left.releaseDate) - releaseTime(right.releaseDate) ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  }

  if (sort === "name-asc") {
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  }

  if (sort === "name-desc") {
    return right.name.localeCompare(left.name, undefined, { sensitivity: "base" });
  }

  if (sort === "completion-desc") {
    return completionPercent(right.owned, right.total) - completionPercent(left.owned, left.total) ||
      right.owned - left.owned ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  }

  if (sort === "completion-asc") {
    return completionPercent(left.owned, left.total) - completionPercent(right.owned, right.total) ||
      left.owned - right.owned ||
      left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
  }

  return releaseTime(right.releaseDate) - releaseTime(left.releaseDate) ||
    left.name.localeCompare(right.name, undefined, { sensitivity: "base" });
}

function sortWishlistItems(
  left: WishlistItem,
  right: WishlistItem,
  catalogueById: Map<string, CatalogueItem>,
  sort: WishlistSort,
) {
  const leftItem = catalogueById.get(left.catalogueId);
  const rightItem = catalogueById.get(right.catalogueId);
  const leftMarket = leftItem ? wishlistMarketValueMinor(leftItem, left) : null;
  const rightMarket = rightItem ? wishlistMarketValueMinor(rightItem, right) : null;
  const leftTarget = left.targetPriceMinor ?? leftMarket;
  const rightTarget = right.targetPriceMinor ?? rightMarket;

  if (sort === "target-desc") {
    return compareNullableNumbers(rightTarget, leftTarget, "desc") || compareWishlistNames(leftItem, rightItem);
  }

  if (sort === "target-asc") {
    return compareNullableNumbers(leftTarget, rightTarget, "asc") || compareWishlistNames(leftItem, rightItem);
  }

  if (sort === "market-desc") {
    return compareNullableNumbers(rightMarket, leftMarket, "desc") || compareWishlistNames(leftItem, rightItem);
  }

  if (sort === "market-asc") {
    return compareNullableNumbers(leftMarket, rightMarket, "asc") || compareWishlistNames(leftItem, rightItem);
  }

  if (sort === "set-number-asc") {
    return compareWishlistSetOrder(leftItem, rightItem, "asc");
  }

  if (sort === "set-number-desc") {
    return compareWishlistSetOrder(leftItem, rightItem, "desc");
  }

  if (sort === "name-asc") {
    return compareWishlistNames(leftItem, rightItem);
  }

  if (sort === "name-desc") {
    return compareWishlistNames(rightItem, leftItem);
  }

  return priorityRank(right.priority) - priorityRank(left.priority) || compareWishlistNames(leftItem, rightItem);
}

function wishlistMarketValueMinor(catalogueItem: CatalogueItem, wishlistItem: WishlistItem) {
  if (catalogueItem.type === "card" && wishlistItem.variant?.trim()) {
    return catalogueValueMinorForVariant(catalogueItem, wishlistItem.variant) ?? null;
  }

  return catalogueMarketValueMinor(catalogueItem);
}

function defaultWishlistVariant(item: CatalogueItem) {
  if (item.type !== "card" || !item.variantOptions?.length) return undefined;

  const priced = item.variantOptions.filter((option) => option.valueMinor !== undefined);
  const baseNames = new Set(["normal", "standard"]);
  const preferred = priced.find((option) => baseNames.has(normalizeVariantLabel(option.label))) ??
    priced[0] ??
    item.variantOptions.find((option) => baseNames.has(normalizeVariantLabel(option.label))) ??
    item.variantOptions[0];

  return preferred?.label;
}

function compareWishlistNames(left?: CatalogueItem, right?: CatalogueItem) {
  return (left?.name ?? "").localeCompare(right?.name ?? "", undefined, { sensitivity: "base" }) ||
    (left?.set ?? "").localeCompare(right?.set ?? "", undefined, { sensitivity: "base" }) ||
    compareCatalogueNumbers(left?.number ?? "", right?.number ?? "");
}

function compareWishlistSetOrder(left: CatalogueItem | undefined, right: CatalogueItem | undefined, direction: "asc" | "desc") {
  const first = direction === "asc" ? left : right;
  const second = direction === "asc" ? right : left;

  return (first?.set ?? "").localeCompare(second?.set ?? "", undefined, { sensitivity: "base" }) ||
    compareCatalogueNumbers(first?.number ?? "", second?.number ?? "") ||
    compareWishlistNames(left, right);
}

function priorityRank(priority: WishlistItem["priority"]) {
  return { Low: 1, Medium: 2, High: 3, Grail: 4 }[priority] ?? 0;
}

function matchesCatalogueSearch(item: CatalogueItem, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  const queryTokens = searchTokens(normalizedQuery);
  const searchableTokens = catalogueSearchTokens(item);
  const compactSearchable = searchableTokens.join("");

  return queryTokens.every((queryToken) =>
    compactSearchable.includes(queryToken) ||
    searchableTokens.some((token) => token.includes(queryToken)),
  );
}

function catalogueSearchTokens(item: CatalogueItem) {
  return uniqueValues([
    ...searchTokens(catalogueItemTitle(item)),
    ...searchTokens(item.name),
    ...catalogueNameAliasesForText(item.name).flatMap((alias) => searchTokens(alias)),
    ...searchTokens(catalogueItemSetLabel(item)),
    ...searchTokens(item.set),
    ...searchTokens(item.number),
    ...searchTokens(item.rarity),
    ...searchTokens(item.language ?? ""),
    ...searchTokens(item.languageLabel ?? ""),
    ...searchTokens(item.regionLabel ?? ""),
    ...searchTokens(`${item.set} ${item.number}`),
    ...(item.variantOptions ?? []).flatMap((option) => searchTokens(option.label)),
  ]);
}

function matchesSetSearch(set: SetProgress, normalizedQuery: string) {
  if (!normalizedQuery) {
    return true;
  }

  const queryTokens = searchTokens(normalizedQuery);
  const searchableTokens = uniqueValues([
    ...searchTokens(set.name),
    ...searchTokens(setTitle(set)),
    ...searchTokens(set.series ?? ""),
    ...searchTokens(set.language ?? ""),
    ...searchTokens(set.languageLabel ?? ""),
    ...searchTokens(set.regionLabel ?? ""),
    ...searchTokens(set.releaseDate?.slice(0, 4) ?? ""),
  ]);
  const compactSearchable = searchableTokens.join("");

  return queryTokens.every((queryToken) =>
    compactSearchable.includes(queryToken) ||
    searchableTokens.some((token) => token.includes(queryToken)),
  );
}

function catalogueItemTitle(item: CatalogueItem) {
  return item.displayName ?? item.name;
}

function catalogueItemSetLabel(item: CatalogueItem) {
  return item.displaySet ?? item.set;
}

function ebaySoldSearchUrl(item: CatalogueItem) {
  const query = [
    catalogueItemTitle(item),
    item.number !== "Sealed" ? item.number : undefined,
    catalogueItemSetLabel(item),
  ].filter(Boolean).join(" ");
  const params = new URLSearchParams({
    _ipg: "60",
    _nkw: query,
    LH_Complete: "1",
    LH_PrefLoc: "1",
    LH_Sold: "1",
  });

  return `https://www.ebay.co.uk/sch/i.html?${params.toString()}`;
}

function setTitle(set: SetProgress) {
  return set.displayName ?? set.name;
}

function normalizeSearchText(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/['’]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function searchTokens(value: string) {
  return normalizeSearchText(value).split(" ").filter(Boolean);
}

function groupedSetOptions(setNames: string[], sets: SetProgress[]): SetOptionGroup[] {
  const setByName = new Map(sets.map((set) => [set.name, set]));
  const groups = new Map<string, SetOptionGroup["options"]>();

  for (const setName of setNames) {
    const set = setByName.get(setName);
    const groupName = set?.series?.trim() || "Other sets";
    const options = groups.get(groupName) ?? [];
    options.push({
      displayName: set?.displayName,
      name: setName,
      releaseDate: set?.releaseDate,
    });
    groups.set(groupName, options);
  }

  return [...groups.entries()]
    .map(([label, options]) => ({
      label,
      options: options.sort(compareSetOptions),
    }))
    .sort((left, right) => newestSetTime(right.options) - newestSetTime(left.options) ||
      left.label.localeCompare(right.label, undefined, { sensitivity: "base" }));
}

function compareSetOptions(
  left: SetOptionGroup["options"][number],
  right: SetOptionGroup["options"][number],
) {
  return releaseTime(right.releaseDate) - releaseTime(left.releaseDate) ||
    (left.displayName ?? left.name).localeCompare(right.displayName ?? right.name, undefined, { sensitivity: "base" });
}

function newestSetTime(options: SetOptionGroup["options"]) {
  return Math.max(...options.map((option) => releaseTime(option.releaseDate)), Number.NEGATIVE_INFINITY);
}

function releaseTime(value?: string) {
  if (!value) {
    return Number.NEGATIVE_INFINITY;
  }

  const timestamp = Date.parse(value);

  return Number.isFinite(timestamp) ? timestamp : Number.NEGATIVE_INFINITY;
}

function formatSetOptionLabel(option: SetOptionGroup["options"][number]) {
  const year = option.releaseDate?.slice(0, 4);
  const label = option.displayName ?? option.name;

  return year ? `${year} - ${label}` : label;
}

function compareCatalogueNumbers(left: string, right: string) {
  const leftParsed = parseCatalogueNumber(left);
  const rightParsed = parseCatalogueNumber(right);

  if (leftParsed !== rightParsed) {
    return leftParsed - rightParsed;
  }

  return left.localeCompare(right, undefined, { numeric: true, sensitivity: "base" });
}

function parseCatalogueNumber(value: string) {
  const match = value.match(/\d+/);

  return match ? Number(match[0]) : Number.POSITIVE_INFINITY;
}

function importPayload(row: CollectionImportRow) {
  return {
    catalogueId: row.catalogueId,
    quantity: row.quantity,
    condition: row.condition,
    language: row.language,
    variant: row.variant,
    gradeCompany: gradeCompanyFromLabel(row.grade),
    gradeScore: gradeScoreFromLabel(row.grade),
    paid: row.paid,
    purchaseDate: row.purchaseDate ?? "",
    overrideValue: row.overrideValue ?? "",
    valuationNote: row.valuationNote ?? "",
    location: row.location,
    notes: row.notes,
  };
}

function binderStorageKey(email: string) {
  const owner = email.trim().toLowerCase() || "local";

  return `${binderStoragePrefix}:${owner}`;
}

function defaultBinderSettingsStorageKey(email: string) {
  const owner = email.trim().toLowerCase() || "local";

  return `${defaultBinderSettingsStoragePrefix}:${owner}`;
}

function readStoredBinders(storageKey: string): LegacyStoredBinder[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "[]");

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed
      .map((value) => sanitizeStoredBinder(value))
      .filter((binder): binder is LegacyStoredBinder => Boolean(binder));
  } catch {
    return [];
  }
}

function readStoredDefaultBinderSettings(storageKey: string): DefaultBinderSettings {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(storageKey) ?? "{}");
    return sanitizeStoredDefaultBinderSettings(parsed);
  } catch {
    return defaultBinderSettingsFallback;
  }
}

function sanitizeStoredDefaultBinderSettings(value: unknown): DefaultBinderSettings {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return defaultBinderSettingsFallback;
  }

  const source = value as Record<string, unknown>;
  const itemIds = Array.isArray(source.itemIds)
    ? uniqueValues(source.itemIds.filter((itemId): itemId is string => typeof itemId === "string" && itemId.trim().length > 0))
    : [];

  return {
    artworkId: isBinderArtworkId(source.artworkId) ? source.artworkId : defaultBinderSettingsFallback.artworkId,
    interiorId: isBinderInteriorId(source.interiorId) ? source.interiorId : defaultBinderSettingsFallback.interiorId,
    itemIds,
  };
}

function sanitizeStoredBinder(value: unknown): LegacyStoredBinder | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const source = value as Record<string, unknown>;
  const id = typeof source.id === "string" && source.id.trim() ? source.id.trim() : "";
  const name = typeof source.name === "string" && source.name.trim() ? source.name.trim() : "";
  const artworkId = isBinderArtworkId(source.artworkId) ? source.artworkId : "mint";
  const interiorId = isBinderInteriorId(source.interiorId) ? source.interiorId : "classic";
  const createdAt = typeof source.createdAt === "string" && source.createdAt.trim()
    ? source.createdAt
    : new Date().toISOString();
  const itemIds = Array.isArray(source.itemIds)
    ? uniqueValues(source.itemIds.filter((itemId): itemId is string => typeof itemId === "string" && itemId.trim().length > 0))
    : [];

  return id && name ? { artworkId, createdAt, id, interiorId, itemIds, name } : null;
}

function binderMigrationStorageKey(email: string) {
  const owner = email.trim().toLowerCase() || "local";
  return `${binderMigrationStoragePrefix}:${owner}`;
}

async function fetchServerBinders(signal?: AbortSignal) {
  const response = await fetchBinderRequest(
    "/api/binders",
    { cache: "no-store", signal },
    "Binder sync took too long. Your collection binder is still available; retry sync in a moment.",
  );
  const body = (await response.json().catch(() => ({}))) as { binders?: unknown[]; error?: string };

  if (!response.ok) {
    throw new Error(body.error ?? `Binder load failed with ${response.status}.`);
  }

  return (body.binders ?? []).map(normalizeServerBinder).filter((binder): binder is CustomBinder => Boolean(binder));
}

async function fetchBinderRequest(url: string, init: RequestInit, timeoutMessage: string) {
  const controller = new AbortController();
  const upstreamSignal = init.signal;
  let timedOut = false;
  const abortFromUpstream = () => controller.abort(upstreamSignal?.reason);
  if (upstreamSignal?.aborted) {
    abortFromUpstream();
  } else {
    upstreamSignal?.addEventListener("abort", abortFromUpstream, { once: true });
  }
  const timeout = window.setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, BINDER_SYNC_TIMEOUT_MS);

  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (timedOut) {
      throw new Error(timeoutMessage);
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
    upstreamSignal?.removeEventListener("abort", abortFromUpstream);
  }
}

async function createServerBinder(input: {
  artworkId: BinderArtworkId;
  description?: string;
  isDefault?: boolean;
  legacySource?: string;
  managedDefaultBootstrap?: boolean;
  name: string;
}) {
  const response = await fetchBinderRequest(
    "/api/binders",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        coverStyle: serverCoverStyleFromArtwork(input.artworkId),
        description: input.description ?? "",
        isDefault: input.isDefault,
        legacySource: input.legacySource,
        managedDefaultBootstrap: input.managedDefaultBootstrap === true,
        name: input.name,
      }),
    },
    "Binder creation took too long. Refresh binder sync before trying again.",
  );
  const body = (await response.json().catch(() => ({}))) as { binder?: unknown; error?: string };

  if (!response.ok || !body.binder) {
    throw new Error(body.error ?? `Binder creation failed with ${response.status}.`);
  }

  const binder = normalizeServerBinder(body.binder);
  if (!binder) throw new Error("Binder creation returned an invalid response.");
  return binder;
}

async function replaceServerBinderLayout(
  binderId: string,
  pages: BinderPageRecord[],
  options: {
    completeLegacyCustomMigration?: boolean;
    completeLegacyDefaultMigration?: boolean;
    expectedUpdatedAt: string;
    releaseConflictsFromDefaultBinderId?: string;
    releaseConflictsFromDefaultUpdatedAt?: string;
  },
) {
  const response = await fetchBinderRequest(
    `/api/binders/${encodeURIComponent(binderId)}/layout`,
    {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        completeLegacyCustomMigration: options.completeLegacyCustomMigration === true,
        completeLegacyDefaultMigration: options.completeLegacyDefaultMigration === true,
        expectedUpdatedAt: options.expectedUpdatedAt,
        pages: binderLayoutPayload(pages),
        releaseConflictsFromDefaultBinderId: options.releaseConflictsFromDefaultBinderId,
        releaseConflictsFromDefaultUpdatedAt: options.releaseConflictsFromDefaultUpdatedAt,
      }),
    },
    "Binder layout save took too long. Refresh binder sync to confirm its state.",
  );
  const body = (await response.json().catch(() => ({}))) as { binder?: unknown; error?: string };

  if (!response.ok || !body.binder) {
    throw new Error(body.error ?? `Binder layout save failed with ${response.status}.`);
  }

  const binder = normalizeServerBinder(body.binder);
  if (!binder) throw new Error("Binder layout save returned an invalid response.");
  return binder;
}

async function patchServerBinder(
  binder: Pick<CustomBinder, "id" | "updatedAt">,
  input: Partial<{
    coverStyle: string;
    description: string;
    isDefault: boolean;
    name: string;
    visibility: BinderVisibility;
  }>,
) {
  const response = await fetch(`/api/binders/${encodeURIComponent(binder.id)}`, {
    method: "PATCH",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ ...input, expectedUpdatedAt: binder.updatedAt }),
  });
  const body = (await response.json().catch(() => ({}))) as { binder?: unknown; error?: string };

  if (!response.ok || !body.binder) {
    throw new Error(body.error ?? `Binder update failed with ${response.status}.`);
  }

  const updated = normalizeServerBinder(body.binder);
  if (!updated) throw new Error("Binder update returned an invalid response.");
  return updated;
}

async function deleteServerBinder(binder: Pick<CustomBinder, "id" | "updatedAt">) {
  const response = await fetch(`/api/binders/${encodeURIComponent(binder.id)}`, {
    method: "DELETE",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ expectedUpdatedAt: binder.updatedAt }),
  });
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  if (!response.ok) throw new Error(body.error ?? `Binder deletion failed with ${response.status}.`);
}

function cloneBinderPages(pages: BinderPageRecord[]) {
  return pages.map((page) => ({ ...page, slots: page.slots.map((slot) => ({ ...slot })) }));
}

function swapBinderSlots(sourcePages: BinderPageRecord[], sourceIndex: number, targetIndex: number) {
  const pages = cloneBinderPages(sourcePages);
  const flat = pages.flatMap((page) => page.slots);
  const source = flat[sourceIndex];
  const target = flat[targetIndex];
  if (!source || !target) return pages;
  const sourceContent = { collectionItemId: source.collectionItemId, copyIndex: source.copyIndex, note: source.note };
  const targetContent = { collectionItemId: target.collectionItemId, copyIndex: target.copyIndex, note: target.note };
  Object.assign(source, targetContent);
  Object.assign(target, sourceContent);
  return pages;
}

async function migrateLegacyBinders({
  binders,
  collection,
  legacyBinders,
  legacyDefault,
  signal,
}: {
  binders: CustomBinder[];
  collection: CollectionItem[];
  legacyBinders: LegacyStoredBinder[];
  legacyDefault: DefaultBinderSettings;
  signal?: AbortSignal;
}) {
  let nextBinders = [...binders];
  let migratedCount = 0;
  const collectionById = new Map(collection.map((item) => [item.id, item]));
  const cardItems = collection;
  let pendingDefault = nextBinders.find((binder) => binder.isDefault);

  if (!pendingDefault && cardItems.length) {
    const created = await createServerBinder({
      artworkId: legacyDefault.artworkId,
      description: "Every active card lot, migrated from this device.",
      isDefault: true,
      managedDefaultBootstrap: true,
      name: uniqueBinderName("Full Card Collection", nextBinders),
    });
    pendingDefault = created;
    nextBinders = [created, ...nextBinders.map((binder) => ({ ...binder, isDefault: false }))];
    migratedCount += 1;
  }

  for (const legacy of legacyBinders) {
    const legacySource = encodeURIComponent(legacy.id).slice(0, 120);
    const existingMigration = nextBinders.find((binder) => binder.legacySource === legacySource);
    if (existingMigration && !existingMigration.legacyMigrationPending) {
      continue;
    }
    const created = existingMigration ?? await createServerBinder({
      artworkId: legacy.artworkId,
      description: "Migrated from this device. The original local copy remains available as a safety backup.",
      legacySource,
      name: uniqueBinderName(legacy.name.slice(0, 70), nextBinders),
    });
    const existingHasAssignments = Boolean(existingMigration?.pages.some((page) =>
      page.slots.some((slot) => slot.collectionItemId),
    ));
    if (existingMigration && existingHasAssignments) {
      const completed = await replaceServerBinderLayout(existingMigration.id, existingMigration.pages, {
        completeLegacyCustomMigration: true,
        expectedUpdatedAt: existingMigration.updatedAt,
      });
      nextBinders = nextBinders.map((binder) => (binder.id === completed.id ? completed : binder));
      continue;
    }
    const legacyItems = legacy.itemIds
      .map((itemId) => collectionById.get(itemId))
      .filter((item): item is CollectionItem => Boolean(item));
    const releasePendingDefault = pendingDefault && (
      shouldCompleteMigratedDefaultBinder([pendingDefault], cardItems.length) ||
      (pendingDefault.isDefault && pendingDefault.managedDefault)
    ) ? pendingDefault : null;
    const entries = unassignedBinderEntries(
      legacyItems,
      nextBinders,
      [created.id, ...(releasePendingDefault ? [releasePendingDefault.id] : [])],
    );
    const saved = await replaceServerBinderLayout(created.id, buildBinderPages(entries), {
      completeLegacyCustomMigration: true,
      expectedUpdatedAt: created.updatedAt,
      releaseConflictsFromDefaultBinderId: releasePendingDefault?.id,
      releaseConflictsFromDefaultUpdatedAt: releasePendingDefault?.updatedAt,
    });
    nextBinders = releasePendingDefault
      ? await fetchServerBinders(signal)
      : existingMigration
        ? nextBinders.map((binder) => (binder.id === saved.id ? saved : binder))
        : [...nextBinders, saved];
    pendingDefault = nextBinders.find((binder) => binder.isDefault);
    if (!existingMigration) migratedCount += 1;
  }

  if (
    pendingDefault &&
    shouldCompleteMigratedDefaultBinder([pendingDefault], cardItems.length)
  ) {
    const orderedItems = orderedCollectionItems(cardItems, legacyDefault.itemIds);
    const representedLotIds = new Set(
      pendingDefault.pages
        .flatMap((page) => page.slots)
        .map((slot) => slot.collectionItemId)
        .filter((itemId): itemId is string => Boolean(itemId)),
    );
    const missingItems = orderedItems.filter((item) => !representedLotIds.has(item.id));
    const entries = unassignedBinderEntries(missingItems, nextBinders, pendingDefault.id);
    const appended = appendBinderEntriesToBlankSlots(
      pendingDefault.pages,
      entries,
      MAX_MANAGED_BINDER_PAGES,
    );
    if (appended.placedCount !== entries.length) {
      throw new Error("The Full Card Collection binder is at capacity and could not finish syncing.");
    }
    const saved = await replaceServerBinderLayout(
      pendingDefault.id,
      appended.pages,
      {
        completeLegacyDefaultMigration: true,
        expectedUpdatedAt: pendingDefault.updatedAt,
      },
    );
    nextBinders = nextBinders.map((binder) => (binder.id === saved.id ? saved : binder));
  }

  return { binders: nextBinders, complete: true, migratedCount };
}

async function syncManagedDefaultBinder(
  binders: CustomBinder[],
  collection: CollectionItem[],
) {
  const managedDefault = binders.find((binder) => binder.isDefault && binder.managedDefault);
  if (!managedDefault || !collection.length) return binders;

  const representedLotIds = new Set(
    managedDefault.pages
      .flatMap((page) => page.slots)
      .map((slot) => slot.collectionItemId)
      .filter((itemId): itemId is string => Boolean(itemId)),
  );
  const missingLots = collection.filter((item) => !representedLotIds.has(item.id));
  const entries = unassignedBinderEntries(missingLots, binders, managedDefault.id);
  if (!entries.length) return binders;

  const assignedBefore = managedDefault.pages
    .flatMap((page) => page.slots)
    .filter((slot) => slot.collectionItemId).length;
  const appended = appendBinderEntriesToBlankSlots(
    managedDefault.pages,
    entries,
    MAX_MANAGED_BINDER_PAGES,
  );
  if (appended.placedCount !== entries.length) {
    throw new Error("The Full Card Collection binder is at capacity and could not finish syncing.");
  }
  const assignedAfter = appended.pages.flatMap((page) => page.slots).filter((slot) => slot.collectionItemId).length;
  if (assignedAfter === assignedBefore) return binders;

  const saved = await replaceServerBinderLayout(managedDefault.id, appended.pages, {
    expectedUpdatedAt: managedDefault.updatedAt,
  });
  return binders.map((binder) => (binder.id === saved.id ? saved : binder));
}

function normalizeServerBinder(value: unknown): CustomBinder | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const id = typeof source.id === "string" ? source.id : "";
  const name = typeof source.name === "string" ? source.name : "";
  if (!id || !name) return null;
  const coverStyle = typeof source.coverStyle === "string" ? source.coverStyle : "forest";
  const rawDescription = typeof source.description === "string" ? source.description : "";
  const legacySourceMatch = rawDescription.match(/\s*\[Legacy (source|migrated): ([^\]]+)]\s*$/);
  const managedDefault = hasManagedDefaultBinderMarker(rawDescription);
  const pages = Array.isArray(source.pages)
    ? source.pages.map(normalizeServerBinderPage).filter((page): page is BinderPageRecord => Boolean(page))
    : [];

  return {
    artworkId: artworkFromServerCoverStyle(coverStyle),
    coverStyle,
    createdAt: typeof source.createdAt === "string" ? source.createdAt : new Date().toISOString(),
    description: visibleBinderDescription(rawDescription) ?? "",
    id,
    interiorId: "classic",
    isDefault: source.isDefault === true,
    legacyMigrationPending: legacySourceMatch?.[1] === "source",
    legacySource: legacySourceMatch?.[2],
    managedDefault,
    name,
    pages: pages.length ? pages : buildBinderPages([]),
    shareSlug: typeof source.shareSlug === "string" && source.shareSlug ? source.shareSlug : undefined,
    updatedAt: typeof source.updatedAt === "string" ? source.updatedAt : new Date().toISOString(),
    visibility: String(source.visibility).toLowerCase() === "unlisted" ? "unlisted" : "private",
  };
}

function normalizeServerBinderPage(value: unknown): BinderPageRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const position = Number(source.position);
  if (!Number.isSafeInteger(position) || position < 0) return null;
  const slots = Array.isArray(source.slots)
    ? source.slots.map(normalizeServerBinderSlot).filter((slot): slot is BinderSlotRecord => Boolean(slot))
    : [];

  return {
    id: typeof source.id === "string" ? source.id : undefined,
    position,
    slots: Array.from({ length: 9 }, (_, slotPosition) =>
      slots.find((slot) => slot.position === slotPosition) ?? emptyBinderSlot(slotPosition),
    ),
  };
}

function normalizeServerBinderSlot(value: unknown): BinderSlotRecord | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const source = value as Record<string, unknown>;
  const position = Number(source.position);
  if (!Number.isSafeInteger(position) || position < 0 || position > 8) return null;
  const collectionItemId = typeof source.collectionItemId === "string" ? source.collectionItemId : null;
  const copyIndex = collectionItemId && Number.isSafeInteger(Number(source.copyIndex)) ? Number(source.copyIndex) : null;

  return {
    collectionItemId,
    copyIndex,
    id: typeof source.id === "string" ? source.id : undefined,
    note: typeof source.note === "string" ? source.note : null,
    position,
  };
}

function emptyBinderSlot(position: number): BinderSlotRecord {
  return { collectionItemId: null, copyIndex: null, note: null, position };
}

function binderCopyCounts(pages: BinderPageRecord[]) {
  return pages.flatMap((page) => page.slots).reduce<Record<string, number>>((counts, slot) => {
    if (slot.collectionItemId) {
      counts[slot.collectionItemId] = (counts[slot.collectionItemId] ?? 0) + 1;
    }
    return counts;
  }, {});
}

function buildBinderPages(
  entries: Array<{ collectionItemId: string; copyIndex: number }>,
  minimumPages = 2,
  maxPages = MAX_STANDARD_BINDER_PAGES,
) {
  if (entries.length > maxPages * 9) {
    throw new Error(`This binder cannot hold more than ${maxPages * 9} card copies.`);
  }
  const pageCount = Math.max(minimumPages, Math.ceil(entries.length / 9), 1);
  return Array.from({ length: pageCount }, (_, pagePosition): BinderPageRecord => ({
    position: pagePosition,
    slots: Array.from({ length: 9 }, (_entry, slotPosition) => {
      const entry = entries[pagePosition * 9 + slotPosition];
      return entry
        ? { ...entry, note: null, position: slotPosition }
        : emptyBinderSlot(slotPosition);
    }),
  }));
}

function binderLayoutPayload(pages: BinderPageRecord[]) {
  return [...pages]
    .sort((left, right) => left.position - right.position)
    .map((page, pagePosition) => ({
      position: pagePosition,
      slots: Array.from({ length: 9 }, (_, slotPosition) => {
        const slot = page.slots.find((candidate) => candidate.position === slotPosition) ?? emptyBinderSlot(slotPosition);
        return {
          collectionItemId: slot.collectionItemId,
          copyIndex: slot.collectionItemId ? slot.copyIndex ?? 1 : null,
          note: slot.note ?? null,
          position: slotPosition,
        };
      }),
    }));
}

function uniqueBinderName(preferred: string, binders: CustomBinder[]) {
  const names = new Set(binders.map((binder) => binder.name.trim().toLowerCase()));
  if (!names.has(preferred.trim().toLowerCase())) return preferred;
  let suffix = 2;
  while (names.has(`${preferred} ${suffix}`.toLowerCase())) suffix += 1;
  return `${preferred} ${suffix}`;
}

function serverCoverStyleFromArtwork(artworkId: BinderArtworkId) {
  return ({
    mint: "forest",
    vault: "midnight",
    sunburst: "sunset",
    ocean: "sapphire",
    rose: "oxblood",
    midnight: "midnight",
  } satisfies Record<BinderArtworkId, string>)[artworkId];
}

function artworkFromServerCoverStyle(coverStyle: string): BinderArtworkId {
  const normalized = coverStyle.trim().toLowerCase();
  if (normalized === "sapphire") return "ocean";
  if (normalized === "sunset") return "sunburst";
  if (normalized === "oxblood") return "rose";
  if (normalized === "midnight") return "midnight";
  if (normalized === "ivory") return "vault";
  return "mint";
}

function isBinderArtworkId(value: unknown): value is BinderArtworkId {
  return typeof value === "string" && binderArtworkOptions.some((artwork) => artwork.id === value);
}

function isBinderInteriorId(value: unknown): value is BinderInteriorId {
  return typeof value === "string" && binderInteriorOptions.some((interior) => interior.id === value);
}

function binderSummaries(
  collection: CollectionItem[],
  customBinders: CustomBinder[],
): BinderSummary[] {
  const collectionById = new Map(collection.map((item) => [item.id, item]));
  return customBinders.map((binder) => {
    const pages = [...binder.pages].sort((left, right) => left.position - right.position);
    const slots = pages.flatMap((page) =>
      page.slots
        .slice()
        .sort((left, right) => left.position - right.position)
        .map((slot) => ({ ...slot, item: slot.collectionItemId ? collectionById.get(slot.collectionItemId) : undefined })),
    );

    return {
      artworkId: binder.artworkId,
      description: binder.description || `${slots.filter((slot) => slot.item).length} filled pocket${slots.filter((slot) => slot.item).length === 1 ? "" : "s"}.`,
      id: binder.id,
      interiorId: isBinderInteriorId(binder.interiorId) ? binder.interiorId : "classic",
      isDefault: binder.isDefault,
      items: slots.map((slot) => slot.item).filter((item): item is CollectionItem => Boolean(item)),
      name: binder.name,
      pages,
      shareSlug: binder.shareSlug,
      slots,
      visibility: binder.visibility,
    };
  });
}

function orderedCollectionItems(collection: CollectionItem[], preferredItemIds: string[]) {
  const collectionById = new Map(collection.map((item) => [item.id, item]));
  const orderedItems = preferredItemIds
    .map((itemId) => collectionById.get(itemId))
    .filter((item): item is CollectionItem => Boolean(item));
  const orderedIds = new Set(orderedItems.map((item) => item.id));
  const remainingItems = collection.filter((item) => !orderedIds.has(item.id));

  return [...orderedItems, ...remainingItems];
}

function defaultBinderSummary(
  collection: CollectionItem[],
  settings: DefaultBinderSettings = defaultBinderSettingsFallback,
): BinderSummary {
  return {
    artworkId: settings.artworkId,
    description: "Every active card lot appears here automatically.",
    id: defaultBinderId,
    interiorId: settings.interiorId,
    isDefault: true,
    items: collection,
    name: "Full Card Collection",
    pages: buildBinderPages(
      collection.map((item) => ({ collectionItemId: item.id, copyIndex: 1 })),
      2,
      MAX_MANAGED_BINDER_PAGES,
    ),
    slots: buildBinderPages(
      collection.map((item) => ({ collectionItemId: item.id, copyIndex: 1 })),
      2,
      MAX_MANAGED_BINDER_PAGES,
    )
      .flatMap((page) => page.slots.map((slot) => ({ ...slot, item: slot.collectionItemId ? collection.find((item) => item.id === slot.collectionItemId) : undefined }))),
    visibility: "private",
  };
}

function binderStageStyle(artworkId: BinderArtworkId, interiorId: BinderInteriorId): CSSProperties {
  return {
    ...binderArtworkStyle(artworkId),
    ...binderInteriorStyle(interiorId),
  };
}

function binderArtworkStyle(artworkId: BinderArtworkId): CSSProperties {
  const artwork = binderArtwork(artworkId);

  return {
    "--binder-accent": artwork.accent,
    "--binder-spine": artwork.spine,
    "--binder-surface": artwork.surface,
  } as CSSProperties;
}

function binderArtwork(artworkId: BinderArtworkId) {
  return binderArtworkOptions.find((artwork) => artwork.id === artworkId) ?? binderArtworkOptions[0];
}

function binderInteriorStyle(interiorId: BinderInteriorId): CSSProperties {
  const interior = binderInterior(interiorId);

  return {
    "--binder-inner": interior.surface,
    "--binder-page": interior.page,
    "--binder-pocket": interior.pocket,
    "--binder-ring": interior.ring,
    "--binder-stitch": interior.stitch,
  } as CSSProperties;
}

function binderInterior(interiorId: BinderInteriorId) {
  return binderInteriorOptions.find((interior) => interior.id === interiorId) ?? binderInteriorOptions[0];
}

function storageOptionNames(locations: StorageLocation[], current?: string) {
  return uniqueValues([...locations.map((location) => location.name), current ?? "", "Unassigned"]);
}

function upsertCatalogueItem(items: CatalogueItem[], nextItem: CatalogueItem) {
  return [
    nextItem,
    ...items.filter((item) => item.id !== nextItem.id),
  ];
}

function mergeCatalogueItems(items: CatalogueItem[], nextItems: CatalogueItem[]) {
  const nextById = new Map(nextItems.map((item) => [item.id, item]));
  const existingIds = new Set(items.map((item) => item.id));

  return [
    ...nextItems.filter((item) => !existingIds.has(item.id)),
    ...items.map((item) => nextById.get(item.id) ?? item),
  ];
}

function defaultStorageLocation(locations: StorageLocation[], itemType: ItemType) {
  const preferredType: StorageLocation["type"] = itemType === "sealed" ? "Box" : "Binder";
  const preferred = locations.find((location) => location.type === preferredType);

  return preferred?.name ?? locations[0]?.name ?? "Unassigned";
}

function mergeStorageLocation(locations: StorageLocation[], nextLocation: StorageLocation) {
  const merged = [
    nextLocation,
    ...locations.filter((location) => location.id !== nextLocation.id),
  ];

  return merged.sort((left, right) => left.name.localeCompare(right.name));
}

function eventSummary(event: CollectionEvent) {
  const parts = [
    event.quantity ? `Qty ${event.quantity}` : "",
    event.amountMinor ? formatMoney(event.amountMinor) : "",
    formatEventDate(event.occurredAt),
  ].filter(Boolean);

  return parts.join(" | ");
}

function billingProviderLabel(provider?: string) {
  if (provider === "stripe") {
    return "Stripe";
  }

  if (provider === "square") {
    return "Square";
  }

  return "Billing";
}

function billingStatusLabel(subscription: AppSubscription) {
  if (subscription.cancelAtPeriodEnd) {
    return "Renewal cancelled";
  }

  if (subscription.plan === "plus" && isActiveBillingStatus(subscription.status)) {
    return "Active";
  }

  if (subscription.plan === "free" && !subscription.providerSubscriptionId) {
    return "Not connected";
  }

  if (!subscription.status) {
    return "Not connected";
  }

  return titleCaseBillingStatus(subscription.status);
}

function billingPeriodLabel(subscription: AppSubscription) {
  if (!subscription.currentPeriodEnd) {
    return "";
  }

  return `${subscription.cancelAtPeriodEnd ? "Access until" : "Renews"} ${formatEventDate(subscription.currentPeriodEnd)}`;
}

function isActiveBillingStatus(status?: string) {
  return status === "ACTIVE" || status === "TRIALING";
}

function titleCaseBillingStatus(status: string) {
  return status
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatEventDate(value: string) {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

function payloadFromCollectionItem(item: CollectionItem) {
  return {
    catalogueId: item.catalogueId,
    quantity: item.quantity,
    condition: item.condition,
    language: item.language,
    variant: item.variant,
    gradeCompany: gradeCompanyFromLabel(item.grade),
    gradeScore: gradeScoreFromLabel(item.grade),
    paid: moneyInputValue(item.purchasePriceMinor),
    purchaseDate: item.purchaseDate ?? "",
    overrideValue: moneyInputValue(item.overrideValueMinor),
    valuationNote: item.valuationNote ?? "",
    location: item.location,
    notes: item.notes ?? "",
  };
}

function moneyInputValue(value?: number) {
  return value === undefined ? "" : (value / 100).toFixed(2);
}

function moneyInputToMinor(value?: string) {
  const normalized = String(value ?? "").replace(/[^0-9.]/g, "");
  const amount = Number(normalized);

  if (!normalized || !Number.isFinite(amount)) {
    return undefined;
  }

  return Math.round(amount * 100);
}

function defaultWishlistTargetMinor(marketValueMinor: number | null) {
  if (marketValueMinor === null || !Number.isFinite(marketValueMinor) || marketValueMinor <= 0) {
    return undefined;
  }

  return Math.max(1, Math.round(marketValueMinor * 0.9));
}

function normalizePriority(value: string): WishlistItem["priority"] {
  const priorities: WishlistItem["priority"][] = ["Low", "Medium", "High", "Grail"];
  const match = priorities.find((priority) => priority.toLowerCase() === value.trim().toLowerCase());

  return match ?? "Medium";
}

function wishlistDeltaText(deltaMinor: number) {
  if (deltaMinor === 0) {
    return "At target";
  }

  return deltaMinor > 0
    ? `${formatMoney(deltaMinor)} below target`
    : `${formatMoney(Math.abs(deltaMinor))} above target`;
}

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });

  downloadBlob(filename, blob);
}

function downloadBlob(filename: string, blob: Blob) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");

  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function dateStamp(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function uniqueValues(values: string[]) {
  return Array.from(new Set(values.filter(Boolean)));
}

function isThemeId(value: unknown): value is ThemeId {
  return typeof value === "string" && themeOptions.some((theme) => theme.id === value);
}

function isThemeAllowed(themeId: ThemeId, plus: boolean) {
  return plus || freeThemeIds.has(themeId);
}

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

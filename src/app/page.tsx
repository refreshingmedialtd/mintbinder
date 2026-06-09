"use client";

import {
  ArrowLeft,
  ArrowDownUp,
  BarChart3,
  Bell,
  Boxes,
  Check,
  CreditCard,
  Database,
  Download,
  GalleryVerticalEnd,
  Grid2X2,
  Heart,
  History,
  Layers3,
  List,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Mail,
  Lock,
  Palette,
  PackagePlus,
  Plus,
  RefreshCw,
  Search,
  Settings,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import Image from "next/image";
import { signIn, signOut, useSession } from "next-auth/react";
import type { ChangeEvent, CSSProperties, Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { canUseOperations, normalizeAppRole, type AppUserRole } from "@/lib/auth/roles";
import { catalogueValueMinorForVariant, catalogueVariantLabels } from "@/lib/catalogue/variants";
import {
  buildCollectionCsv,
  buildCollectionImportTemplateCsv,
  parseCollectionImportCsv,
  type CollectionImportRow,
} from "@/lib/csv";
import { completionPercent, formatMoney } from "@/lib/format";
import {
  catalogueGapRecommendations,
  type CatalogueGapRecommendation,
} from "@/lib/jobs/catalogue-gap-report";
import type {
  DuplicateProviderReview,
  DuplicateProviderReviewCard,
  DuplicateProviderReviewGroup,
} from "@/lib/catalogue/duplicate-provider-review";
import { priceRangeMinor } from "@/lib/pricing/price-history";
import { buildInsuranceReportHtml } from "@/lib/reports/insurance";
import {
  buildCollectionIntelligence,
  type CollectionIntelligence,
  type HoldingInsight,
  type InsightAction,
  type WishlistOpportunity,
} from "@/lib/insights";
import { sampleAppData } from "@/lib/sample-data";
import type {
  AppData,
  AppDataSource,
  AppSubscription,
  CatalogueItem,
  CollectionEvent,
  CollectionItem,
  ItemType,
  NotificationPreferences,
  Screen,
  SetProgress,
  StorageLocation,
  WishlistItem,
} from "@/lib/types";

type AppState = {
  screen: Screen;
  addType: ItemType;
  collectionFilter: "all" | ItemType | "graded" | "unknown";
  collectionSetFilter: string;
  collectionConditionFilter: string;
  collectionLanguageFilter: string;
  collectionLocationFilter: string;
  collectionValueFilter: "all" | "profit" | "loss" | "unvalued" | "manual" | "weak" | "high";
  collectionSort: "value-desc" | "value-asc" | "name" | "set" | "gain-desc" | "quantity-desc" | "recent";
  collectionView: "list" | "grid";
  setFilter: "all" | "owned" | "missing" | "want";
  selectedItemId: string;
  selectedSetId: string;
  selectedCatalogueId: string;
  plus: boolean;
};

type Viewer = {
  name: string;
  email: string;
  role: AppUserRole;
};

type AuthMode = "sign-in" | "register";
type CatalogueSort = "set-number" | "value-desc" | "name" | "rarity";
type SetDetailSort = "number" | "value-desc" | "name" | "rarity";
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
type JobType = "price_alerts" | "catalogue_refresh" | "pricing_refresh" | "sealed_pricing_refresh";
type OperationsJobKind =
  | "alerts"
  | "card-image-repair"
  | "catalogue"
  | "pricing"
  | "sealed"
  | "sealed-image-repair"
  | "variant-metadata-repair";
type JobStatus = "running" | "succeeded" | "failed";
type ImportPreset = {
  expectedTotal: number;
  label: string;
  note: string;
  query: string;
  setNames: string[];
};

type JobRunRecord = {
  id: string;
  jobType: JobType;
  status: JobStatus;
  requestPayload: unknown;
  resultPayload: unknown;
  errorMessage?: string;
  startedAt: string;
  finishedAt?: string;
  durationMs?: number;
};

type JobApiResult = {
  cardsFetched?: number;
  cardsUpdated?: number;
  candidatesChecked?: number;
  cardsUpserted?: number;
  canMerge?: boolean;
  collectionItemsMoved?: number;
  collectionItemsToMove?: number;
  complete?: boolean;
  duplicateCardDeleted?: boolean;
  dryRun?: boolean;
  duplicateCardCount?: number;
  duplicateCardId?: string;
  duplicateGroupCount?: number;
  duplicateCardWillBeDeleted?: boolean;
  error?: string;
  errors?: string[];
  groupsAvailable?: number;
  groupsMatched?: number;
  groupsProcessed?: number;
  groupsFetched?: number;
  imageFieldsUpdated?: number;
  job?: string;
  jobRun?: JobRunRecord;
  maxPages?: number;
  nextPage?: number | null;
  page?: number;
  pageSize?: number;
  priceOnlyUnpriced?: boolean;
  priceSnapshotsMoved?: number;
  priceSnapshotsToMove?: number;
  primaryCardId?: string;
  highRiskGroupCount?: number;
  lowRiskGroupCount?: number;
  pagesProcessed?: number;
  pricingSnapshotsCreated?: number;
  productsFetched?: number;
  query?: string;
  mediumRiskGroupCount?: number;
  mode?: string;
  report?: string;
  repairableCards?: number;
  repairableProducts?: number;
  sealedProductsSkipped?: number;
  sealedProductsUpdated?: number;
  sealedProductsUpserted?: number;
  setsUpserted?: number;
  tcgcsvProductsFetched?: number;
  totalCount?: number;
  pokemonTcgCardsFetched?: number;
  wishlistConflictsMerged?: number;
  wishlistConflictsToMerge?: number;
  wishlistItemsMoved?: number;
  wishlistItemsToMove?: number;
  writePrices?: boolean;
};

type PricingBySeriesGap = {
  cardCount: number;
  pricedCardCount: number;
  pricingCoveragePercent: number | null;
  series: string;
  unpricedCardCount: number;
};

type PricingBySourceSummary = {
  itemType: string;
  pricedItemCount: number;
  priceSnapshotCount: number;
  source: string;
};

type SealedPricingByProductTypeGap = {
  pricedSealedProductCount: number;
  productType: string;
  sealedPriceSnapshotCount: number;
  sealedPricingCoveragePercent: number | null;
  sealedProductCount: number;
  unpricedSealedProductCount: number;
};

type CatalogueStatusRecord = {
  cardCount: number;
  cardImageCount: number;
  cardImageCoveragePercent: number | null;
  cardMissingImageCount: number;
  cardMissingVariantMetadataCount: number;
  cardVariantMetadataCount: number;
  cardVariantMetadataCoveragePercent: number | null;
  coveragePercent: number | null;
  duplicateProviderIdCount: number;
  latestCatalogueResult: JobApiResult | null;
  latestPricingResult: JobApiResult | null;
  latestSealedPricingResult: JobApiResult | null;
  nextCataloguePage: number | null;
  priceSnapshotCount: number;
  pricedCardCount: number;
  pricedSealedProductCount: number;
  pricingBySeries: PricingBySeriesGap[];
  pricingBySource: PricingBySourceSummary[];
  pricingCoveragePercent: number | null;
  providerTotalCount: number | null;
  sealedPricingByProductType: SealedPricingByProductTypeGap[];
  sealedPriceSnapshotCount: number;
  sealedImageCount: number;
  sealedImageCoveragePercent: number | null;
  sealedMissingImageCount: number;
  sealedPricingCoveragePercent: number | null;
  sealedProductCount: number;
  setCount: number;
};

type CatalogueStatusApiResult = {
  error?: string;
  latestCatalogueRun?: JobRunRecord | null;
  latestPricingRun?: JobRunRecord | null;
  latestSealedPricingRun?: JobRunRecord | null;
  status?: CatalogueStatusRecord;
};

type ResumeJob = {
  kind: "catalogue" | "pricing";
  nextPage: number;
  pageSize: number;
  query?: string;
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
  setFilter: "all",
  selectedItemId: "owned-charizard",
  selectedSetId: "set-151",
  selectedCatalogueId: "card-charizard-151",
  plus: false,
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
const freePlanFeatures = [
  "Track cards and sealed products",
  "Add manual sealed products and values",
  "Dashboard value, gain/loss, and recent history",
  "Collection search, filters, and storage locations",
  "Basic collection review signals",
  "Wishlist and set progress",
  "CSV import, CSV export, and item-level price context",
];
const plusPlanFeatures = [
  "Full portfolio analytics and value movement",
  "Price alert emails and wishlist target digests",
  "Insurance report export",
  "Deeper weak-price, duplicate, and grading review insights",
  "Richer price-confidence and collection health insights",
  "Priority access to future advanced reporting tools",
];
const themeStorageKey = "mintbinder-theme";
const themeOptions: ThemeOption[] = [
  {
    access: "free",
    description: "Clean daylight tracking for everyday use.",
    id: "light",
    name: "Light",
    swatches: ["#ffffff", "#dc2626", "#0f766e"],
  },
  {
    access: "free",
    description: "Low-glare tracking for late sorting sessions.",
    id: "dark",
    name: "Dark",
    swatches: ["#111827", "#f43f5e", "#22d3ee"],
  },
  {
    access: "plus",
    description: "Bright red, teal, and gold for a classic collector feel.",
    id: "league",
    name: "League",
    swatches: ["#fff7ed", "#dc2626", "#f59e0b"],
  },
  {
    access: "plus",
    description: "Deep green and soft mint for binder-building calm.",
    id: "forest",
    name: "Forest Badge",
    swatches: ["#f0fdf4", "#047857", "#84cc16"],
  },
  {
    access: "plus",
    description: "Cool blue with aqua accents for sealed-product shelves.",
    id: "ocean",
    name: "Ocean Gym",
    swatches: ["#eff6ff", "#2563eb", "#06b6d4"],
  },
  {
    access: "plus",
    description: "Warm red and amber for chase-card energy.",
    id: "ember",
    name: "Ember",
    swatches: ["#fff7ed", "#ea580c", "#dc2626"],
  },
  {
    access: "plus",
    description: "Punchy yellow and blue for high-contrast scans.",
    id: "electric",
    name: "Electric Pop",
    swatches: ["#fefce8", "#ca8a04", "#2563eb"],
  },
  {
    access: "plus",
    description: "Violet, pink, and blue for a vivid analytics mood.",
    id: "psychic",
    name: "Psychic Neon",
    swatches: ["#faf5ff", "#7c3aed", "#db2777"],
  },
  {
    access: "plus",
    description: "Soft rose and sky accents without losing readability.",
    id: "fairy",
    name: "Fairy Pastel",
    swatches: ["#fff1f2", "#e11d48", "#38bdf8"],
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
    name: "Steel Case",
    swatches: ["#f8fafc", "#475569", "#14b8a6"],
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
    name: "Meadow",
    swatches: ["#f7fee7", "#16a34a", "#0ea5e9"],
  },
  {
    access: "plus",
    description: "Orange, pink, and blue for a warmer showcase look.",
    id: "sunset",
    name: "Sunset League",
    swatches: ["#fff7ed", "#f97316", "#2563eb"],
  },
];
const freeThemeIds = new Set<ThemeId>(["light", "dark"]);

const importPresets: ImportPreset[] = [
  {
    expectedTotal: 207,
    label: "151",
    note: "Scarlet & Violet special set",
    query: "set.id:sv3pt5",
    setNames: ["151"],
  },
  {
    expectedTotal: 237,
    label: "Evolving Skies",
    note: "Sword & Shield chase set",
    query: "set.id:swsh7",
    setNames: ["Evolving Skies"],
  },
  {
    expectedTotal: 160,
    label: "Crown Zenith",
    note: "Main Crown Zenith set",
    query: "set.id:swsh12pt5",
    setNames: ["Crown Zenith"],
  },
  {
    expectedTotal: 70,
    label: "Crown Zenith GG",
    note: "Galarian Gallery subset",
    query: "set.id:swsh12pt5gg",
    setNames: ["Crown Zenith Galarian Gallery"],
  },
];

export default function Home() {
  const { data: session, status } = useSession();
  const [appState, setAppState] = useState(initialState);
  const [catalogueItems, setCatalogueItems] = useState<CatalogueItem[]>(sampleAppData.catalogue);
  const [collection, setCollection] = useState<CollectionItem[]>(sampleAppData.collection);
  const [wishlist, setWishlist] = useState<WishlistItem[]>(sampleAppData.wishlist);
  const [sets, setSets] = useState<SetProgress[]>(sampleAppData.sets);
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>(sampleAppData.storageLocations);
  const [collectionEvents, setCollectionEvents] = useState<CollectionEvent[]>(sampleAppData.events);
  const [notificationPreferences, setNotificationPreferences] = useState<NotificationPreferences>(sampleAppData.notificationPreferences);
  const [subscription, setSubscription] = useState<AppSubscription>(sampleAppData.subscription);
  const [dataSource, setDataSource] = useState<AppDataSource>(sampleAppData.source);
  const [dataNotice, setDataNotice] = useState(sampleAppData.notice ?? "");
  const [themeId, setThemeId] = useState<ThemeId>("light");
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [toast, setToast] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("sign-in");
  const [signInEmail, setSignInEmail] = useState("liam@example.com");
  const [signInName, setSignInName] = useState("Liam");
  const [signInPassword, setSignInPassword] = useState("MintBinder2026!");
  const [signInError, setSignInError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [collectionSearch, setCollectionSearch] = useState("");
  const [addSearch, setAddSearch] = useState("");
  const [setSearch, setSetSearch] = useState("");

  const showToast = useCallback((message: string) => {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
  }, []);

  const catalogueById = useMemo(() => {
    return new Map(catalogueItems.map((item) => [item.id, item]));
  }, [catalogueItems]);

  const viewer: Viewer = {
    name: session?.user?.name || "Collector",
    email: session?.user?.email || "",
    role: normalizeAppRole(session?.user?.role),
  };
  const operationsEnabled = canUseOperations(viewer.role);

  useEffect(() => {
    const storedTheme = window.localStorage.getItem(themeStorageKey);

    if (isThemeId(storedTheme)) {
      setThemeId(storedTheme);
    }
  }, []);

  useEffect(() => {
    if (!isThemeAllowed(themeId, appState.plus)) {
      setThemeId("light");
      return;
    }

    document.documentElement.dataset.theme = themeId;
    window.localStorage.setItem(themeStorageKey, themeId);
  }, [appState.plus, themeId]);

  const applyAppData = useCallback((data: AppData) => {
    setCatalogueItems(data.catalogue);
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
        : data.collection[0]?.id ?? current.selectedItemId,
      selectedCatalogueId: data.catalogue.some((item) => item.id === current.selectedCatalogueId)
        ? current.selectedCatalogueId
        : data.catalogue.find((item) => item.type === current.addType)?.id ??
          data.catalogue[0]?.id ??
          current.selectedCatalogueId,
      selectedSetId: data.sets.some((set) => set.id === current.selectedSetId)
        ? current.selectedSetId
        : data.sets[0]?.id ?? current.selectedSetId,
    }));
  }, []);

  const refreshAppData = useCallback(
    async (options?: { quiet?: boolean; isCancelled?: () => boolean }) => {
      if (!options?.quiet && !options?.isCancelled?.()) {
        setIsLoadingData(true);
      }

      try {
        const response = await fetch("/api/app-data", { cache: "no-store" });

        if (!response.ok) {
          throw new Error(`App data request failed with ${response.status}`);
        }

        const data = (await response.json()) as AppData;

        if (options?.isCancelled?.()) {
          return false;
        }

        applyAppData(data);
        return true;
      } catch (error) {
        console.warn("Using sample app data after API load failed.", error);
        if (!options?.isCancelled?.()) {
          applyAppData({
            ...sampleAppData,
            notice: "Using sample data because the app data API could not be reached.",
          });
        }
        return false;
      } finally {
        if (!options?.quiet && !options?.isCancelled?.()) {
          setIsLoadingData(false);
        }
      }
    },
    [applyAppData],
  );

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
      showToast("Checkout cancelled.");
    } else if (billing === "portal") {
      showToast("Billing portal closed.");
      void refreshAppData({ quiet: true });
    }

    params.delete("billing");
    params.delete("session_id");
    const nextQuery = params.toString();
    window.history.replaceState(null, "", `${window.location.pathname}${nextQuery ? `?${nextQuery}` : ""}`);
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
      return total + (item.targetPriceMinor ?? (catalogueItem ? catalogueMarketValueMinor(catalogueItem) ?? 0 : 0));
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

  function navigate(screen: Screen) {
    setAppState((current) => ({ ...current, screen }));
  }

  function startAdd(type: ItemType) {
    const firstItem = catalogueItems.find((item) => item.type === type);
    setAppState((current) => ({
      ...current,
      screen: "add",
      addType: type,
      selectedCatalogueId: firstItem?.id ?? current.selectedCatalogueId,
    }));
    setAddSearch("");
  }

  async function addToCollection(catalogueId: string, formData?: FormData) {
    const catalogueItem = catalogueById.get(catalogueId);
    if (!catalogueItem) {
      return;
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
        (catalogueItem.type === "sealed" ? "Factory sealed" : "Standard"),
      paid: String(formData?.get("paid") ?? ""),
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
        const matchingWishlist = wishlist.find((item) => item.catalogueId === catalogueId);

        if (matchingWishlist) {
          void removeWishlistItem(matchingWishlist.id, { quiet: true });
        }

        setCollection((items) => [...items, result.item]);
        setWishlist((items) => items.filter((item) => item.catalogueId !== catalogueId));
        setAppState((current) => ({
          ...current,
          screen: "item",
          selectedItemId: result.item.id,
        }));
        void refreshAppData({ quiet: true });
        showToast(`${catalogueItem.name} added to collection.`);
        return;
      } catch (error) {
        console.warn("Falling back to local collection update.", error);
        showToast("Database save failed, so this change is local for now.");
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
      purchaseDate: new Date().toISOString().slice(0, 10),
      overrideValueMinor: moneyInputToMinor(payload.overrideValue),
      valuationNote: payload.valuationNote || undefined,
      location: payload.location,
      notes: payload.notes,
    };

    setCollection((items) => [...items, nextItem]);
    setWishlist((items) => items.filter((item) => item.catalogueId !== catalogueId));
    setAppState((current) => ({ ...current, screen: "item", selectedItemId: nextItem.id }));
    showToast(`${catalogueItem.name} added to collection.`);
  }

  async function createManualSealedProduct(formData: FormData) {
    const name = String(formData.get("name") ?? "").trim();
    const productType = String(formData.get("productType") ?? "Other");
    const relatedSetId = String(formData.get("relatedSetId") ?? "none");
    const estimatedValue = String(formData.get("estimatedValue") ?? "");
    const notes = String(formData.get("notes") ?? "").trim();

    if (!name) {
      showToast("Sealed product name is required.");
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
        }));
        setAddSearch(result.item.name);
        void refreshAppData({ quiet: true });
        showToast(`${result.item.name} created.`);
        return true;
      } catch (error) {
        console.warn("Unable to create sealed product.", error);
        showToast("Sealed product could not be created.");
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
    }));
    setAddSearch(nextItem.name);
    showToast(`${nextItem.name} created.`);
    return true;
  }

  async function addToWishlist(catalogueId: string) {
    const catalogueItem = catalogueById.get(catalogueId);
    if (!catalogueItem || wishlist.some((item) => item.catalogueId === catalogueId)) {
      showToast("That item is already on the wishlist.");
      return;
    }

    if (dataSource === "database") {
      try {
        const response = await fetch("/api/wishlist-items", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ catalogueId }),
        });

        if (!response.ok) {
          throw new Error(`Create wishlist item failed with ${response.status}`);
        }

        const result = (await response.json()) as { item: WishlistItem };

        setWishlist((items) => [...items, result.item]);
        showToast(`${catalogueItem.name} added to wishlist.`);
        return;
      } catch (error) {
        console.warn("Falling back to local wishlist update.", error);
        showToast("Database save failed, so this wishlist change is local for now.");
      }
    }

    const marketValueMinor = catalogueMarketValueMinor(catalogueItem);

    setWishlist((items) => [
      ...items,
      {
        id: `want-${Date.now()}`,
        catalogueId,
        priority: marketValueMinor !== null && marketValueMinor > 10000 ? "Grail" : "High",
        targetPriceMinor: marketValueMinor ?? undefined,
        notes: "Added from set progress.",
      },
    ]);
    showToast(`${catalogueItem.name} added to wishlist.`);
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
        showToast(`${catalogueItem?.name ?? "Item"} duplicated.`);
        return;
      } catch (error) {
        console.warn("Falling back to local duplicate.", error);
        showToast("Database duplicate failed, so this duplicate is local for now.");
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
        showToast(`${catalogueItem.name} updated.`);
        return true;
      } catch (error) {
        console.warn("Falling back to local collection update.", error);
        showToast("Database update failed, so this change is local for now.");
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
      purchaseDate: paidValue !== undefined && Number.isFinite(paidValue)
        ? new Date().toISOString().slice(0, 10)
        : undefined,
      grade: gradeLabelFromForm(payload.gradeCompany, payload.gradeScore, catalogueItem.type),
      overrideValueMinor: moneyInputToMinor(payload.overrideValue),
      valuationNote: payload.valuationNote || undefined,
      location: payload.location,
      notes: payload.notes || undefined,
    };

    setCollection((items) => items.map((item) => (item.id === itemId ? updated : item)));
    showToast(`${catalogueItem.name} updated.`);
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
        console.warn("Falling back to local collection removal.", error);
        showToast("Database remove failed, so this change is local for now.");
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

    showToast(`${catalogueItem?.name ?? "Item"} removed from collection.`);
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
    const saleAmountMinor = moneyInputToMinor(amount);
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
          }),
        });

        if (!response.ok) {
          throw new Error(`Record sale failed with ${response.status}`);
        }

        recordedInDatabase = true;
      } catch (error) {
        console.warn("Falling back to local sale recording.", error);
        showToast("Database sale save failed, so this sale is local for now.");
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
    setCollectionEvents((events) => [
      {
        id: `event-sale-${Date.now()}`,
        type: "Sold",
        itemId: source.id,
        catalogueId: source.catalogueId,
        itemName: catalogueItem?.name ?? "Collection item",
        quantity: source.quantity,
        amountMinor: saleAmountMinor,
        basisMinor: source.purchasePriceMinor,
        currency: saleAmountMinor === undefined ? undefined : "GBP",
        occurredAt: soldDate,
        notes: notes || undefined,
      },
      ...events,
    ]);

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

    if (recordedInDatabase) {
      void refreshAppData({ quiet: true });
    }

    showToast(`${catalogueItem?.name ?? "Item"} sale recorded.`);
    return true;
  }

  function resetSampleData() {
    setCatalogueItems(sampleAppData.catalogue);
    setCollection(sampleAppData.collection);
    setWishlist(sampleAppData.wishlist);
    setSets(sampleAppData.sets);
    setStorageLocations(sampleAppData.storageLocations);
    setCollectionEvents(sampleAppData.events);
    setNotificationPreferences(sampleAppData.notificationPreferences);
    setDataSource(sampleAppData.source);
    setDataNotice(sampleAppData.notice ?? "");
    setAppState(initialState);
    showToast("Sample data reset.");
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
        console.warn("Falling back to local wishlist deletion.", error);
        if (!options?.quiet) {
          showToast("Database delete failed, so this change is local for now.");
        }
      }
    }

    setWishlist((items) => items.filter((item) => item.id !== id));

    if (!options?.quiet) {
      showToast("Wishlist item removed.");
    }
  }

  async function updateWishlistItem(id: string, formData: FormData) {
    const source = wishlist.find((item) => item.id === id);

    if (!source) {
      return false;
    }

    const payload = {
      id,
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
        console.warn("Falling back to local wishlist update.", error);
        showToast("Database save failed, so this wishlist target is local for now.");
      }
    }

    setWishlist((items) =>
      items.map((item) =>
        item.id === id
          ? {
              ...item,
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
      showToast("Storage location needs a name.");
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
        console.warn("Falling back to local storage location update.", error);
        showToast("Database save failed, so this storage location is local for now.");
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
        console.warn("Falling back to local storage location deletion.", error);
        showToast("Database delete failed, so this storage change is local for now.");
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
    if (!appState.plus) {
      showToast("Insurance reports are a Plus feature.");
      setAppState((current) => ({ ...current, screen: "analytics" }));
      return;
    }

    if (dataSource === "database") {
      try {
        const response = await fetch("/api/reports/insurance", { cache: "no-store" });

        if (!response.ok) {
          const body = (await response.json().catch(() => ({}))) as { error?: string };
          throw new Error(body.error ?? `Insurance report failed with ${response.status}`);
        }

        downloadBlob(`mintbinder-insurance-report-${dateStamp()}.html`, await response.blob());
        showToast("Insurance report exported.");
        return;
      } catch (error) {
        console.warn("Insurance report export failed.", error);
        showToast(error instanceof Error ? error.message : "Could not export insurance report.");
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
          plan: appState.plus ? "plus" : "free",
          entitlements: {
            "billing.portal": appState.plus,
            "exports.insurance_report": appState.plus,
            "pricing.alerts": appState.plus,
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
      showToast(error instanceof Error ? error.message : "Unable to start checkout.");
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
      showToast(error instanceof Error ? error.message : "Unable to open billing portal.");
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
      showToast(error instanceof Error ? error.message : "Unable to cancel Plus renewal.");
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
        showToast(error instanceof Error ? error.message : "Unable to update notification preferences.");
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

  async function importCollectionCsv(file: File) {
    try {
      const rows = parseCollectionImportCsv(await file.text());
      const importableRows = rows.filter((row) => catalogueById.has(row.catalogueId));
      const skipped = rows.length - importableRows.length;

      if (!rows.length) {
        showToast("No import rows found in that CSV.");
        return false;
      }

      if (!importableRows.length) {
        showToast("No rows matched the current catalogue.");
        return false;
      }

      if (dataSource === "database") {
        const importedItems: CollectionItem[] = [];

        for (const row of importableRows) {
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
        }

        setCollection((items) => [...items, ...importedItems]);
        void refreshAppData({ quiet: true });
      } else {
        const importedAt = Date.now();
        const importedItems = importableRows.map((row, index) => {
          const catalogueItem = catalogueById.get(row.catalogueId);
          const paidValue = moneyInputToMinor(row.paid);
          const overrideValue = moneyInputToMinor(row.overrideValue);

          return {
            id: `owned-import-${importedAt}-${index}-${row.catalogueId}`,
            catalogueId: row.catalogueId,
            quantity: row.quantity,
            condition: row.condition,
            language: row.language,
            variant: row.variant,
            grade: catalogueItem?.type === "sealed" ? "N/A" : "Raw",
            purchasePriceMinor: paidValue,
            purchaseDate: paidValue === undefined ? undefined : new Date().toISOString().slice(0, 10),
            overrideValueMinor: overrideValue,
            valuationNote: row.valuationNote || undefined,
            location: row.location,
            notes: row.notes || undefined,
          };
        });

        setCollection((items) => [...items, ...importedItems]);
      }

      showToast(`${importableRows.length} rows imported${skipped ? `, ${skipped} skipped` : ""}.`);
      return true;
    } catch (error) {
      console.warn("Collection CSV import failed.", error);
      showToast("Could not import that CSV.");
      return false;
    }
  }

  async function handleSignIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSigningIn(true);
    setSignInError("");

    const result = await signIn("credentials", {
      email: signInEmail,
      password: signInPassword,
      mode: authMode,
      name: signInName,
      redirect: false,
    });

    setIsSigningIn(false);

    if (result?.error) {
      setSignInError(
        authMode === "register"
          ? "Could not create that account."
          : "Could not sign in with those details.",
      );
    }
  }

  if (status === "loading") {
    return <AuthStatusScreen />;
  }

  if (status === "unauthenticated") {
    return (
      <SignInScreen
        authMode={authMode}
        email={signInEmail}
        error={signInError}
        isSubmitting={isSigningIn}
        name={signInName}
        password={signInPassword}
        onAuthModeChange={(mode) => {
          setAuthMode(mode);
          setSignInError("");
        }}
        onEmailChange={setSignInEmail}
        onNameChange={setSignInName}
        onPasswordChange={setSignInPassword}
        onSubmit={handleSignIn}
      />
    );
  }

  const context = {
    appState,
    viewer,
    catalogueItems,
    catalogueById,
    collection,
    storageLocations,
    collectionEvents,
    notificationPreferences,
    subscription,
    sets,
    dataSource,
    dataNotice,
    isLoadingData,
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
    createManualSealedProduct,
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
    importCollectionCsv,
    setThemeId,
    setAppState,
    showToast,
    resetSampleData,
    refreshAppData,
    themeId,
  };

  return (
    <div className="app-shell">
      <Header
        alertCount={intelligence.actionQueue.length}
        plus={appState.plus}
        userEmail={viewer.email}
        userName={viewer.name}
        onNavigate={navigate}
        onSignOut={() => void signOut({ redirect: false })}
      />
      <div className="app-body">
        <Sidebar
          active={appState.screen}
          alertCount={intelligence.actionQueue.length}
          canUseOperations={operationsEnabled}
          onNavigate={navigate}
        />
        <main className="main">
          {renderScreen(context)}
          <LegalFooter />
        </main>
      </div>
      <BottomNav active={appState.screen} canUseOperations={operationsEnabled} onNavigate={navigate} />
      {toast ? <div className="toast">{toast}</div> : null}
    </div>
  );
}

type ScreenContext = {
  appState: AppState;
  viewer: Viewer;
  catalogueItems: CatalogueItem[];
  catalogueById: Map<string, CatalogueItem>;
  collection: CollectionItem[];
  storageLocations: StorageLocation[];
  collectionEvents: CollectionEvent[];
  notificationPreferences: NotificationPreferences;
  subscription: AppSubscription;
  sets: SetProgress[];
  dataSource: AppDataSource;
  dataNotice: string;
  isLoadingData: boolean;
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
  addToCollection: (catalogueId: string, formData?: FormData) => Promise<void>;
  createManualSealedProduct: (formData: FormData) => Promise<boolean>;
  updateCollectionItem: (itemId: string, formData: FormData) => Promise<boolean>;
  archiveCollectionItem: (itemId: string) => Promise<boolean>;
  recordCollectionSale: (itemId: string, formData: FormData) => Promise<boolean>;
  addToWishlist: (catalogueId: string) => Promise<void>;
  duplicateItem: (itemId: string) => Promise<void>;
  removeWishlistItem: (id: string, options?: { quiet?: boolean }) => Promise<void>;
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
  importCollectionCsv: (file: File) => Promise<boolean>;
  setThemeId: Dispatch<SetStateAction<ThemeId>>;
  setAppState: Dispatch<SetStateAction<AppState>>;
  showToast: (message: string) => void;
  resetSampleData: () => void;
  refreshAppData: (options?: { quiet?: boolean }) => Promise<boolean>;
  themeId: ThemeId;
};

function renderScreen(context: ScreenContext) {
  switch (context.appState.screen) {
    case "collection":
      return <CollectionScreen {...context} />;
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
      return canUseOperations(context.viewer.role) ? <OperationsScreen {...context} /> : <OperationsLockedScreen />;
    case "settings":
      return <SettingsScreen {...context} />;
    case "dashboard":
    default:
      return <DashboardScreen {...context} />;
  }
}

function AuthStatusScreen() {
  return (
    <main className="auth-shell">
      <section className="auth-card">
        <AuthBrand />
        <h1>Checking session</h1>
        <p className="muted">Preparing your collection workspace.</p>
      </section>
    </main>
  );
}

function SignInScreen({
  authMode,
  email,
  error,
  isSubmitting,
  name,
  password,
  onAuthModeChange,
  onEmailChange,
  onNameChange,
  onPasswordChange,
  onSubmit,
}: {
  authMode: AuthMode;
  email: string;
  error: string;
  isSubmitting: boolean;
  name: string;
  password: string;
  onAuthModeChange: (value: AuthMode) => void;
  onEmailChange: (value: string) => void;
  onNameChange: (value: string) => void;
  onPasswordChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}) {
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
              className={authMode === "sign-in" ? "active" : ""}
              type="button"
              onClick={() => onAuthModeChange("sign-in")}
            >
              Sign in
            </button>
            <button
              className={authMode === "register" ? "active" : ""}
              type="button"
              onClick={() => onAuthModeChange("register")}
            >
              Create account
            </button>
          </div>
          <Field label="Email">
            <input
              type="email"
              value={email}
              onChange={(event) => onEmailChange(event.target.value)}
              required
            />
          </Field>
          <Field label="Password">
            <input
              type="password"
              value={password}
              onChange={(event) => onPasswordChange(event.target.value)}
              minLength={8}
              required
            />
          </Field>
          {authMode === "register" ? (
            <Field label="Display name">
              <input
                value={name}
                onChange={(event) => onNameChange(event.target.value)}
                required
              />
            </Field>
          ) : null}
          {error ? <p className="auth-error">{error}</p> : null}
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
      <span>Independent collector app.</span>
      <a href="/legal/privacy">Privacy</a>
      <a href="/legal/terms">Terms</a>
      <a href="/legal/non-affiliation">Non-affiliation</a>
    </footer>
  );
}

function Header({
  alertCount,
  plus,
  userEmail,
  userName,
  onNavigate,
  onSignOut,
}: {
  alertCount: number;
  plus: boolean;
  userEmail: string;
  userName: string;
  onNavigate: (screen: Screen) => void;
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
        <button className="plan-pill" onClick={() => onNavigate(plus ? "analytics" : "settings")}>
          {plus ? <Sparkles size={17} /> : <Lock size={17} />}
          {plus ? "Plus" : "Upgrade"}
        </button>
        <button
          className="status-pill alert-pill"
          onClick={() => onNavigate("alerts")}
          aria-label={`${alertCount} alerts`}
          title={`${alertCount} alerts`}
        >
          <Bell size={17} />
          {alertCount}
        </button>
        <button className="user-pill" onClick={() => onNavigate("settings")} title={userEmail}>
          <UserRound size={17} />
          {userName}
        </button>
        <button className="button small" onClick={onSignOut}>
          <LogOut size={17} />
          Sign out
        </button>
      </div>
    </header>
  );
}

function Sidebar({
  active,
  alertCount,
  canUseOperations,
  onNavigate,
}: {
  active: Screen;
  alertCount: number;
  canUseOperations: boolean;
  onNavigate: (screen: Screen) => void;
}) {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <NavButton active={active === "dashboard"} icon={<LayoutDashboard />} label="Dashboard" onClick={() => onNavigate("dashboard")} />
      <NavButton active={active === "collection"} icon={<Layers3 />} label="Collection" onClick={() => onNavigate("collection")} />
      <NavButton active={active === "add"} icon={<Plus />} label="Add item" onClick={() => onNavigate("add")} />
      <NavButton active={active === "sets" || active === "setDetail"} icon={<GalleryVerticalEnd />} label="Sets" onClick={() => onNavigate("sets")} />
      <NavButton active={active === "wishlist"} icon={<Heart />} label="Wishlist" onClick={() => onNavigate("wishlist")} />
      <NavButton active={active === "alerts"} icon={<Bell />} label={`Alerts (${alertCount})`} onClick={() => onNavigate("alerts")} />
      <NavButton active={active === "analytics"} icon={<BarChart3 />} label="Analytics" onClick={() => onNavigate("analytics")} />
      {canUseOperations ? (
        <NavButton active={active === "ops"} icon={<TerminalSquare />} label="Operations" onClick={() => onNavigate("ops")} />
      ) : null}
      <span className="nav-divider" />
      <NavButton active={active === "settings"} icon={<Settings />} label="Settings" onClick={() => onNavigate("settings")} />
    </aside>
  );
}

function BottomNav({
  active,
  canUseOperations,
  onNavigate,
}: {
  active: Screen;
  canUseOperations: boolean;
  onNavigate: (screen: Screen) => void;
}) {
  return (
    <nav className={canUseOperations ? "bottom-nav admin" : "bottom-nav"} aria-label="Primary navigation">
      <MobileNavButton active={active === "dashboard"} icon={<LayoutDashboard />} label="Home" onClick={() => onNavigate("dashboard")} />
      <MobileNavButton active={active === "collection"} icon={<Layers3 />} label="Cards" onClick={() => onNavigate("collection")} />
      <button className={active === "add" ? "active add-button" : "add-button"} onClick={() => onNavigate("add")}>
        <span className="icon-wrap">
          <Plus size={20} />
        </span>
        <span>Add</span>
      </button>
      <MobileNavButton active={active === "sets" || active === "setDetail"} icon={<GalleryVerticalEnd />} label="Sets" onClick={() => onNavigate("sets")} />
      <MobileNavButton active={active === "wishlist"} icon={<Heart />} label="Want" onClick={() => onNavigate("wishlist")} />
      {canUseOperations ? (
        <MobileNavButton active={active === "ops"} icon={<TerminalSquare />} label="Ops" onClick={() => onNavigate("ops")} />
      ) : null}
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
    <button className={active ? "nav-button active" : "nav-button"} onClick={onClick}>
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
    <button className={active ? "active" : ""} onClick={onClick}>
      {icon}
      <span>{label}</span>
    </button>
  );
}

function DashboardScreen({
  collection,
  collectionEvents,
  catalogueById,
  sets,
  dataSource,
  dataNotice,
  isLoadingData,
  navigate,
  startAdd,
  summary,
  intelligence,
  wishlist,
  wishlistTotal,
  setAppState,
}: ScreenContext) {
  const recent = collection.slice(-3).reverse();
  const focusSets = sets
    .filter((set) => set.owned > 0)
    .sort((left, right) => completionPercent(right.owned, right.total) - completionPercent(left.owned, left.total))
    .slice(0, 4);
  const dashboardSets = focusSets.length ? focusSets : sets.slice(0, 4);
  const gain = summary.value - summary.cost;

  return (
    <section className="page">
      <PageHeader
        title="Dashboard"
        action={
          <button className="button primary" onClick={() => startAdd("card")}>
            <Plus size={17} />
            Add item
          </button>
        }
      />

      <div className="stats-grid">
        <StatCard label="Collection value" value={formatMoney(summary.value)} note={`${summary.unvalued} unvalued items`} />
        <StatCard label="Gain/loss" value={formatMoney(gain)} note={`${formatMoney(summary.cost)} cost basis`} positive={gain >= 0} />
        <StatCard label="Items tracked" value={summary.items.toString()} note={`${summary.cards} cards | ${summary.sealed} sealed`} />
        <StatCard label="Wishlist" value={wishlist.length.toString()} note={`${formatMoney(wishlistTotal)} target total`} />
      </div>

      {!collection.length ? (
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

      <div className="dashboard-grid">
        <section className="section-block">
          <SectionHeader title="Recent additions" />
          <div className="item-list">
            {recent.length ? recent.map((item) => (
              <OwnedItemCard
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

        <div className="side-stack">
          <section className="tool-panel">
            <div className="panel-title-row">
              <h2>Quick actions</h2>
              <span className={dataSource === "database" ? "status-pill" : "tag amber"}>
                {isLoadingData ? "Loading" : dataSource === "database" ? "Database" : "Sample"}
              </span>
            </div>
            <div className="actions">
              <button className="button primary" onClick={() => startAdd("card")}>
                <Plus size={17} />
                Add card
              </button>
              <button className="button" onClick={() => startAdd("sealed")}>
                <PackagePlus size={17} />
                Add sealed
              </button>
              <button className="button" onClick={() => navigate("wishlist")}>
                <Heart size={17} />
                Wishlist
              </button>
              <button className="button" onClick={() => navigate("alerts")}>
                <Bell size={17} />
                Alerts
              </button>
            </div>
            {dataNotice ? <p className="muted">{dataNotice}</p> : null}
          </section>

          <section className="tool-panel">
            <div className="panel-title-row">
              <h2>Recent history</h2>
              <History size={18} />
            </div>
            <EventList events={collectionEvents.slice(0, 4)} />
          </section>

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
              <h2>Collector pulse</h2>
              <span className="status-pill">{intelligence.healthLabel}</span>
            </div>
            <MiniChart values={intelligence.valueTrend} />
            <MetricList
              rows={[
                ["Health score", `${intelligence.healthScore}/100`],
                ["Best performer", intelligence.bestPerformer ? gainLabel(intelligence.bestPerformer) : "Not enough cost data"],
                ["Storage focus", intelligence.storageConcentration ? `${intelligence.storageConcentration.name} (${intelligence.storageConcentration.share}%)` : "No storage value yet"],
                ["Action queue", `${intelligence.actionQueue.length} item${intelligence.actionQueue.length === 1 ? "" : "s"}`],
              ]}
            />
            <button className="button full" onClick={() => navigate("analytics")}>
              <BarChart3 size={17} />
              Open intelligence
            </button>
          </section>
        </div>
      </div>
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
          catalogueItem.set,
          catalogueItem.number,
          catalogueItem.rarity,
          item.condition,
          item.grade,
          item.language,
          item.location,
          item.notes ?? "",
          item.valuationNote ?? "",
          item.variant,
        ]
          .join(" ")
          .toLowerCase()
          .includes(normalizedSearch);

      return matchesFilter && matchesAdvancedFilters && matchesSearch;
    })
    .sort((left, right) => {
      if (appState.collectionSort === "value-asc") {
        return compareNullableNumbers(left.value, right.value, "asc");
      }

      if (appState.collectionSort === "name") {
        return (left.catalogueItem?.name ?? "").localeCompare(right.catalogueItem?.name ?? "", undefined, {
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
            <span className="status-pill">{items.length} shown</span>
            <button className="button primary" onClick={() => startAdd("card")}>
              <Plus size={17} />
              Add item
            </button>
          </>
        }
      />

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
        <div className="collection-sort-row">
          <p className="muted">
            {items.length} of {collection.length} lots | {formatMoney(visibleValue)} visible value
          </p>
          <label className="sort-control">
            <ArrowDownUp size={16} />
            <span>Sort</span>
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
              <option value="name">Name</option>
              <option value="set">Set number</option>
              <option value="recent">Recently added</option>
            </select>
          </label>
        </div>
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
                  <option value="high">GBP 100+</option>
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

function AddScreen({
  appState,
  catalogueItems,
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
  const [catalogueSort, setCatalogueSort] = useState<CatalogueSort>("set-number");

  useEffect(() => {
    setCatalogueSetFilter("all");
    setCatalogueRarityFilter("all");
  }, [appState.addType]);

  const results = catalogueItems.filter((item) => item.type === appState.addType);
  const normalizedSearch = addSearch.trim().toLowerCase();
  const setOptions = uniqueValues(results.map((item) => item.set)).sort((left, right) => left.localeCompare(right));
  const rarityOptions = uniqueValues(results.map((item) => item.rarity)).sort((left, right) =>
    left.localeCompare(right),
  );
  const filteredResults = results.filter((item) => {
    const matchesSearch = `${item.name} ${item.set} ${item.number} ${item.rarity}`.toLowerCase().includes(normalizedSearch);
    const matchesSet = catalogueSetFilter === "all" || item.set === catalogueSetFilter;
    const matchesRarity = catalogueRarityFilter === "all" || item.rarity === catalogueRarityFilter;

    return matchesSearch && matchesSet && matchesRarity;
  }).sort((left, right) => sortCatalogueItems(left, right, catalogueSort));
  const hasNarrowedResults = Boolean(normalizedSearch) || catalogueSetFilter !== "all" || catalogueRarityFilter !== "all";
  const resultLimit = hasNarrowedResults ? 80 : 16;
  const visibleResults = filteredResults.slice(0, resultLimit);
  const selected =
    filteredResults.find((item) => item.id === appState.selectedCatalogueId && item.type === appState.addType) ??
    filteredResults[0];
  const locationOptions = storageOptionNames(
    storageLocations,
    selected ? defaultStorageLocation(storageLocations, selected.type) : undefined,
  );

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      return;
    }

    void addToCollection(selected.id, new FormData(event.currentTarget));
  }

  return (
    <section className="page">
      <PageHeader
        title="Add item"
        action={
          <button className="button" onClick={() => navigate("collection")}>
            <X size={17} />
            Cancel
          </button>
        }
      />

      <div className="screen-split">
        <section className="section-block">
          <div className="segmented" aria-label="Item type">
            <button
              className={appState.addType === "card" ? "active" : ""}
              onClick={() =>
                setAppState((current) => ({
                  ...current,
                  addType: "card",
                  selectedCatalogueId: catalogueItems.find((item) => item.type === "card")?.id ?? current.selectedCatalogueId,
                }))
              }
            >
              Card
            </button>
            <button
              className={appState.addType === "sealed" ? "active" : ""}
              onClick={() =>
                setAppState((current) => ({
                  ...current,
                  addType: "sealed",
                  selectedCatalogueId: catalogueItems.find((item) => item.type === "sealed")?.id ?? current.selectedCatalogueId,
                }))
              }
            >
              Sealed product
            </button>
          </div>

          <label className="search-box">
            <Search size={18} />
            <input value={addSearch} onChange={(event) => setAddSearch(event.target.value)} placeholder="Search catalogue" />
          </label>

          <div className="catalogue-controls">
            <label className="sort-control">
              Set
              <select value={catalogueSetFilter} onChange={(event) => setCatalogueSetFilter(event.target.value)}>
                <option value="all">All</option>
                {setOptions.map((setName) => (
                  <option key={setName} value={setName}>{setName}</option>
                ))}
              </select>
            </label>
            <label className="sort-control">
              Rarity
              <select value={catalogueRarityFilter} onChange={(event) => setCatalogueRarityFilter(event.target.value)}>
                <option value="all">All</option>
                {rarityOptions.map((rarity) => (
                  <option key={rarity} value={rarity}>{rarity}</option>
                ))}
              </select>
            </label>
            <label className="sort-control">
              Sort
              <select value={catalogueSort} onChange={(event) => setCatalogueSort(event.target.value as CatalogueSort)}>
                <option value="set-number">Set number</option>
                <option value="value-desc">Value</option>
                <option value="name">Name</option>
                <option value="rarity">Rarity</option>
              </select>
            </label>
          </div>

          {appState.addType === "sealed" ? (
            <ManualSealedProductPanel sets={sets} onCreate={createManualSealedProduct} />
          ) : null}

          <p className="result-meta">
            Showing {visibleResults.length} of {filteredResults.length} {appState.addType === "sealed" ? "products" : "cards"}
            {!hasNarrowedResults && filteredResults.length > visibleResults.length ? " | Search or filter to see more" : ""}
          </p>
          <div className="item-list">
            {visibleResults.length ? visibleResults.map((item) => (
              <CatalogueResult
                key={item.id}
                item={item}
                selected={item.id === selected?.id}
                onClick={() => setAppState((current) => ({ ...current, selectedCatalogueId: item.id }))}
              />
            )) : (
              <EmptyState
                title="No matching catalogue items"
                description={
                  appState.addType === "sealed"
                    ? "Try a shorter search, or create a private manual sealed product."
                    : "Try a card name, set name, or collector number."
                }
              />
            )}
          </div>
        </section>

        <section className="tool-panel add-details-panel">
          <h2>Owned details</h2>
          {selected ? (
            <CataloguePreview item={selected} />
          ) : (
            <EmptyState title="No item selected" description="Choose a catalogue result to add owned-copy details." />
          )}
          <form className="form-stack" key={selected?.id ?? "no-selection"} onSubmit={handleSubmit}>
            <div className="field-grid">
              <Field label="Condition">
                <select name="condition" defaultValue={selected?.type === "sealed" ? "Sealed" : "Near mint"}>
                  <option>Near mint</option>
                  <option>Excellent</option>
                  <option>Light played</option>
                  <option>Played</option>
                  <option>Sealed</option>
                  <option>Unknown</option>
                </select>
              </Field>
              <Field label="Language">
                <select name="language" defaultValue="English">
                  <option>English</option>
                  <option>Japanese</option>
                  <option>German</option>
                  <option>French</option>
                  <option>Other</option>
                </select>
              </Field>
              <Field label="Quantity">
                <input name="quantity" type="number" min={1} defaultValue={1} />
              </Field>
              <Field label="Paid">
                <input name="paid" inputMode="decimal" placeholder="GBP 0.00" />
              </Field>
              <Field label="Manual value">
                <input name="overrideValue" inputMode="decimal" placeholder="GBP 0.00" />
              </Field>
              <Field label="Location">
                <select
                  name="location"
                  defaultValue={selected ? defaultStorageLocation(storageLocations, selected.type) : "Unassigned"}
                >
                  {locationOptions.map((location) => (
                    <option key={location}>{location}</option>
                  ))}
                </select>
              </Field>
              <Field label="Variant">
                {selected ? <VariantSelect item={selected} /> : <input name="variant" disabled />}
              </Field>
            </div>
            <Field label="Valuation note">
              <textarea name="valuationNote" placeholder="Source or reason for valuation" />
            </Field>
            <Field label="Notes">
              <textarea name="notes" placeholder="Optional" />
            </Field>
            <div className="actions">
              <button className="button primary" type="submit" disabled={!selected}>
                <Check size={17} />
                Save to collection
              </button>
              <button className="button" type="button" disabled={!selected} onClick={() => selected && void addToWishlist(selected.id)}>
                <Heart size={17} />
                Add to wishlist
              </button>
            </div>
          </form>
        </section>
      </div>
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
              <input name="estimatedValue" inputMode="decimal" placeholder="GBP 0.00" />
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
  const itemName = item.name;
  const locationOptions = storageOptionNames(storageLocations, owned.location);
  const itemEvents = collectionEvents.filter((event) => event.itemId === owned.id).slice(0, 6);

  async function handleUpdate(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);

    const saved = await updateCollectionItem(owned.id, new FormData(event.currentTarget));
    setIsSaving(false);

    if (saved) {
      setIsEditing(false);
    }
  }

  async function handleRemove() {
    if (!window.confirm(`Remove ${itemName} from your collection?`)) {
      return;
    }

    setIsRemoving(true);
    await archiveCollectionItem(owned.id);
    setIsRemoving(false);
  }

  async function handleSale(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsRecordingSale(true);
    const recorded = await recordCollectionSale(owned.id, new FormData(event.currentTarget));
    setIsRecordingSale(false);

    if (recorded) {
      setIsSelling(false);
    }
  }

  return (
    <section className="page">
      <PageHeader
        title={item.name}
        action={
          <button className="button" onClick={() => navigate("collection")}>
            <ArrowLeft size={17} />
            Collection
          </button>
        }
      />

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
              <button className="button" onClick={() => void duplicateItem(owned.id)}>
                <Plus size={17} />
                Duplicate lot
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
                      <option>English</option>
                      <option>Japanese</option>
                      <option>German</option>
                      <option>French</option>
                      <option>Other</option>
                    </select>
                  </Field>
                  <Field label="Quantity">
                    <input name="quantity" type="number" min={1} defaultValue={owned.quantity} />
                  </Field>
                  <Field label="Paid">
                    <input
                      name="paid"
                      inputMode="decimal"
                      defaultValue={moneyInputValue(owned.purchasePriceMinor)}
                      placeholder="GBP 0.00"
                    />
                  </Field>
                  <Field label="Manual value">
                    <input
                      name="overrideValue"
                      inputMode="decimal"
                      defaultValue={moneyInputValue(owned.overrideValueMinor)}
                      placeholder="GBP 0.00"
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
                  <Field label="Variant">
                    <VariantSelect item={item} defaultValue={owned.variant} />
                  </Field>
                </div>
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
                ["Variant", owned.variant],
                ["Grade", owned.grade],
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
          <PriceTrendPanel item={item} overrideValueMinor={owned.overrideValueMinor} />
          <section className="tool-panel">
            <h2>Valuation note</h2>
            <p className="muted">{owned.valuationNote || "No valuation note yet."}</p>
          </section>
          {isSelling ? (
            <section className="tool-panel">
              <div className="panel-title-row">
                <h2>Record sale</h2>
                <span className="tag amber">Removes lot</span>
              </div>
              <p className="muted">Record the sale amount and date. The item will move out of the active collection.</p>
              <form className="form-stack" onSubmit={handleSale}>
                <div className="field-grid">
                  <Field label="Sale amount">
                    <input
                      name="amount"
                      inputMode="decimal"
                      defaultValue={moneyInputValue(value ?? undefined)}
                      placeholder="GBP 0.00"
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
  appState,
  sets,
  setSearch,
  setSetSearch,
  setAppState,
}: ScreenContext) {
  const filteredSets = sets.filter((set) => set.name.toLowerCase().includes(setSearch.toLowerCase()));

  return (
    <section className="page">
      <PageHeader title="Sets" />
      <label className="search-box">
        <Search size={18} />
        <input value={setSearch} onChange={(event) => setSetSearch(event.target.value)} placeholder="Search sets" />
      </label>
      <div className="set-list">
        {filteredSets.map((set) => (
          <SetProgressCard
            key={set.id}
            set={set}
            onClick={() => setAppState({ ...appState, selectedSetId: set.id, screen: "setDetail" })}
          />
        ))}
      </div>
    </section>
  );
}

function SetDetailScreen({
  appState,
  catalogueItems,
  collection,
  sets,
  wishlist,
  setAppState,
  addToWishlist,
  navigate,
}: ScreenContext) {
  const [cardSearch, setCardSearch] = useState("");
  const [rarityFilter, setRarityFilter] = useState("all");
  const [sort, setSort] = useState<SetDetailSort>("number");
  const set = sets.find((item) => item.id === appState.selectedSetId) ?? sets[0];

  if (!set) {
    return <EmptyState title="No sets found" />;
  }

  const setCards = catalogueItems.filter((item) => item.type === "card" && item.set === set.name);
  const done = completionPercent(set.owned, set.total);
  const normalizedCardSearch = cardSearch.trim().toLowerCase();
  const rarityOptions = uniqueValues(setCards.map((item) => item.rarity)).sort((left, right) =>
    left.localeCompare(right),
  );
  const setMarketValue = setCards.reduce((total, item) => total + (catalogueMarketValueMinor(item) ?? 0), 0);
  const missingCount = Math.max(set.total - set.owned, 0);
  const wantedCount = setCards.filter((item) => wishlist.some((entry) => entry.catalogueId === item.id)).length;

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
    const matchesSearch = `${item.name} ${item.number} ${item.rarity}`.toLowerCase().includes(normalizedCardSearch);
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
        title={set.name}
        action={
          <button className="button" onClick={() => navigate("sets")}>
            <ArrowLeft size={17} />
            Sets
          </button>
        }
      />
      <section className="tool-panel set-detail-panel">
        <div className="panel-title-row">
          <div>
            <h2>Set progress</h2>
            <p className="muted">{set.owned} of {set.total} cards owned</p>
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
              <option value="number">Number</option>
              <option value="value-desc">Value</option>
              <option value="name">Name</option>
              <option value="rarity">Rarity</option>
            </select>
          </label>
        </div>
      </section>

      <div className="item-list">
        {visibleCards.length ? visibleCards.map((item) => {
          const owned = collection.find((entry) => entry.catalogueId === item.id);
          const wanted = wishlist.some((entry) => entry.catalogueId === item.id);

          return (
            <article className="item-card" key={item.id}>
              <div className="item-image">{renderItemImage(item)}</div>
              <div className="item-main">
                <div className="item-title-row">
                  <div>
                    <h3>{item.name}</h3>
                    <p className="muted">{item.set} | {item.number}</p>
                  </div>
                  <span className={owned ? "tag green" : wanted ? "tag amber" : "tag"}>{owned ? "Owned" : wanted ? "Want" : "Missing"}</span>
                </div>
                <div className="tag-row">
                  <span className="tag blue">{item.rarity}</span>
                  <span className="tag">{formatValuation(catalogueMarketValueMinor(item))}</span>
                </div>
                <div className="actions item-action-grid">
                  {owned ? (
                    <button
                      className="button"
                      onClick={() => {
                        setAppState((current) => ({ ...current, selectedItemId: owned.id }));
                        navigate("item");
                      }}
                    >
                      Open
                    </button>
                  ) : (
                    <button
                      className="button primary"
                      onClick={() => {
                        setAppState((current) => ({ ...current, selectedCatalogueId: item.id, addType: "card" }));
                        navigate("add");
                      }}
                    >
                      <Plus size={17} />
                      Add
                    </button>
                  )}
                  <button className="button" type="button" disabled={wanted} onClick={() => void addToWishlist(item.id)}>
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
    </section>
  );
}

function WishlistScreen({
  catalogueById,
  wishlist,
  wishlistTotal,
  addToCollection,
  removeWishlistItem,
  startAdd,
  updateWishlistItem,
}: ScreenContext) {
  const [editingId, setEditingId] = useState("");
  const [savingId, setSavingId] = useState("");
  const wishlistInsight = wishlist.reduce(
    (summary, item) => {
      const catalogueItem = catalogueById.get(item.catalogueId);
      const currentValue = catalogueItem ? catalogueMarketValueMinor(catalogueItem) : null;
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

  async function handleUpdate(event: FormEvent<HTMLFormElement>, itemId: string) {
    event.preventDefault();
    setSavingId(itemId);
    const saved = await updateWishlistItem(itemId, new FormData(event.currentTarget));
    setSavingId("");

    if (saved) {
      setEditingId("");
    }
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
      <div className="stats-grid compact">
        <StatCard label="Wanted" value={wishlist.length.toString()} note="Cards and sealed products" />
        <StatCard label="Target total" value={formatMoney(wishlistTotal)} note="Based on target prices" />
      </div>
      {wishlist.length ? (
        <section className="tool-panel wishlist-summary-panel">
          <div className="panel-title-row">
            <div>
              <h2>Target watch</h2>
              <p className="muted">
                {wishlistInsight.targetHits
                  ? `${wishlistInsight.targetHits} target ${wishlistInsight.targetHits === 1 ? "is" : "are"} at or below your buy price.`
                  : "No targets are at or below your buy price yet."}
              </p>
            </div>
            <span className="tag amber">{wishlistInsight.grailCount} grail</span>
          </div>
          <div className="wishlist-summary-grid">
            <span><b>{wishlistInsight.targetHits}</b>At target</span>
            <span><b>{wishlistInsight.pricedCount}</b>Priced</span>
            <span><b>{wishlist.length - wishlistInsight.pricedCount}</b>Needs estimate</span>
          </div>
        </section>
      ) : null}

      <div className="item-list">
        {wishlist.length ? (
          wishlist.map((item) => {
            const catalogueItem = catalogueById.get(item.catalogueId);
            if (!catalogueItem) {
              return null;
            }
            const isEditing = editingId === item.id;
            const currentValue = catalogueMarketValueMinor(catalogueItem);
            const targetValue = item.targetPriceMinor ?? currentValue;
            const delta = currentValue === null || targetValue === null ? null : targetValue - currentValue;

            return (
              <article className="item-card wishlist-card" key={item.id}>
                <div className="item-image">{renderItemImage(catalogueItem)}</div>
                <div className="item-main">
                  <div className="item-title-row">
                    <div>
                      <h3>{catalogueItem.name}</h3>
                      <p className="muted">{catalogueItem.set} | {catalogueItem.number}</p>
                    </div>
                    <span className="priority-pill">{item.priority}</span>
                  </div>
                  {isEditing ? (
                    <form className="form-stack" onSubmit={(event) => void handleUpdate(event, item.id)}>
                      <div className="panel-title-row compact-row">
                        <strong>Edit target</strong>
                        <span className="tag">{item.priority}</span>
                      </div>
                      <div className="field-grid">
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
                            placeholder="GBP 0.00"
                          />
                        </Field>
                      </div>
                      <Field label="Notes">
                        <textarea name="notes" defaultValue={item.notes ?? ""} placeholder="Optional" />
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
                  ) : (
                    <>
                      <div className="wishlist-target-grid">
                        <span>
                          <small>Target</small>
                          <strong>{formatValuation(targetValue)}</strong>
                        </span>
                        <span>
                          <small>Market</small>
                          <strong>{formatValuation(currentValue)}</strong>
                        </span>
                        <span className={delta !== null && delta >= 0 ? "target-hit" : ""}>
                          <small>Status</small>
                          <strong>{delta === null ? "Needs estimate" : wishlistDeltaText(delta)}</strong>
                        </span>
                      </div>
                      {item.notes ? <p className="muted wishlist-note">{item.notes}</p> : null}
                      <div className="actions item-action-grid">
                        <button className="button primary" onClick={() => void addToCollection(item.catalogueId)}>
                          <Check size={17} />
                          Move to collection
                        </button>
                        <button className="button" onClick={() => setEditingId(item.id)}>
                          <Settings size={17} />
                          Edit target
                        </button>
                        <button
                          className="button"
                          onClick={() => void removeWishlistItem(item.id)}
                        >
                          <Trash2 size={17} />
                          Remove
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </article>
            );
          })
        ) : (
          <EmptyState
            title="No wishlist items"
            description="Add cards or sealed products you want to track before buying."
            action={
              <button className="button primary" type="button" onClick={() => startAdd("card")}>
                <Plus size={17} />
                Add target
              </button>
            }
          />
        )}
      </div>
    </section>
  );
}

function AlertsScreen({
  appState,
  intelligence,
  startPlusCheckout,
  setAppState,
}: ScreenContext) {
  const alerts = intelligence.actionQueue;
  const priceAlerts = intelligence.priceAlerts;
  const highImpact = alerts.filter((alert) => alert.impact === "High").length;
  const watchCount = alerts.filter((alert) => alert.tone === "watch").length;
  const targetHits = priceAlerts.filter((alert) => alert.status === "Hit").length;

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
    setAppState((current) => ({
      ...current,
      screen: alert.category === "Wishlist" ? "wishlist" : "collection",
      collectionFilter: alert.category === "Wishlist" ? current.collectionFilter : "all",
      collectionValueFilter: alert.category === "Wishlist" ? current.collectionValueFilter : "weak",
    }));
  }

  return (
    <section className="page">
      <PageHeader title="Alerts" action={<span className="status-pill"><Bell size={17} />{alerts.length}</span>} />
      <div className="stats-grid compact">
        <StatCard label="Open alerts" value={alerts.length.toString()} note="Generated from your live collection" />
        <StatCard label="High impact" value={highImpact.toString()} note="Worth checking first" />
        <StatCard label="Watch items" value={watchCount.toString()} note="Useful but not urgent" />
        <StatCard label="Price alerts" value={priceAlerts.length.toString()} note={`${targetHits} target hit${targetHits === 1 ? "" : "s"}`} />
      </div>

      <section className="tool-panel">
        <div className="panel-title-row">
          <h2>Price watchlist</h2>
          <span className="plan-pill"><Sparkles size={17} />Plus</span>
        </div>
        {!appState.plus ? (
          <div className="locked-preview">
            <div>
              <strong>Automated price alerts are a Plus feature.</strong>
              <p className="muted">
                Free users can still track wishlist targets and item values. Plus adds email digests when targets hit,
                weak prices need attention, or watched items move.
              </p>
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
        ) : priceAlerts.length ? (
          <div className="alert-list">
            {priceAlerts.map((alert) => (
              <article className="alert-row" key={alert.id}>
                <div className="alert-main">
                  <div className="tag-row">
                    <span className={`tag ${priceAlertTagClass(alert.status)}`}>{alert.status}</span>
                    <span className="tag">{alert.category}</span>
                  </div>
                  <strong>{alert.itemName}</strong>
                  <p className="muted">{alert.detail}</p>
                  <div className="alert-facts">
                    {priceAlertFacts(alert).map(([label, value]) => (
                      <span key={label}>
                        <b>{label}</b>
                        {value}
                      </span>
                    ))}
                  </div>
                </div>
                <button className="button" onClick={() => openPriceAlert(alert)}>
                  {alert.actionLabel}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">No target-price or weak-confidence price alerts right now.</p>
        )}
      </section>

      <section className="tool-panel">
        <div className="panel-title-row">
          <h2>Review center</h2>
          <Sparkles size={18} />
        </div>
        {alerts.length ? (
          <div className="alert-list">
            {alerts.map((alert) => (
              <article className="alert-row" key={alert.id}>
                <div className="alert-main">
                  <div className="tag-row">
                    <span className={`tag ${actionTagClass(alert.tone)}`}>{alert.category}</span>
                    <span className={`tag ${impactTagClass(alert.impact)}`}>{alert.impact}</span>
                  </div>
                  <strong>{alert.title}</strong>
                  <p className="muted">{alert.detail}</p>
                </div>
                <button className="button" onClick={() => openAlert(alert)}>
                  {alert.actionLabel}
                </button>
              </article>
            ))}
          </div>
        ) : (
          <EmptyState title="No alerts right now" />
        )}
      </section>

      <div className="dashboard-grid">
        <MetricPanel
          title="Signal summary"
          rows={[
            ["Valuation coverage", `${intelligence.valuationCoverage.coveragePercent}%`],
            ["Needs estimate", intelligence.valuationCoverage.unvaluedLots],
            ["Manual values", intelligence.valuationCoverage.manualLots],
            ["Missing value notes", intelligence.valuationCoverage.manualNotesMissing],
            ["Wishlist hits", intelligence.wishlistOpportunities.length],
            ["Grading candidates", intelligence.gradingCandidates.length],
            ["Duplicate reviews", intelligence.duplicates.length],
            ["Weak prices", intelligence.weakConfidence.count],
          ]}
        />
        <MetricPanel
          title="Activity"
          rows={[
            ["Last 30 days", `${intelligence.activity.last30Days} events`],
            ["Added", intelligence.activity.added],
            ["Edited", intelligence.activity.edited],
            ["Sold", intelligence.activity.sold],
            ["Removed", intelligence.activity.removed],
          ]}
        />
      </div>
    </section>
  );
}

function AnalyticsScreen({
  appState,
  collectionEvents,
  intelligence,
  navigate,
  startPlusCheckout,
  summary,
  wishlistTotal,
}: ScreenContext) {
  const gain = summary.value - summary.cost;
  const duplicateValue = intelligence.duplicates.reduce((total, item) => total + item.valueMinor, 0);
  const leadAction = intelligence.actionQueue[0];
  const realizedSales = intelligence.realizedSales;
  const portfolioDelta = portfolioHistoryDelta(intelligence.portfolioHistory);

  if (!appState.plus) {
    return (
      <section className="page">
        <PageHeader title="Analytics" action={<span className="plan-pill"><Lock size={17} />Free preview</span>} />
        <div className="stats-grid">
          <StatCard label="Health score" value={`${intelligence.healthScore}/100`} note={intelligence.healthLabel} />
          <StatCard label="Current value" value={formatMoney(summary.value)} note={`${summary.items} tracked items`} />
          <StatCard label="Gain/loss" value={formatMoney(gain)} note="Known cost basis" positive={gain >= 0} />
          <StatCard label="Wishlist hits" value={intelligence.wishlistOpportunities.length.toString()} note={`${formatMoney(wishlistTotal)} target list`} />
        </div>
        <div className="screen-split">
          <section className="tool-panel">
            <div className="panel-title-row">
              <h2>Free snapshot</h2>
              <BarChart3 size={18} />
            </div>
            <MetricList
              rows={[
                ["Top holding", intelligence.topHoldings[0]?.name ?? "Add more items"],
                ["Best performer", intelligence.bestPerformer ? gainLabel(intelligence.bestPerformer) : "Add purchase prices"],
                ["Sales recorded", realizedSales.count],
                ["Next action", leadAction?.title ?? "Collection looks tidy"],
                ["Recent activity", `${intelligence.activity.last30Days} events this month`],
              ]}
            />
          </section>
          <section className="section-block">
            <SectionHeader title="Plus unlocks" />
            <div className="locked-list">
              {["Value path", "Realised sales", "Action queue", "Portfolio mix", "Wishlist targets"].map((label) => (
                <div className="locked-tile" key={label}>
                  <strong>{label}</strong>
                  <span className="tag red">Locked</span>
                </div>
              ))}
            </div>
          </section>
          <section className="tool-panel upgrade-panel">
            <div className="panel-title-row">
              <h2>Plus</h2>
              <span className="tag green">GBP 19.99 yearly</span>
            </div>
            <p className="muted">
              Keep the free tracking tools. Add automation, richer analytics, and reports when the collection needs
              deeper attention.
            </p>
            <MetricList
              rows={[
                ["Monthly", "GBP 2.49"],
                ["Yearly", "GBP 19.99"],
                ["Unlocks", "Trends, alerts, reports"],
              ]}
            />
            <div className="upgrade-actions">
              <button className="button primary" onClick={() => void startPlusCheckout("monthly")}>
                <CreditCard size={17} />
                Monthly
              </button>
              <button className="button" onClick={() => void startPlusCheckout("yearly")}>
                <Sparkles size={17} />
                Yearly
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
      <PageHeader title="Analytics" action={<span className="plan-pill"><Sparkles size={17} />Plus active</span>} />
      <div className="stats-grid">
        <StatCard label="Health score" value={`${intelligence.healthScore}/100`} note={intelligence.healthLabel} />
        <StatCard label="Current value" value={formatMoney(summary.value)} note={`${intelligence.valuationCoverage.coveragePercent}% valued`} />
        <StatCard label="Gain/loss" value={formatMoney(gain)} note="Against known cost" positive={gain >= 0} />
        <StatCard
          label="Value movement"
          value={portfolioDelta === null ? "Unknown" : formatSignedMoney(portfolioDelta)}
          note={portfolioDelta === null ? "Needs price history" : "Since first price point"}
          positive={portfolioDelta !== null && portfolioDelta >= 0}
        />
        <StatCard
          label="Sales"
          value={formatMoney(realizedSales.proceedsMinor)}
          note={`${realizedSales.count} recorded sale${realizedSales.count === 1 ? "" : "s"}`}
          positive={realizedSales.gainMinor >= 0}
        />
        <StatCard label="Duplicates" value={intelligence.duplicates.length.toString()} note={`${formatMoney(duplicateValue)} across duplicate lots`} />
        <StatCard label="Wishlist hits" value={intelligence.wishlistOpportunities.length.toString()} note="At or below target" />
      </div>
      <div className="dashboard-grid">
        <PortfolioHistoryPanel history={intelligence.portfolioHistory} currentValueMinor={summary.value} />
        <ActionQueue actions={intelligence.actionQueue} />
        <TopHoldings holdings={intelligence.topHoldings} />
        <PortfolioMix rows={intelligence.portfolioMix} />
        <SalesLedger realizedSales={realizedSales} />
        <MetricPanel
          title="Collection review"
          rows={[
            ["Best performer", intelligence.bestPerformer ? gainLabel(intelligence.bestPerformer) : "Add purchase prices"],
            ["Valuation coverage", `${intelligence.valuationCoverage.knownLots} / ${intelligence.valuationCoverage.totalLots} lots`],
            ["Needs estimate", `${intelligence.valuationCoverage.unvaluedLots} lots`],
            ["Manual values", `${intelligence.valuationCoverage.manualLots} lots`],
            ["Missing value notes", intelligence.valuationCoverage.manualNotesMissing],
            ["Weak prices", `${intelligence.weakConfidence.count} holdings`],
            ["Grading candidates", intelligence.gradingCandidates.length],
            ["Set focus", intelligence.setFocus ? `${intelligence.setFocus.name} (${intelligence.setFocus.remaining} left)` : "No sets loaded"],
          ]}
        />
        <WishlistOpportunities opportunities={intelligence.wishlistOpportunities} />
        <section className="tool-panel">
          <div className="panel-title-row">
            <h2>Activity feed</h2>
            <History size={18} />
          </div>
          <EventList events={collectionEvents.slice(0, 6)} />
        </section>
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

function OperationsScreen({
  catalogueItems,
  refreshAppData,
  showToast,
}: ScreenContext) {
  const [jobSecret, setJobSecret] = useState("");
  const [query, setQuery] = useState("set.id:sv3pt5");
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [maxPages, setMaxPages] = useState(1);
  const [cardPriceOnlyUnpriced, setCardPriceOnlyUnpriced] = useState(true);
  const [sealedGroupIds, setSealedGroupIds] = useState("");
  const [sealedGroupLimit, setSealedGroupLimit] = useState(10);
  const [sealedPriceOnlyUnpriced, setSealedPriceOnlyUnpriced] = useState(true);
  const [sealedUsdToGbpRate, setSealedUsdToGbpRate] = useState("");
  const [mergePrimaryCardId, setMergePrimaryCardId] = useState("");
  const [mergeDuplicateCardId, setMergeDuplicateCardId] = useState("");
  const [jobRuns, setJobRuns] = useState<JobRunRecord[]>([]);
  const [catalogueStatus, setCatalogueStatus] = useState<CatalogueStatusRecord | null>(null);
  const [lastResult, setLastResult] = useState<unknown>(null);
  const [isBusy, setIsBusy] = useState("");
  const latestJobResult = parseJobApiResult(lastResult);
  const duplicateProviderReview = parseDuplicateProviderReview(lastResult);
  const resumableJob = getResumeJob(latestJobResult);
  const gapRecommendations = catalogueStatus ? catalogueGapRecommendations(catalogueStatus) : [];
  const localCardCount = catalogueItems.filter((item) => item.type === "card").length;
  const presetRows = importPresets.map((preset) => ({
    ...preset,
    importedCount: catalogueItems.filter((item) => item.type === "card" && preset.setNames.includes(item.set)).length,
    pageSize: Math.min(250, preset.expectedTotal),
  }));

  async function loadJobRuns() {
    if (!jobSecret.trim()) {
      showToast("Job secret required.");
      return false;
    }

    setIsBusy("runs");
    try {
      const response = await fetch("/api/jobs/runs?limit=10", {
        headers: jobHeaders(jobSecret),
      });
      const body = (await response.json()) as { error?: string; runs?: JobRunRecord[] };

      if (!response.ok) {
        throw new Error(body.error ?? `Job runs failed with ${response.status}`);
      }

      setJobRuns(body.runs ?? []);
      void loadCatalogueStatus({ quiet: true });
      showToast("Job runs loaded.");
      return true;
    } catch (error) {
      console.warn("Unable to load job runs.", error);
      showToast(error instanceof Error ? error.message : "Unable to load job runs.");
      return false;
    } finally {
      setIsBusy("");
    }
  }

  async function loadCatalogueStatus(options?: { quiet?: boolean }) {
    if (!jobSecret.trim()) {
      showToast("Job secret required.");
      return false;
    }

    if (!options?.quiet) {
      setIsBusy("status");
    }

    try {
      const response = await fetch("/api/jobs/catalogue-status", {
        headers: jobHeaders(jobSecret),
      });
      const body = (await response.json()) as CatalogueStatusApiResult;

      if (!response.ok || !body.status) {
        throw new Error(body.error ?? `Catalogue status failed with ${response.status}`);
      }

      setCatalogueStatus(body.status);
      setJobRuns((current) =>
        [
          body.latestCatalogueRun,
          body.latestPricingRun,
          body.latestSealedPricingRun,
          ...current,
        ]
          .filter((run): run is JobRunRecord => Boolean(run))
          .filter((run, index, runs) => runs.findIndex((entry) => entry.id === run.id) === index)
          .slice(0, 10),
      );

      if (!options?.quiet) {
        showToast("Catalogue status loaded.");
      }

      return true;
    } catch (error) {
      console.warn("Unable to load catalogue status.", error);
      if (!options?.quiet) {
        showToast(error instanceof Error ? error.message : "Unable to load catalogue status.");
      }
      return false;
    } finally {
      if (!options?.quiet) {
        setIsBusy("");
      }
    }
  }

  function applyPreset(preset: ImportPreset) {
    setQuery(preset.query);
    setPage(1);
    setPageSize(Math.min(250, preset.expectedTotal));
    setMaxPages(1);
  }

  function prepareDuplicateMerge(primaryCardId: string, duplicateCardId: string) {
    setMergePrimaryCardId(primaryCardId);
    setMergeDuplicateCardId(duplicateCardId);
    showToast("Duplicate merge prepared.");
  }

  async function runPresetJob(preset: ImportPreset, kind: "catalogue" | "pricing") {
    applyPreset(preset);
    await runJob(kind, {
      maxPages: 1,
      page: 1,
      pageSize: Math.min(250, preset.expectedTotal),
      q: preset.query,
    });
  }

  async function resumeLatestJob() {
    if (!resumableJob) {
      return;
    }

    setQuery(resumableJob.query ?? "");
    setPage(resumableJob.nextPage);
    setPageSize(resumableJob.pageSize);
    await runJob(resumableJob.kind, {
      maxPages,
      page: resumableJob.nextPage,
      pageSize: resumableJob.pageSize,
      q: resumableJob.query,
    });
  }

  async function runGapRecommendation(recommendation: CatalogueGapRecommendation) {
    if (recommendation.type === "catalogue_resume" && catalogueStatus?.nextCataloguePage) {
      setQuery("");
      setPage(catalogueStatus.nextCataloguePage);
      setPageSize(250);
      await runJob("catalogue", {
        maxPages,
        page: catalogueStatus.nextCataloguePage,
        pageSize: 250,
        q: "",
      });
      return;
    }

    if (recommendation.type === "card_pricing") {
      setQuery("");
      setPage(1);
      setPageSize(250);
      await runJob("pricing", {
        maxPages,
        page: 1,
        pageSize: 250,
        q: "",
      });
      return;
    }

    if (recommendation.type === "sealed_pricing") {
      await runJob("sealed");
      return;
    }

    if (recommendation.type === "duplicate_review") {
      await loadDuplicateProviderReview();
      return;
    }

    if (recommendation.type === "card_image_refresh") {
      await runJob("card-image-repair");
      return;
    }

    if (recommendation.type === "sealed_image_refresh") {
      await runJob("sealed-image-repair");
      return;
    }

    if (recommendation.type === "variant_metadata_refresh") {
      await runJob("variant-metadata-repair");
    }
  }

  async function runJob(
    kind: OperationsJobKind,
    override?: { maxPages?: number; page?: number; pageSize?: number; q?: string },
  ) {
    if (!jobSecret.trim()) {
      showToast("Job secret required.");
      return false;
    }

    const path =
      kind === "catalogue"
        ? "/api/jobs/catalogue-refresh"
        : kind === "pricing"
          ? "/api/jobs/pricing-refresh"
          : kind === "sealed"
            ? "/api/jobs/sealed-pricing-refresh"
            : kind === "card-image-repair"
              ? "/api/jobs/card-image-repair"
              : kind === "sealed-image-repair"
                ? "/api/jobs/sealed-image-repair"
                : kind === "variant-metadata-repair"
                  ? "/api/jobs/variant-metadata-repair"
                  : "/api/jobs/price-alerts";
    const body =
      kind === "alerts"
        ? { dryRun: true }
        : kind === "sealed"
          ? sealedJobBody()
          : kind === "card-image-repair"
            ? { dryRun: false, limit: 500 }
            : kind === "sealed-image-repair"
              ? { dryRun: false, limit: 500, waitMs: 120 }
              : kind === "variant-metadata-repair"
                ? { dryRun: false, limit: 500, waitMs: 120 }
                : {
                  maxPages: override?.maxPages ?? maxPages,
                  page: override?.page ?? page,
                  pageSize: override?.pageSize ?? pageSize,
                  priceOnlyUnpriced: kind === "pricing" ? cardPriceOnlyUnpriced : undefined,
                  q: override?.q?.trim() || query.trim() || undefined,
                };

    setIsBusy(kind);
    try {
      const response = await fetch(path, {
        method: "POST",
        headers: {
          ...jobHeaders(jobSecret),
          "content-type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const result = (await response.json()) as { error?: string; jobRun?: JobRunRecord };

      if (!response.ok) {
        setLastResult(result);
        setJobRuns((current) => (result.jobRun ? [result.jobRun, ...current].slice(0, 10) : current));
        throw new Error(result.error ?? `Job failed with ${response.status}`);
      }

      setLastResult(result);
      setJobRuns((current) => (result.jobRun ? [result.jobRun, ...current].slice(0, 10) : current));
      showToast("Job completed.");

      if (kind !== "alerts") {
        await refreshAppData({ quiet: true });
        void loadCatalogueStatus({ quiet: true });
      }
      return true;
    } catch (error) {
      console.warn("Unable to run job.", error);
      showToast(error instanceof Error ? error.message : "Unable to run job.");
      if (error instanceof Error) {
        setLastResult({ error: error.message });
      }
      return false;
    } finally {
      setIsBusy("");
    }
  }

  function sealedJobBody() {
    const rate = Number(sealedUsdToGbpRate);

    return {
      groupIds: sealedGroupIds.trim() || undefined,
      groupLimit: sealedGroupLimit,
      priceOnlyUnpriced: sealedPriceOnlyUnpriced,
      usdToGbpRate: Number.isFinite(rate) && rate > 0 ? rate : undefined,
      writePrices: true,
    };
  }

  async function exportCatalogueGaps() {
    if (!jobSecret.trim()) {
      showToast("Job secret required.");
      return false;
    }

    setIsBusy("gap-export");
    try {
      const response = await fetch("/api/jobs/catalogue-gaps", {
        headers: jobHeaders(jobSecret),
      });

      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };

        throw new Error(body.error ?? `Catalogue gap export failed with ${response.status}`);
      }

      downloadBlob(`mintbinder-catalogue-gaps-${dateStamp()}.json`, await response.blob());
      showToast("Catalogue gap report downloaded.");
      return true;
    } catch (error) {
      console.warn("Unable to export catalogue gaps.", error);
      showToast(error instanceof Error ? error.message : "Unable to export catalogue gaps.");
      return false;
    } finally {
      setIsBusy("");
    }
  }

  async function loadDuplicateProviderReview() {
    if (!jobSecret.trim()) {
      showToast("Job secret required.");
      return false;
    }

    setIsBusy("duplicate-review");
    try {
      const response = await fetch("/api/jobs/duplicate-provider-review?limit=50", {
        headers: jobHeaders(jobSecret),
      });
      const result = (await response.json()) as JobApiResult & { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? `Duplicate review failed with ${response.status}`);
      }

      setLastResult(result);
      showToast("Duplicate provider review loaded.");
      return true;
    } catch (error) {
      console.warn("Unable to review duplicate provider IDs.", error);
      showToast(error instanceof Error ? error.message : "Unable to review duplicate provider IDs.");
      if (error instanceof Error) {
        setLastResult({ error: error.message });
      }
      return false;
    } finally {
      setIsBusy("");
    }
  }

  async function runDuplicateCardMerge(execute: boolean) {
    if (!jobSecret.trim()) {
      showToast("Job secret required.");
      return false;
    }

    if (!mergePrimaryCardId.trim() || !mergeDuplicateCardId.trim()) {
      showToast("Both card IDs are required.");
      return false;
    }

    setIsBusy(execute ? "duplicate-merge" : "duplicate-merge-dry-run");
    try {
      const response = await fetch("/api/jobs/duplicate-card-merge", {
        body: JSON.stringify({
          duplicateCardId: mergeDuplicateCardId.trim(),
          execute,
          primaryCardId: mergePrimaryCardId.trim(),
        }),
        headers: {
          ...jobHeaders(jobSecret),
          "content-type": "application/json",
        },
        method: "POST",
      });
      const result = (await response.json()) as JobApiResult & { error?: string };

      if (!response.ok) {
        throw new Error(result.error ?? `Duplicate merge failed with ${response.status}`);
      }

      setLastResult(result);
      showToast(execute ? "Duplicate card merged." : "Duplicate merge dry run ready.");

      if (execute) {
        void loadCatalogueStatus({ quiet: true });
        void refreshAppData();
      }

      return true;
    } catch (error) {
      console.warn("Unable to merge duplicate card.", error);
      showToast(error instanceof Error ? error.message : "Unable to merge duplicate card.");
      if (error instanceof Error) {
        setLastResult({ error: error.message });
      }
      return false;
    } finally {
      setIsBusy("");
    }
  }

  return (
    <section className="page">
      <PageHeader title="Operations" action={<span className="status-pill"><TerminalSquare size={17} />Jobs</span>} />
      <div className="stats-grid compact">
        <StatCard
          label="Catalogue cards"
          value={formatCount(catalogueStatus?.cardCount ?? localCardCount)}
          note={
            catalogueStatus?.providerTotalCount
              ? `${formatPercent(catalogueStatus.coveragePercent)} of provider`
              : "Loaded in app"
          }
        />
        <StatCard label="Provider total" value={formatCount(catalogueStatus?.providerTotalCount)} note="Pokemon TCG API" />
        <StatCard label="Next page" value={catalogueStatus?.nextCataloguePage?.toString() ?? "-"} note="Broad import resume point" />
        <StatCard label="Pages/job" value={maxPages.toString()} note="Capped at 20 for safety" />
        <StatCard label="Access" value={jobSecret ? "Ready" : "Locked"} note="Requires JOB_SECRET" />
      </div>

      <div className="dashboard-grid">
        <section className="tool-panel">
          <div className="panel-title-row">
            <h2>Import presets</h2>
            <Layers3 size={18} />
          </div>
          <div className="preset-grid">
            {presetRows.map((preset) => {
              const done = completionPercent(preset.importedCount, preset.expectedTotal);
              const complete = preset.importedCount >= preset.expectedTotal;

              return (
                <article className="preset-card" key={preset.query}>
                  <div className="preset-card-header">
                    <div>
                      <strong>{preset.label}</strong>
                      <span>{preset.note}</span>
                    </div>
                    <span className={complete ? "tag green" : "tag amber"}>{complete ? "Complete" : "Partial"}</span>
                  </div>
                  <ProgressBar value={done} />
                  <div className="set-stat-row">
                    <span>{preset.importedCount} / {preset.expectedTotal}</span>
                    <span>{preset.query}</span>
                  </div>
                  <div className="actions">
                    <button className="button small" disabled={Boolean(isBusy)} onClick={() => applyPreset(preset)}>
                      <Check size={15} />
                      Use
                    </button>
                    <button className="button small primary" disabled={Boolean(isBusy)} onClick={() => void runPresetJob(preset, "catalogue")}>
                      <Database size={15} />
                      Catalogue
                    </button>
                    <button className="button small" disabled={Boolean(isBusy)} onClick={() => void runPresetJob(preset, "pricing")}>
                      <RefreshCw size={15} />
                      Pricing
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>

        <section className="tool-panel">
          <div className="panel-title-row">
            <h2>Import controls</h2>
            <Database size={18} />
          </div>
          <div className="field-grid">
            <Field label="Job secret">
              <input
                type="password"
                value={jobSecret}
                onChange={(event) => setJobSecret(event.currentTarget.value)}
                placeholder="JOB_SECRET"
              />
            </Field>
            <Field label="Pokemon query">
              <input
                value={query}
                onChange={(event) => setQuery(event.currentTarget.value)}
                placeholder="set.id:sv3pt5"
              />
            </Field>
            <Field label="Page">
              <input
                min={1}
                type="number"
                value={page}
                onChange={(event) => setPage(Math.max(1, Number(event.currentTarget.value) || 1))}
              />
            </Field>
            <Field label="Page size">
              <input
                max={250}
                min={1}
                type="number"
                value={pageSize}
                onChange={(event) => setPageSize(Math.min(250, Math.max(1, Number(event.currentTarget.value) || 1)))}
              />
            </Field>
            <Field label="Max pages">
              <input
                max={20}
                min={1}
                type="number"
                value={maxPages}
                onChange={(event) => setMaxPages(Math.min(20, Math.max(1, Number(event.currentTarget.value) || 1)))}
              />
            </Field>
            <label className="check-row">
              <input
                checked={cardPriceOnlyUnpriced}
                type="checkbox"
                onChange={(event) => setCardPriceOnlyUnpriced(event.currentTarget.checked)}
              />
              <span>Only unpriced cards</span>
            </label>
          </div>
          <div className="ops-subsection">
            <div className="panel-title-row">
              <h3>Sealed pricing</h3>
              <PackagePlus size={17} />
            </div>
            <div className="field-grid">
              <Field label="TCGCSV groups">
                <input
                  value={sealedGroupIds}
                  onChange={(event) => setSealedGroupIds(event.currentTarget.value)}
                  placeholder="Optional IDs"
                />
              </Field>
              <Field label="Group limit">
                <input
                  min={1}
                  type="number"
                  value={sealedGroupLimit}
                  onChange={(event) => setSealedGroupLimit(Math.max(1, Number(event.currentTarget.value) || 1))}
                />
              </Field>
              <Field label="USD to GBP">
                <input
                  inputMode="decimal"
                  value={sealedUsdToGbpRate}
                  onChange={(event) => setSealedUsdToGbpRate(event.currentTarget.value)}
                  placeholder="Env fallback"
                />
              </Field>
              <label className="check-row">
                <input
                  checked={sealedPriceOnlyUnpriced}
                  type="checkbox"
                  onChange={(event) => setSealedPriceOnlyUnpriced(event.currentTarget.checked)}
                />
                <span>Only unpriced</span>
              </label>
            </div>
          </div>
          <div className="actions">
            <button className="button primary" disabled={Boolean(isBusy)} onClick={() => void runJob("catalogue")}>
              <Database size={17} />
              {isBusy === "catalogue" ? "Running" : "Catalogue"}
            </button>
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void runJob("pricing")}>
              <RefreshCw size={17} />
              {isBusy === "pricing" ? "Running" : "Pricing"}
            </button>
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void runJob("sealed")}>
              <PackagePlus size={17} />
              {isBusy === "sealed" ? "Running" : "Sealed pricing"}
            </button>
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void runJob("card-image-repair")}>
              <GalleryVerticalEnd size={17} />
              {isBusy === "card-image-repair" ? "Running" : "Repair card images"}
            </button>
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void runJob("sealed-image-repair")}>
              <GalleryVerticalEnd size={17} />
              {isBusy === "sealed-image-repair" ? "Running" : "Repair sealed images"}
            </button>
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void runJob("variant-metadata-repair")}>
              <Layers3 size={17} />
              {isBusy === "variant-metadata-repair" ? "Running" : "Repair variants"}
            </button>
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void runJob("alerts")}>
              <Mail size={17} />
              {isBusy === "alerts" ? "Running" : "Alert dry run"}
            </button>
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void loadJobRuns()}>
              <History size={17} />
              {isBusy === "runs" ? "Loading" : "Load runs"}
            </button>
          </div>
        </section>

        <section className="tool-panel">
          <div className="panel-title-row">
            <h2>Catalogue status</h2>
            <Database size={18} />
          </div>
          {catalogueStatus?.coveragePercent !== null && catalogueStatus?.coveragePercent !== undefined ? (
            <ProgressBar value={catalogueStatus.coveragePercent} />
          ) : null}
          <MetricList
            rows={[
              ["Cards", catalogueStatus ? `${formatCount(catalogueStatus.cardCount)} / ${formatCount(catalogueStatus.providerTotalCount)}` : formatCount(localCardCount)],
              ["Coverage", formatPercent(catalogueStatus?.coveragePercent)],
              ["Sets", formatCount(catalogueStatus?.setCount)],
              ["Prices", formatCount(catalogueStatus?.priceSnapshotCount)],
              ["Priced cards", catalogueStatus ? `${formatCount(catalogueStatus.pricedCardCount)} (${formatPercent(catalogueStatus.pricingCoveragePercent)})` : "-"],
              ["Card images", catalogueStatus ? `${formatCount(catalogueStatus.cardImageCount)} (${formatPercent(catalogueStatus.cardImageCoveragePercent)})` : "-"],
              ["Variant metadata", catalogueStatus ? `${formatCount(catalogueStatus.cardVariantMetadataCount)} (${formatPercent(catalogueStatus.cardVariantMetadataCoveragePercent)})` : "-"],
              ["Sealed products", formatCount(catalogueStatus?.sealedProductCount)],
              ["Priced sealed", catalogueStatus ? `${formatCount(catalogueStatus.pricedSealedProductCount)} (${formatPercent(catalogueStatus.sealedPricingCoveragePercent)})` : "-"],
              ["Sealed images", catalogueStatus ? `${formatCount(catalogueStatus.sealedImageCount)} (${formatPercent(catalogueStatus.sealedImageCoveragePercent)})` : "-"],
              ["Duplicate IDs", formatCount(catalogueStatus?.duplicateProviderIdCount)],
            ]}
          />
          <button className="button" disabled={Boolean(isBusy)} onClick={() => void loadCatalogueStatus()}>
            <RefreshCw size={17} />
            {isBusy === "status" ? "Loading" : "Load status"}
          </button>
          <button className="button" disabled={Boolean(isBusy)} onClick={() => void exportCatalogueGaps()}>
            <Download size={17} />
            {isBusy === "gap-export" ? "Exporting" : "Export gaps"}
          </button>
          <button className="button" disabled={Boolean(isBusy)} onClick={() => void loadDuplicateProviderReview()}>
            <Search size={17} />
            {isBusy === "duplicate-review" ? "Loading" : "Review duplicates"}
          </button>
        </section>

        <section className="tool-panel">
          <div className="panel-title-row">
            <h2>Merge duplicate</h2>
            <ArrowDownUp size={18} />
          </div>
          <div className="field-grid">
            <Field label="Primary card ID">
              <input
                value={mergePrimaryCardId}
                onChange={(event) => setMergePrimaryCardId(event.currentTarget.value)}
                placeholder="Keep this card"
              />
            </Field>
            <Field label="Duplicate card ID">
              <input
                value={mergeDuplicateCardId}
                onChange={(event) => setMergeDuplicateCardId(event.currentTarget.value)}
                placeholder="Merge and delete this card"
              />
            </Field>
          </div>
          <div className="actions">
            <button className="button" disabled={Boolean(isBusy)} onClick={() => void runDuplicateCardMerge(false)}>
              <Search size={17} />
              {isBusy === "duplicate-merge-dry-run" ? "Checking" : "Dry run"}
            </button>
            <button className="button danger" disabled={Boolean(isBusy)} onClick={() => void runDuplicateCardMerge(true)}>
              <Check size={17} />
              {isBusy === "duplicate-merge" ? "Merging" : "Execute merge"}
            </button>
          </div>
        </section>

        <section className="tool-panel">
          <div className="panel-title-row">
            <h2>Latest result</h2>
            <span className="tag blue">JSON</span>
          </div>
          {latestJobResult ? (
            <div className="job-result-summary">
              <div className="set-stat-row">
                {latestJobResult.report === "duplicate_provider_review" ? (
                  <>
                    <span>{latestJobResult.duplicateGroupCount ?? 0} groups</span>
                    <span>{latestJobResult.duplicateCardCount ?? 0} cards</span>
                    <span>{latestJobResult.highRiskGroupCount ?? 0} high risk</span>
                  </>
                ) : latestJobResult.report === "duplicate_card_merge" ? (
                  <>
                    <span>{latestJobResult.canMerge ? "Mergeable" : "Blocked"}</span>
                    <span>{latestJobResult.collectionItemsToMove ?? latestJobResult.collectionItemsMoved ?? 0} collection</span>
                    <span>{latestJobResult.priceSnapshotsToMove ?? latestJobResult.priceSnapshotsMoved ?? 0} prices</span>
                  </>
                ) : latestJobResult.job === "card_image_repair" ? (
                  <>
                    <span>{latestJobResult.candidatesChecked ?? 0} checked</span>
                    <span>{latestJobResult.cardsUpdated ?? 0} cards</span>
                    <span>{latestJobResult.imageFieldsUpdated ?? 0} fields</span>
                  </>
                ) : latestJobResult.job === "sealed_image_repair" ? (
                  <>
                    <span>{latestJobResult.candidatesChecked ?? 0} checked</span>
                    <span>{latestJobResult.sealedProductsUpdated ?? 0} sealed</span>
                    <span>{latestJobResult.groupsFetched ?? 0} groups</span>
                  </>
                ) : latestJobResult.job === "variant_metadata_repair" ? (
                  <>
                    <span>{latestJobResult.candidatesChecked ?? 0} checked</span>
                    <span>{latestJobResult.cardsUpdated ?? 0} cards</span>
                    <span>{latestJobResult.pokemonTcgCardsFetched ?? 0} fetched</span>
                  </>
                ) : latestJobResult.groupsProcessed !== undefined ? (
                  <>
                    <span>{latestJobResult.groupsProcessed} groups</span>
                    <span>{latestJobResult.sealedProductsUpserted ?? 0} sealed</span>
                    <span>{latestJobResult.productsFetched ?? 0} products</span>
                  </>
                ) : (
                  <>
                    <span>{latestJobResult.pagesProcessed ?? 1} page{(latestJobResult.pagesProcessed ?? 1) === 1 ? "" : "s"}</span>
                    <span>{latestJobResult.cardsUpserted ?? 0} cards</span>
                  </>
                )}
                {latestJobResult.report === "duplicate_provider_review" ? (
                  <span>{latestJobResult.mediumRiskGroupCount ?? 0} medium</span>
                ) : latestJobResult.report === "duplicate_card_merge" ? (
                  <>
                    <span>{latestJobResult.wishlistItemsToMove ?? latestJobResult.wishlistItemsMoved ?? 0} wishlist</span>
                    <span>{latestJobResult.wishlistConflictsToMerge ?? latestJobResult.wishlistConflictsMerged ?? 0} conflicts</span>
                    <span>{latestJobResult.mode ?? "dry_run"}</span>
                  </>
                ) : latestJobResult.job === "card_image_repair" ? (
                  <span>{latestJobResult.repairableCards ?? 0} repairable</span>
                ) : latestJobResult.job === "sealed_image_repair" ? (
                  <span>{latestJobResult.repairableProducts ?? 0} repairable</span>
                ) : latestJobResult.job === "variant_metadata_repair" ? (
                  <span>{latestJobResult.repairableCards ?? 0} repairable</span>
                ) : (
                  <span>{latestJobResult.pricingSnapshotsCreated ?? 0} prices</span>
                )}
                {latestJobResult.complete !== undefined ? (
                  <span>{latestJobResult.complete ? "Complete" : `Next page ${latestJobResult.nextPage ?? "-"}`}</span>
                ) : null}
              </div>
              {resumableJob ? (
                <button className="button primary" disabled={Boolean(isBusy)} onClick={() => void resumeLatestJob()}>
                  <RefreshCw size={17} />
                  Resume page {resumableJob.nextPage}
                </button>
              ) : null}
            </div>
          ) : null}
          <pre className="json-preview">{formatJsonPreview(lastResult ?? { status: "No job run yet." })}</pre>
        </section>
      </div>

      {duplicateProviderReview ? (
        <DuplicateProviderReviewPanel
          report={duplicateProviderReview}
          onPrepareMerge={prepareDuplicateMerge}
        />
      ) : null}

      <div className="operations-breakdowns">
        <GapRecommendationsPanel
          disabled={Boolean(isBusy)}
          recommendations={gapRecommendations}
          onRun={(recommendation) => void runGapRecommendation(recommendation)}
        />
        <PricingSeriesGapPanel rows={catalogueStatus?.pricingBySeries ?? []} />
        <SealedPricingGapPanel rows={catalogueStatus?.sealedPricingByProductType ?? []} />
        <CatalogueMediaGapPanel status={catalogueStatus} />
        <PricingSourcePanel rows={catalogueStatus?.pricingBySource ?? []} />
      </div>

      <section className="tool-panel">
        <div className="panel-title-row">
          <h2>Job runs</h2>
          <History size={18} />
        </div>
        {jobRuns.length ? (
          <div className="job-run-list">
            {jobRuns.map((run) => (
              <article className="job-run-row" key={run.id}>
                <div>
                  <div className="tag-row">
                    <span className={`tag ${jobStatusClass(run.status)}`}>{run.status}</span>
                    <span className="tag">{jobTypeLabel(run.jobType)}</span>
                  </div>
                  <strong>{formatEventDate(run.startedAt)}</strong>
                  <p className="muted">
                    {run.durationMs === undefined ? "In progress" : `${run.durationMs}ms`}
                    {run.errorMessage ? ` | ${run.errorMessage}` : ""}
                  </p>
                </div>
                <code>{run.id.slice(0, 8)}</code>
              </article>
            ))}
          </div>
        ) : (
          <p className="muted">No job runs loaded.</p>
        )}
      </section>
    </section>
  );
}

function GapRecommendationsPanel({
  disabled,
  onRun,
  recommendations,
}: {
  disabled: boolean;
  onRun: (recommendation: CatalogueGapRecommendation) => void;
  recommendations: CatalogueGapRecommendation[];
}) {
  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Recommended next</h2>
        <Sparkles size={18} />
      </div>
      {recommendations.length ? (
        <div className="gap-list">
          {recommendations.map((recommendation) => (
            <article className="gap-row recommendation-row" key={recommendation.id}>
              <div className="gap-copy">
                <div className="tag-row">
                  <span className={`tag ${recommendationPriorityClass(recommendation.priority)}`}>
                    {recommendation.priority}
                  </span>
                  <span className="tag">{recommendationTypeLabel(recommendation.type)}</span>
                </div>
                <strong>{recommendation.title}</strong>
                <span>{recommendation.detail}</span>
              </div>
              {recommendationActionLabel(recommendation) ? (
                <button className="button small" disabled={disabled} onClick={() => onRun(recommendation)}>
                  <RefreshCw size={15} />
                  {recommendationActionLabel(recommendation)}
                </button>
              ) : null}
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">Load catalogue status to see recommended next actions.</p>
      )}
    </section>
  );
}

function DuplicateProviderReviewPanel({
  onPrepareMerge,
  report,
}: {
  onPrepareMerge: (primaryCardId: string, duplicateCardId: string) => void;
  report: DuplicateProviderReview;
}) {
  return (
    <section className="tool-panel duplicate-review-panel">
      <div className="panel-title-row">
        <h2>Duplicate groups</h2>
        <span className="status-pill">{report.duplicateGroupCount} groups</span>
      </div>
      {report.groups.length ? (
        <div className="duplicate-group-list">
          {report.groups.slice(0, 12).map((group) => (
            <DuplicateProviderGroupReview
              group={group}
              key={group.providerId}
              onPrepareMerge={onPrepareMerge}
            />
          ))}
        </div>
      ) : (
        <p className="muted">No duplicate provider IDs in the latest report.</p>
      )}
    </section>
  );
}

function DuplicateProviderGroupReview({
  group,
  onPrepareMerge,
}: {
  group: DuplicateProviderReviewGroup;
  onPrepareMerge: (primaryCardId: string, duplicateCardId: string) => void;
}) {
  const primaryCardId = group.suggestedPrimaryCardId || group.cards[0]?.id || "";

  return (
    <article className="duplicate-group-row">
      <div className="duplicate-group-header">
        <div className="gap-copy">
          <div className="tag-row">
            <span className={`tag ${duplicateRiskClass(group.riskLevel)}`}>{group.riskLevel}</span>
            <span className="tag">{group.providerId}</span>
          </div>
          <strong>{group.cardCount} matching card rows</strong>
          <span>{group.collectionCount} collection | {group.wishlistCount} wishlist | {group.priceSnapshotCount} prices</span>
        </div>
      </div>
      <div className="duplicate-card-list">
        {group.cards.map((card) => (
          <DuplicateProviderCardReview
            card={card}
            isPrimary={card.id === primaryCardId}
            key={card.id}
            onPrepareMerge={onPrepareMerge}
            primaryCardId={primaryCardId}
          />
        ))}
      </div>
    </article>
  );
}

function DuplicateProviderCardReview({
  card,
  isPrimary,
  onPrepareMerge,
  primaryCardId,
}: {
  card: DuplicateProviderReviewCard;
  isPrimary: boolean;
  onPrepareMerge: (primaryCardId: string, duplicateCardId: string) => void;
  primaryCardId: string;
}) {
  return (
    <article className="duplicate-card-row">
      <div className="duplicate-card-thumb">
        {card.imageSmallUrl || card.imageLargeUrl ? (
          <Image
            src={card.imageSmallUrl ?? card.imageLargeUrl!}
            alt={card.name}
            fill
            sizes="52px"
          />
        ) : (
          <span>{card.name.slice(0, 1)}</span>
        )}
      </div>
      <div className="duplicate-card-copy">
        <div className="tag-row">
          {isPrimary ? <span className="tag green">primary</span> : <span className="tag">duplicate</span>}
          <span className="tag">{card.number}</span>
          {card.rarity ? <span className="tag blue">{card.rarity}</span> : null}
        </div>
        <strong>{card.name}</strong>
        <span>{card.setName}{card.series ? ` | ${card.series}` : ""}</span>
        <code>{card.id}</code>
      </div>
      <div className="duplicate-card-metrics">
        <span>{card.collectionCount} collection</span>
        <span>{card.wishlistCount} wishlist</span>
        <span>{card.priceSnapshotCount} prices</span>
      </div>
      {isPrimary ? (
        <span className="status-pill">Keep</span>
      ) : (
        <button
          className="button small"
          disabled={!primaryCardId}
          onClick={() => onPrepareMerge(primaryCardId, card.id)}
        >
          <ArrowDownUp size={15} />
          Prepare
        </button>
      )}
    </article>
  );
}

function PricingSeriesGapPanel({ rows }: { rows: PricingBySeriesGap[] }) {
  const visibleRows = rows.filter((row) => row.unpricedCardCount > 0).slice(0, 8);

  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Card pricing gaps</h2>
        <BarChart3 size={18} />
      </div>
      {visibleRows.length ? (
        <div className="gap-list">
          {visibleRows.map((row) => (
            <CoverageGapRow
              key={row.series}
              coverage={row.pricingCoveragePercent}
              label={row.series}
              priced={row.pricedCardCount}
              total={row.cardCount}
              unpriced={row.unpricedCardCount}
            />
          ))}
        </div>
      ) : (
        <p className="muted">No card pricing gaps loaded.</p>
      )}
    </section>
  );
}

function SealedPricingGapPanel({ rows }: { rows: SealedPricingByProductTypeGap[] }) {
  const visibleRows = rows.filter((row) => row.unpricedSealedProductCount > 0).slice(0, 8);

  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Sealed gaps</h2>
        <PackagePlus size={18} />
      </div>
      {visibleRows.length ? (
        <div className="gap-list">
          {visibleRows.map((row) => (
            <CoverageGapRow
              key={row.productType}
              coverage={row.sealedPricingCoveragePercent}
              label={productTypeLabel(row.productType)}
              priced={row.pricedSealedProductCount}
              total={row.sealedProductCount}
              unpriced={row.unpricedSealedProductCount}
            />
          ))}
        </div>
      ) : (
        <p className="muted">No sealed pricing gaps loaded.</p>
      )}
    </section>
  );
}

function CatalogueMediaGapPanel({ status }: { status?: CatalogueStatusRecord | null }) {
  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Media & variants</h2>
        <GalleryVerticalEnd size={18} />
      </div>
      {status ? (
        <div className="gap-list">
          <CoverageGapRow
            coverage={status.cardImageCoveragePercent}
            gapLabel="missing images"
            label="Card images"
            priced={status.cardImageCount}
            total={status.cardCount}
            unpriced={status.cardMissingImageCount}
          />
          <CoverageGapRow
            coverage={status.sealedImageCoveragePercent}
            gapLabel="missing images"
            label="Sealed images"
            priced={status.sealedImageCount}
            total={status.sealedProductCount}
            unpriced={status.sealedMissingImageCount}
          />
          <CoverageGapRow
            coverage={status.cardVariantMetadataCoveragePercent}
            gapLabel="without metadata"
            label="Variant metadata"
            priced={status.cardVariantMetadataCount}
            total={status.cardCount}
            unpriced={status.cardMissingVariantMetadataCount}
          />
        </div>
      ) : (
        <p className="muted">No media coverage rows loaded.</p>
      )}
    </section>
  );
}

function PricingSourcePanel({ rows }: { rows: PricingBySourceSummary[] }) {
  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Price sources</h2>
        <Database size={18} />
      </div>
      {rows.length ? (
        <div className="gap-list">
          {rows.slice(0, 8).map((row) => (
            <article className="gap-row" key={`${row.source}-${row.itemType}`}>
              <div className="gap-copy">
                <strong>{priceSourceLabel(row.source)}</strong>
                <span>{itemTypeLabel(row.itemType)}</span>
              </div>
              <div className="gap-metrics">
                <span>{formatCount(row.priceSnapshotCount)} snapshots</span>
                <span>{formatCount(row.pricedItemCount)} items</span>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">No price source rows loaded.</p>
      )}
    </section>
  );
}

function CoverageGapRow({
  coverage,
  gapLabel = "unpriced",
  label,
  priced,
  total,
  unpriced,
}: {
  coverage: number | null;
  gapLabel?: string;
  label: string;
  priced: number;
  total: number;
  unpriced: number;
}) {
  return (
    <article className="gap-row">
      <div className="gap-copy">
        <strong>{label}</strong>
        <span>{formatCount(unpriced)} {gapLabel}</span>
      </div>
      <div className="gap-meter">
        <ProgressBar value={coverage ?? 0} />
        <span>
          {formatPercent(coverage)} | {formatCount(priced)} / {formatCount(total)}
        </span>
      </div>
    </article>
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
  importCollectionCsv,
  navigate,
  setThemeId,
  themeId,
}: ScreenContext) {
  return (
    <section className="page">
      <PageHeader title="Settings" />
      <div className="screen-split">
        <MetricPanel
          title="Profile"
          rows={[
            ["Name", viewer.name],
            ["Email", viewer.email],
            ["Role", viewer.role === "ADMIN" ? "Admin" : "User"],
            ["Currency", "GBP"],
            ["Region", "United Kingdom"],
          ]}
        />
        <MetricPanel
          title="Subscription"
          rows={[
            ["Plan", appState.plus ? "Plus" : "Free"],
            ["Billing", billingStatusLabel(subscription)],
          ]}
        />
        <ThemePanel
          plus={appState.plus}
          selectedThemeId={themeId}
          onSelectTheme={setThemeId}
          onStartCheckout={startPlusCheckout}
        />
        <BillingPanel
          plus={appState.plus}
          subscription={subscription}
          onCancelSubscription={cancelPlusSubscription}
          onOpenBillingPortal={openBillingPortal}
          onStartCheckout={startPlusCheckout}
        />
        <PlanComparisonPanel
          plus={appState.plus}
          onStartCheckout={startPlusCheckout}
        />
        <NotificationPreferencesPanel
          plus={appState.plus}
          preferences={notificationPreferences}
          onUpdate={updateNotificationPreferences}
        />
        {canUseOperations(viewer.role) ? <OperationsEntryPanel onOpen={() => navigate("ops")} /> : null}
        <MetricPanel
          title="Data source"
          rows={[
            ["Mode", isLoadingData ? "Loading" : dataSource === "database" ? "Prisma database" : "Sample fallback"],
            ["Status", dataNotice || "Connected"],
          ]}
        />
        <DataPanel
          plus={appState.plus}
          onExportCollection={exportCollectionCsv}
          onExportInsuranceReport={exportInsuranceReport}
          onDownloadTemplate={downloadImportTemplate}
          onImportCollection={importCollectionCsv}
          onResetSampleData={resetSampleData}
        />
        <StoragePanel
          locations={storageLocations}
          onCreate={createStorageLocation}
          onDelete={deleteStorageLocation}
        />
      </div>
    </section>
  );
}

function ActionQueue({ actions }: { actions: InsightAction[] }) {
  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Action queue</h2>
        <Sparkles size={18} />
      </div>
      {actions.length ? (
        <div className="insight-list">
          {actions.map((action) => (
            <article className="insight-row" key={action.title}>
              <span className={`tag ${actionTagClass(action.tone)}`}>{action.tone}</span>
              <div>
                <strong>{action.title}</strong>
                <p className="muted">{action.detail}</p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">No obvious actions right now.</p>
      )}
    </section>
  );
}

function TopHoldings({ holdings }: { holdings: HoldingInsight[] }) {
  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Top holdings</h2>
        <Layers3 size={18} />
      </div>
      {holdings.length ? (
        <div className="metric-list">
          {holdings.slice(0, 5).map((holding) => (
            <div className="metric-row" key={holding.id}>
              <span>{holding.name}</span>
              <strong>{formatMoney(holding.valueMinor)}</strong>
            </div>
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
  const first = history[0];
  const latest = history[history.length - 1];
  const high = portfolioHistoryExtreme(history, "high");
  const low = portfolioHistoryExtreme(history, "low");
  const delta = portfolioHistoryDelta(history);

  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Portfolio value path</h2>
        <span className="status-pill">{latest ? `${history.length} points` : "No history"}</span>
      </div>
      {history.length > 1 ? (
        <MiniChart label="Portfolio value history chart" values={history.map((point) => point.valueMinor)} />
      ) : (
        <p className="muted">Run pricing imports to build a dated portfolio value history.</p>
      )}
      <MetricList
        rows={[
          ["Latest value", latest ? formatMoney(latest.valueMinor) : formatMoney(currentValueMinor)],
          [
            "Since first",
            delta === null ? "Unknown" : formatSignedMoney(delta),
            delta !== null && delta >= 0 ? "positive" : "",
          ],
          ["First point", first ? formatEventDate(first.observedAt) : "Unknown"],
          ["Latest point", latest ? formatEventDate(latest.observedAt) : "Unknown"],
          ["High", high ? formatMoney(high.valueMinor) : "Unknown"],
          ["Low", low ? formatMoney(low.valueMinor) : "Unknown"],
          [
            "Latest mix",
            latest
              ? `${formatMoney(latest.marketValueMinor)} market | ${formatMoney(latest.manualValueMinor)} manual`
              : "Unknown",
          ],
          [
            "Valued lots",
            latest
              ? `${latest.valuedLots} total | ${latest.marketLots} market | ${latest.manualLots} manual`
              : "Unknown",
          ],
        ]}
      />
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
        <div className="bar-list">
          {rows.map((row) => (
            <div className="bar-row" key={row.label}>
              <div className="bar-label">
                <strong>{row.label}</strong>
                <span>{formatMoney(row.valueMinor)} | {row.share}%</span>
              </div>
              <div className="bar-track">
                <span style={{ width: `${Math.max(4, row.share)}%` }} />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No portfolio mix yet.</p>
      )}
    </section>
  );
}

function SalesLedger({
  realizedSales,
}: {
  realizedSales: CollectionIntelligence["realizedSales"];
}) {
  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Realised sales</h2>
        <History size={18} />
      </div>
      <MetricList
        rows={[
          ["Proceeds", formatMoney(realizedSales.proceedsMinor)],
          [
            "Known basis",
            `${formatMoney(realizedSales.basisMinor)} (${realizedSales.knownBasisCount}/${realizedSales.count})`,
          ],
          [
            "Realised gain",
            formatMoney(realizedSales.gainMinor),
            realizedSales.gainMinor >= 0 ? "positive" : "",
          ],
        ]}
      />
      {realizedSales.sales.length ? (
        <div className="insight-list">
          {realizedSales.sales.map((sale) => (
            <article className="insight-row" key={sale.id}>
              <span className={`tag ${sale.gainMinor === null ? "amber" : sale.gainMinor >= 0 ? "green" : "red"}`}>
                {sale.gainMinor === null ? "Basis" : sale.gainMinor >= 0 ? "Gain" : "Loss"}
              </span>
              <div>
                <strong>{sale.itemName}</strong>
                <p className="muted">
                  {formatMoney(sale.amountMinor)} | {sale.quantity ? `Qty ${sale.quantity} | ` : ""}
                  {sale.gainMinor === null ? "No basis" : formatMoney(sale.gainMinor)} | {formatEventDate(sale.occurredAt)}
                </p>
              </div>
            </article>
          ))}
        </div>
      ) : (
        <p className="muted">Record a sale from an item detail page to build realised performance history.</p>
      )}
    </section>
  );
}

function WishlistOpportunities({
  opportunities,
}: {
  opportunities: WishlistOpportunity[];
}) {
  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Wishlist targets</h2>
        <Heart size={18} />
      </div>
      {opportunities.length ? (
        <div className="metric-list">
          {opportunities.map((opportunity) => (
            <div className="metric-row" key={opportunity.id}>
              <span>{opportunity.name}</span>
              <strong>{formatMoney(opportunity.currentValueMinor)}</strong>
            </div>
          ))}
        </div>
      ) : (
        <p className="muted">No wishlist items are at target right now.</p>
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
          {plus ? "Plus palette" : "Light and dark"}
        </span>
      </div>
      <p className="muted">
        Free includes Light and Dark. Plus unlocks collector colour schemes for a more personal workspace.
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
            <p className="muted">Plus adds a dozen extra schemes alongside analytics, alerts, and reports.</p>
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

function PlanComparisonPanel({
  plus,
  onStartCheckout,
}: {
  plus: boolean;
  onStartCheckout: (plan: "monthly" | "yearly") => Promise<void>;
}) {
  return (
    <section className="tool-panel plan-comparison-panel">
      <div className="panel-title-row">
        <h2>Free vs Plus</h2>
        <span className="tag blue">Current beta split</span>
      </div>
      <div className="plan-comparison">
        <article className={plus ? "plan-card" : "plan-card current"}>
          <div className="plan-card-head">
            <div>
              <span className="tag">Free</span>
              <strong>Core collection tracking</strong>
            </div>
            {!plus ? <span className="status-pill"><Check size={16} />Current</span> : null}
          </div>
          <ul>
            {freePlanFeatures.map((feature) => (
              <li key={feature}>
                <Check size={16} />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
        </article>
        <article className={plus ? "plan-card featured current" : "plan-card featured"}>
          <div className="plan-card-head">
            <div>
              <span className="tag green">Plus</span>
              <strong>GBP 2.49 monthly or GBP 19.99 yearly</strong>
            </div>
            {plus ? <span className="status-pill"><Sparkles size={16} />Active</span> : null}
          </div>
          <ul>
            {plusPlanFeatures.map((feature) => (
              <li key={feature}>
                <Sparkles size={16} />
                <span>{feature}</span>
              </li>
            ))}
          </ul>
          {!plus ? (
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
          ) : null}
        </article>
      </div>
    </section>
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
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Billing</h2>
        {plus ? <span className="plan-pill"><Sparkles size={17} />Plus</span> : <span className="plan-pill"><Lock size={17} />Free</span>}
      </div>
      <p className="muted">
        {plus
          ? "Your Plus tools are active. Manage renewals, cards, and invoices through billing settings."
          : "Upgrade when you want price-alert emails, insurance exports, and deeper collection analytics."}
      </p>
      <div className="billing-status">
        <span><CreditCard size={16} />{billingProviderLabel(subscription.provider)}</span>
        <span><Check size={16} />{billingStatusLabel(subscription)}</span>
        {periodLabel ? <span><RefreshCw size={16} />{periodLabel}</span> : null}
      </div>
      <div className="billing-plan-grid">
        <article className="billing-plan">
          <div>
            <span className="tag">Monthly</span>
            <strong>GBP 2.49</strong>
          </div>
          <button className="button primary" onClick={() => void onStartCheckout("monthly")} disabled={plus}>
            <CreditCard size={17} />
            Start monthly
          </button>
        </article>
        <article className="billing-plan featured">
          <div>
            <span className="tag green">Best value</span>
            <strong>GBP 19.99</strong>
          </div>
          <button className="button" onClick={() => void onStartCheckout("yearly")} disabled={plus}>
            <Sparkles size={17} />
            Start yearly
          </button>
        </article>
      </div>
      <div className="feature-list">
        <span><Bell size={16} />Price alert emails</span>
        <span><ShieldCheck size={16} />Insurance report export</span>
        <span><RefreshCw size={16} />Automated price refreshes</span>
        <span><Mail size={16} />Wishlist target digests</span>
      </div>
      <div className="actions">
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
  onImportCollection,
  onResetSampleData,
}: {
  plus: boolean;
  onExportCollection: () => void;
  onExportInsuranceReport: () => Promise<void>;
  onDownloadTemplate: () => void;
  onImportCollection: (file: File) => Promise<boolean>;
  onResetSampleData: () => void;
}) {
  const [isImporting, setIsImporting] = useState(false);

  async function handleImportChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.currentTarget.files?.[0];

    if (!file) {
      return;
    }

    setIsImporting(true);
    await onImportCollection(file);
    setIsImporting(false);
    event.currentTarget.value = "";
  }

  return (
    <section className="tool-panel">
      <h2>Data</h2>
      <div className="actions">
        <button className="button" onClick={onExportCollection}>
          <Download size={17} />
          Export CSV
        </button>
        <button className={plus ? "button" : "button danger"} onClick={() => void onExportInsuranceReport()}>
          {plus ? <Download size={17} /> : <Lock size={17} />}
          Insurance report
        </button>
        <label className="button file-button">
          <Upload size={17} />
          {isImporting ? "Importing" : "Import CSV"}
          <input
            type="file"
            accept=".csv,text/csv"
            disabled={isImporting}
            onChange={handleImportChange}
          />
        </label>
        <button className="button" onClick={onDownloadTemplate}>
          <Download size={17} />
          Template CSV
        </button>
        <button className="button" onClick={onResetSampleData}>
          Reset sample
        </button>
      </div>
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
    setIsSaving(true);
    const created = await onCreate(new FormData(event.currentTarget));
    setIsSaving(false);

    if (created) {
      event.currentTarget.reset();
    }
  }

  async function handleDelete(location: StorageLocation) {
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
            <th>Type</th>
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
              <tr key={item.id}>
                <td>
                  <div className="table-item">
                    <div className="table-thumb">{renderItemImage(catalogueItem)}</div>
                    <div>
                      <strong>{catalogueItem.name}</strong>
                      <span>{catalogueItem.set} | {catalogueItem.number}</span>
                    </div>
                  </div>
                </td>
                <td>{catalogueItem.type === "sealed" ? "Sealed" : "Card"}</td>
                <td>{item.condition}</td>
                <td>{item.quantity}</td>
                <td>{formatMoney(item.purchasePriceMinor)}</td>
                <td><strong>{formatValuation(getOwnedValue(item, catalogueItem))}</strong></td>
                <td>{item.location}</td>
                <td><button className="button" onClick={() => openItem(item.id)}>Open</button></td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
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

  return (
    <button className="item-card clickable" onClick={onClick}>
      <div className="item-image">{renderItemImage(catalogueItem)}</div>
      <div className="item-main">
        <div className="item-title-row">
          <div>
            <h3>{catalogueItem.name}</h3>
            <p className="muted">{catalogueItem.set} | {catalogueItem.number}</p>
          </div>
          <span className={valuationPillClass(catalogueItem, item)}>{valuationStatusLabel(catalogueItem, item)}</span>
        </div>
        <div className="tag-row">
          <span className="tag">{item.condition}</span>
          <span className="tag">{item.language}</span>
          <span className="tag blue">Qty {item.quantity}</span>
        </div>
        <p className="item-value">{formatValuation(getOwnedValue(item, catalogueItem))}</p>
      </div>
    </button>
  );
}

function CatalogueResult({
  item,
  selected,
  onClick,
}: {
  item: CatalogueItem;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button className={selected ? "item-card clickable selected" : "item-card clickable"} onClick={onClick}>
      <div className="item-image">{renderItemImage(item)}</div>
      <div className="item-main">
        <div className="item-title-row">
          <div>
            <h3>{item.name}</h3>
            <p className="muted">{item.set} | {item.number}</p>
          </div>
          <span className={selected ? "tag green" : "tag"}>{selected ? "Selected" : item.rarity}</span>
        </div>
        <p className="item-value">{formatValuation(catalogueMarketValueMinor(item))}</p>
        {item.variantOptions?.length ? (
          <div className="tag-row">
            {item.variantOptions.slice(0, 3).map((option) => (
              <span className="tag" key={option.label}>{option.label}</span>
            ))}
          </div>
        ) : null}
      </div>
    </button>
  );
}

function CataloguePreview({ item }: { item: CatalogueItem }) {
  const variants = item.variantOptions ?? [];

  return (
    <div className="selected-preview">
      <div className="item-image">{renderItemImage(item)}</div>
      <div>
        <h3>{item.name}</h3>
        <p className="muted">{item.set} | {item.number}</p>
        <div className="tag-row">
          <span className="tag">{item.rarity}</span>
          <span className={valuationTagClass(item)}>{valuationStatusLabel(item)}</span>
        </div>
        {variants.length ? (
          <div className="tag-row">
            {variants.slice(0, 3).map((option) => (
              <span className="tag" key={option.label}>
                {option.valueMinor === undefined ? option.label : `${option.label} ${formatMoney(option.valueMinor)}`}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function VariantSelect({
  defaultValue,
  item,
  name = "variant",
}: {
  defaultValue?: string;
  item: CatalogueItem;
  name?: string;
}) {
  const options = catalogueVariantLabels(item, defaultValue);

  return (
    <select name={name} defaultValue={defaultValue ?? options[0]}>
      {options.map((option) => (
        <option key={option}>{option}</option>
      ))}
    </select>
  );
}

function SetProgressCard({ set, onClick }: { set: SetProgress; onClick: () => void }) {
  const done = completionPercent(set.owned, set.total);

  return (
    <button className="set-card" onClick={onClick}>
      <div className="set-card-header">
        <div>
          <strong>{set.name}</strong>
          <span>{set.owned} / {set.total} owned</span>
        </div>
        <b>{done}%</b>
      </div>
      <ProgressBar value={done} />
    </button>
  );
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

function MiniChart({ label = "Value trend chart", values }: { label?: string; values?: number[] }) {
  const source = values?.filter((value) => Number.isFinite(value)) ?? [];
  const max = Math.max(...source, 1);
  const chartValues = source.length ? source : [0];

  return (
    <div
      aria-label={label}
      className={`mini-chart${source.length ? "" : " empty"}`}
      style={{ "--chart-count": chartValues.length } as CSSProperties}
    >
      {chartValues.map((value, index) => (
        <span
          key={`${value}-${index}`}
          style={{ height: `${Math.max(14, Math.round((value / max) * 100))}%` }}
        />
      ))}
    </div>
  );
}

function PriceTrendPanel({
  item,
  overrideValueMinor,
}: {
  item: CatalogueItem;
  overrideValueMinor?: number;
}) {
  const history = item.priceHistory ?? [];
  const latest = history[history.length - 1];
  const first = history[0];
  const range = priceRangeMinor(history);
  const delta = latest && first ? latest.valueMinor - first.valueMinor : null;
  const source = latest?.source ?? item.priceSource;
  const observedAt = latest?.observedAt ?? item.priceObservedAt;
  const latestMarketValue = latest?.valueMinor ?? catalogueMarketValueMinor(item);

  return (
    <section className="tool-panel">
      <div className="panel-title-row">
        <h2>Price history</h2>
        <BarChart3 size={18} />
      </div>
      {history.length > 1 ? (
        <MiniChart values={history.map((point) => point.valueMinor)} />
      ) : (
        <p className="muted">No price history yet.</p>
      )}
      <MetricList
        rows={[
          ["Latest market", formatValuation(latestMarketValue)],
          ["Range", range ? `${formatMoney(range.low)} - ${formatMoney(range.high)}` : "Unknown"],
          [
            "Since first",
            delta === null ? "Unknown" : `${delta >= 0 ? "+" : ""}${formatMoney(delta)}`,
            delta !== null && delta >= 0 ? "positive" : "",
          ],
          ["Observed", observedAt ? formatEventDate(observedAt) : "Unknown"],
          ["Source", item.hasPrice ? priceSourceLabel(source) : "No market source"],
          ...(overrideValueMinor === undefined
            ? []
            : [["Displayed value", "Manual estimate"] as [string, ReactNode, string?]]),
        ]}
      />
    </section>
  );
}

function ProgressBar({ value }: { value: number }) {
  return (
    <div className="progress">
      <span style={{ width: `${value}%` }} />
    </div>
  );
}

function renderItemImage(item: CatalogueItem) {
  if (item.image) {
    return <Image className="asset-image" src={item.image} alt={item.name} fill sizes="(min-width: 760px) 340px, 96px" />;
  }

  if (item.type === "sealed") {
    return (
      <span className="sealed-art">
        <Boxes size={22} />
        {item.name}
      </span>
    );
  }

  return <span className="image-fallback">No image</span>;
}

function getOwnedValue(item: CollectionItem, catalogueItem?: CatalogueItem) {
  if (!catalogueItem) {
    return null;
  }

  const marketValueMinor = catalogueMarketValueMinor(catalogueItem, item.variant);

  return item.overrideValueMinor ?? (marketValueMinor === null ? null : marketValueMinor * item.quantity);
}

function catalogueMarketValueMinor(item: CatalogueItem, variant?: string) {
  if (!item.hasPrice) {
    return null;
  }

  return catalogueValueMinorForVariant(item, variant);
}

function formatValuation(valueMinor?: number | null) {
  return valueMinor === null || valueMinor === undefined ? "Needs estimate" : formatMoney(valueMinor);
}

function valuationStatusLabel(item: CatalogueItem, owned?: CollectionItem) {
  if (owned?.overrideValueMinor !== undefined) {
    return "Manual";
  }

  return item.hasPrice ? item.confidence : "Needs estimate";
}

function valuationPillClass(item: CatalogueItem, owned?: CollectionItem) {
  if (owned?.overrideValueMinor !== undefined) {
    return "confidence-pill manual";
  }

  return item.hasPrice ? "confidence-pill" : "confidence-pill missing";
}

function valuationTagClass(item: CatalogueItem, owned?: CollectionItem) {
  if (owned?.overrideValueMinor !== undefined) {
    return "tag green";
  }

  return item.hasPrice ? "tag blue" : "tag amber";
}

function valuationSourceLabel(item: CatalogueItem, owned?: CollectionItem) {
  if (owned?.overrideValueMinor !== undefined) {
    return "Manual estimate";
  }

  return item.hasPrice ? priceSourceLabel(item.priceSource) : "Needs estimate";
}

function valuationObservedLabel(item: CatalogueItem, owned?: CollectionItem) {
  if (owned?.overrideValueMinor !== undefined) {
    return "Manual estimate";
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

function portfolioHistoryDelta(history: CollectionIntelligence["portfolioHistory"]) {
  const first = history[0];
  const latest = history[history.length - 1];

  return first && latest ? latest.valueMinor - first.valueMinor : null;
}

function portfolioHistoryExtreme(
  history: CollectionIntelligence["portfolioHistory"],
  kind: "high" | "low",
) {
  return history.reduce<CollectionIntelligence["portfolioHistory"][number] | undefined>((selected, point) => {
    if (!selected) {
      return point;
    }

    return kind === "high"
      ? point.valueMinor > selected.valueMinor ? point : selected
      : point.valueMinor < selected.valueMinor ? point : selected;
  }, undefined);
}

function formatSignedMoney(valueMinor: number) {
  const prefix = valueMinor > 0 ? "+" : "";

  return `${prefix}${formatMoney(valueMinor)}`;
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

function jobHeaders(secret: string) {
  return {
    authorization: `Bearer ${secret.trim()}`,
  };
}

function jobStatusClass(status: JobStatus) {
  if (status === "succeeded") {
    return "green";
  }

  if (status === "failed") {
    return "red";
  }

  return "blue";
}

function priceAlertFacts(alert: CollectionIntelligence["priceAlerts"][number]) {
  const facts: Array<[string, string]> = [
    ["Reason", alert.explanation],
    ["Current", formatMoney(alert.currentValueMinor)],
  ];

  if (alert.targetValueMinor !== undefined) {
    facts.push(["Target", formatMoney(alert.targetValueMinor)]);
  }

  if (alert.status === "Watch" && alert.watchBandMinor !== undefined) {
    facts.push(["Watch band", formatMoney(alert.watchBandMinor)]);
  }

  if (alert.priceSource) {
    facts.push(["Source", priceSourceLabel(alert.priceSource)]);
  }

  if (alert.priceObservedAt) {
    facts.push(["Observed", formatEventDate(alert.priceObservedAt)]);
  }

  return facts;
}

function jobTypeLabel(type: JobType) {
  if (type === "catalogue_refresh") {
    return "Catalogue";
  }

  if (type === "pricing_refresh") {
    return "Pricing";
  }

  if (type === "sealed_pricing_refresh") {
    return "Sealed pricing";
  }

  return "Price alerts";
}

function recommendationActionLabel(recommendation: CatalogueGapRecommendation) {
  if (recommendation.type === "duplicate_review") {
    return "Review";
  }

  if (recommendation.type === "catalogue_resume") {
    return "Resume";
  }

  if (recommendation.type === "card_pricing") {
    return "Run pricing";
  }

  if (recommendation.type === "sealed_pricing") {
    return "Run sealed";
  }

  if (recommendation.type === "card_image_refresh") {
    return "Repair cards";
  }

  if (recommendation.type === "sealed_image_refresh") {
    return "Repair sealed";
  }

  if (recommendation.type === "variant_metadata_refresh") {
    return "Repair variants";
  }

  return "";
}

function recommendationPriorityClass(priority: CatalogueGapRecommendation["priority"]) {
  if (priority === "high") {
    return "red";
  }

  if (priority === "medium") {
    return "amber";
  }

  return "green";
}

function duplicateRiskClass(risk: DuplicateProviderReviewGroup["riskLevel"]) {
  if (risk === "high") {
    return "red";
  }

  if (risk === "medium") {
    return "amber";
  }

  return "green";
}

function recommendationTypeLabel(type: CatalogueGapRecommendation["type"]) {
  if (type === "card_image_refresh" || type === "sealed_image_refresh") {
    return "Images";
  }

  if (type === "card_pricing") {
    return "Cards";
  }

  if (type === "catalogue_resume") {
    return "Catalogue";
  }

  if (type === "sealed_pricing") {
    return "Sealed";
  }

  if (type === "variant_metadata_refresh") {
    return "Variants";
  }

  if (type === "duplicate_review") {
    return "Review";
  }

  return "Health";
}

function itemTypeLabel(type: string) {
  if (type === "sealed_product") {
    return "Sealed";
  }

  if (type === "card") {
    return "Cards";
  }

  return startCase(type);
}

function priceSourceLabel(source?: string | null) {
  if (!source) {
    return "Unknown";
  }

  if (source === "pokemon-tcg-api") {
    return "Pokemon TCG API";
  }

  if (source === "pokemon-tcg-api-cardmarket") {
    return "Cardmarket";
  }

  if (source === "tcgcsv") {
    return "TCGCSV";
  }

  if (source === "tcgcsv-card") {
    return "TCGCSV card";
  }

  if (source === "pricecharting-sealed") {
    return "PriceCharting sealed";
  }

  return startCase(source);
}

function productTypeLabel(type: string) {
  return startCase(type);
}

function startCase(value: string) {
  return value
    .replace(/[-_]+/g, " ")
    .replace(/\w\S*/g, (word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase());
}

function formatJsonPreview(value: unknown) {
  return JSON.stringify(value, null, 2);
}

function formatCount(value?: number | null) {
  return typeof value === "number" ? new Intl.NumberFormat("en-GB").format(value) : "-";
}

function formatPercent(value?: number | null) {
  if (typeof value !== "number") {
    return "Unknown";
  }

  return `${Number.isInteger(value) ? value.toFixed(0) : value.toFixed(1)}%`;
}

function parseJobApiResult(value: unknown): JobApiResult | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  return value as JobApiResult;
}

function parseDuplicateProviderReview(value: unknown): DuplicateProviderReview | null {
  if (!value || typeof value !== "object") {
    return null;
  }

  const result = value as Partial<DuplicateProviderReview>;

  if (result.report !== "duplicate_provider_review" || !Array.isArray(result.groups)) {
    return null;
  }

  return result as DuplicateProviderReview;
}

function getResumeJob(result: JobApiResult | null): ResumeJob | null {
  if (!result?.jobRun || result.complete || !result.nextPage || !result.pageSize) {
    return null;
  }

  if (result.jobRun.jobType === "catalogue_refresh") {
    return {
      kind: "catalogue",
      nextPage: result.nextPage,
      pageSize: result.pageSize,
      query: result.query,
    };
  }

  if (result.jobRun.jobType === "pricing_refresh") {
    return {
      kind: "pricing",
      nextPage: result.nextPage,
      pageSize: result.pageSize,
      query: result.query,
    };
  }

  return null;
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

  if (sort === "name") {
    return left.name.localeCompare(right.name, undefined, { sensitivity: "base" }) ||
      left.set.localeCompare(right.set, undefined, { sensitivity: "base" }) ||
      compareCatalogueNumbers(left.number, right.number);
  }

  if (sort === "rarity") {
    return left.rarity.localeCompare(right.rarity, undefined, { sensitivity: "base" }) ||
      compareCatalogueNumbers(left.number, right.number);
  }

  if (sort === "set-number") {
    return left.set.localeCompare(right.set, undefined, { sensitivity: "base" }) ||
      compareCatalogueNumbers(left.number, right.number);
  }

  return compareCatalogueNumbers(left.number, right.number);
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
    paid: row.paid,
    overrideValue: row.overrideValue ?? "",
    valuationNote: row.valuationNote ?? "",
    location: row.location,
    notes: row.notes,
  };
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
    paid: moneyInputValue(item.purchasePriceMinor),
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

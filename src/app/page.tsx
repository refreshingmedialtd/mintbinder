"use client";

import {
  ArrowLeft,
  BarChart3,
  Boxes,
  Check,
  Download,
  GalleryVerticalEnd,
  Heart,
  History,
  Layers3,
  LayoutDashboard,
  LogIn,
  LogOut,
  MapPin,
  Lock,
  PackagePlus,
  Plus,
  Search,
  Settings,
  Sparkles,
  Trash2,
  Upload,
  UserRound,
  X,
} from "lucide-react";
import Image from "next/image";
import { signIn, signOut, useSession } from "next-auth/react";
import type { ChangeEvent, Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  buildCollectionCsv,
  buildCollectionImportTemplateCsv,
  parseCollectionImportCsv,
  type CollectionImportRow,
} from "@/lib/csv";
import { completionPercent, formatMoney } from "@/lib/format";
import { sampleAppData } from "@/lib/sample-data";
import type {
  AppData,
  AppDataSource,
  CatalogueItem,
  CollectionEvent,
  CollectionItem,
  ItemType,
  Screen,
  SetProgress,
  StorageLocation,
  WishlistItem,
} from "@/lib/types";

type AppState = {
  screen: Screen;
  addType: ItemType;
  collectionFilter: "all" | ItemType | "graded" | "unknown";
  setFilter: "all" | "owned" | "missing" | "want";
  selectedItemId: string;
  selectedSetId: string;
  selectedCatalogueId: string;
  plus: boolean;
};

type Viewer = {
  name: string;
  email: string;
};

type AuthMode = "sign-in" | "register";

const initialState: AppState = {
  screen: "dashboard",
  addType: "card",
  collectionFilter: "all",
  setFilter: "all",
  selectedItemId: "owned-charizard",
  selectedSetId: "set-151",
  selectedCatalogueId: "card-charizard-151",
  plus: false,
};

const storageTypes: StorageLocation["type"][] = ["Binder", "Box", "Display", "Safe", "Other"];

export default function Home() {
  const { data: session, status } = useSession();
  const [appState, setAppState] = useState(initialState);
  const [catalogueItems, setCatalogueItems] = useState<CatalogueItem[]>(sampleAppData.catalogue);
  const [collection, setCollection] = useState<CollectionItem[]>(sampleAppData.collection);
  const [wishlist, setWishlist] = useState<WishlistItem[]>(sampleAppData.wishlist);
  const [sets, setSets] = useState<SetProgress[]>(sampleAppData.sets);
  const [storageLocations, setStorageLocations] = useState<StorageLocation[]>(sampleAppData.storageLocations);
  const [collectionEvents, setCollectionEvents] = useState<CollectionEvent[]>(sampleAppData.events);
  const [dataSource, setDataSource] = useState<AppDataSource>(sampleAppData.source);
  const [dataNotice, setDataNotice] = useState(sampleAppData.notice ?? "");
  const [isLoadingData, setIsLoadingData] = useState(true);
  const [toast, setToast] = useState("");
  const [authMode, setAuthMode] = useState<AuthMode>("sign-in");
  const [signInEmail, setSignInEmail] = useState("liam@example.com");
  const [signInName, setSignInName] = useState("Liam");
  const [signInPassword, setSignInPassword] = useState("PokeStop2026!");
  const [signInError, setSignInError] = useState("");
  const [isSigningIn, setIsSigningIn] = useState(false);
  const [collectionSearch, setCollectionSearch] = useState("");
  const [addSearch, setAddSearch] = useState("");
  const [setSearch, setSetSearch] = useState("");

  const catalogueById = useMemo(() => {
    return new Map(catalogueItems.map((item) => [item.id, item]));
  }, [catalogueItems]);

  const viewer: Viewer = {
    name: session?.user?.name || "Collector",
    email: session?.user?.email || "",
  };

  const applyAppData = useCallback((data: AppData) => {
    setCatalogueItems(data.catalogue);
    setCollection(data.collection);
    setWishlist(data.wishlist);
    setSets(data.sets);
    setStorageLocations(data.storageLocations);
    setCollectionEvents(data.events);
    setDataSource(data.source);
    setDataNotice(data.notice ?? "");
    setAppState((current) => ({
      ...current,
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
      return total + (item.targetPriceMinor ?? catalogueItem?.valueMinor ?? 0);
    }, 0);
  }, [catalogueById, wishlist]);

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

  function showToast(message: string) {
    setToast(message);
    window.setTimeout(() => setToast(""), 2400);
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
      location: payload.location,
      notes: payload.notes,
    };

    setCollection((items) => [...items, nextItem]);
    setWishlist((items) => items.filter((item) => item.catalogueId !== catalogueId));
    setAppState((current) => ({ ...current, screen: "item", selectedItemId: nextItem.id }));
    showToast(`${catalogueItem.name} added to collection.`);
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

    setWishlist((items) => [
      ...items,
      {
        id: `want-${Date.now()}`,
        catalogueId,
        priority: catalogueItem.valueMinor > 10000 ? "Grail" : "High",
        targetPriceMinor: catalogueItem.valueMinor,
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

  function resetSampleData() {
    setCatalogueItems(sampleAppData.catalogue);
    setCollection(sampleAppData.collection);
    setWishlist(sampleAppData.wishlist);
    setSets(sampleAppData.sets);
    setStorageLocations(sampleAppData.storageLocations);
    setCollectionEvents(sampleAppData.events);
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

    downloadCsv(`pokestop-collection-${dateStamp()}.csv`, csv);
    showToast(`${collection.length} collection rows exported.`);
  }

  function downloadImportTemplate() {
    downloadCsv("pokestop-collection-import-template.csv", buildCollectionImportTemplateCsv());
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
    wishlist,
    wishlistTotal,
    addToCollection,
    updateCollectionItem,
    archiveCollectionItem,
    addToWishlist,
    duplicateItem,
    removeWishlistItem,
    createStorageLocation,
    deleteStorageLocation,
    exportCollectionCsv,
    downloadImportTemplate,
    importCollectionCsv,
    setAppState,
    showToast,
    resetSampleData,
  };

  return (
    <div className="app-shell">
      <Header
        plus={appState.plus}
        userEmail={viewer.email}
        userName={viewer.name}
        onNavigate={navigate}
        onSignOut={() => void signOut({ redirect: false })}
      />
      <div className="app-body">
        <Sidebar active={appState.screen} onNavigate={navigate} />
        <main className="main">{renderScreen(context)}</main>
      </div>
      <BottomNav active={appState.screen} onNavigate={navigate} />
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
  wishlist: WishlistItem[];
  wishlistTotal: number;
  addToCollection: (catalogueId: string, formData?: FormData) => Promise<void>;
  updateCollectionItem: (itemId: string, formData: FormData) => Promise<boolean>;
  archiveCollectionItem: (itemId: string) => Promise<boolean>;
  addToWishlist: (catalogueId: string) => Promise<void>;
  duplicateItem: (itemId: string) => Promise<void>;
  removeWishlistItem: (id: string, options?: { quiet?: boolean }) => Promise<void>;
  createStorageLocation: (formData: FormData) => Promise<boolean>;
  deleteStorageLocation: (id: string) => Promise<boolean>;
  exportCollectionCsv: () => void;
  downloadImportTemplate: () => void;
  importCollectionCsv: (file: File) => Promise<boolean>;
  setAppState: Dispatch<SetStateAction<AppState>>;
  showToast: (message: string) => void;
  resetSampleData: () => void;
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
    case "analytics":
      return <AnalyticsScreen {...context} />;
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
      <form className="auth-card" onSubmit={onSubmit}>
        <AuthBrand />
        <div>
          <h1>{authMode === "register" ? "Create account" : "Sign in"}</h1>
          <p className="muted">Your collection, wishlist, and set progress stay attached to your account.</p>
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
    </main>
  );
}

function AuthBrand() {
  return (
    <div className="auth-brand">
      <span className="brand-mark">
        <span className="brand-dot" />
      </span>
      <span>PokeStop</span>
    </div>
  );
}

function Header({
  plus,
  userEmail,
  userName,
  onNavigate,
  onSignOut,
}: {
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
        <span className="brand-text">PokeStop</span>
      </button>
      <div className="topbar-actions">
        <button className="plan-pill" onClick={() => onNavigate("analytics")}>
          {plus ? <Sparkles size={17} /> : <Lock size={17} />}
          {plus ? "Plus" : "Free"}
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
  onNavigate,
}: {
  active: Screen;
  onNavigate: (screen: Screen) => void;
}) {
  return (
    <aside className="sidebar" aria-label="Primary navigation">
      <NavButton active={active === "dashboard"} icon={<LayoutDashboard />} label="Dashboard" onClick={() => onNavigate("dashboard")} />
      <NavButton active={active === "collection"} icon={<Layers3 />} label="Collection" onClick={() => onNavigate("collection")} />
      <NavButton active={active === "add"} icon={<Plus />} label="Add item" onClick={() => onNavigate("add")} />
      <NavButton active={active === "sets" || active === "setDetail"} icon={<GalleryVerticalEnd />} label="Sets" onClick={() => onNavigate("sets")} />
      <NavButton active={active === "wishlist"} icon={<Heart />} label="Wishlist" onClick={() => onNavigate("wishlist")} />
      <NavButton active={active === "analytics"} icon={<BarChart3 />} label="Analytics" onClick={() => onNavigate("analytics")} />
      <span className="nav-divider" />
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
  wishlist,
  wishlistTotal,
  appState,
  setAppState,
}: ScreenContext) {
  const recent = collection.slice(-3).reverse();
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

      <div className="dashboard-grid">
        <section className="section-block">
          <SectionHeader title="Recent additions" />
          <div className="item-list">
            {recent.map((item) => (
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
              {sets.map((set) => (
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
          </section>

          <section className="tool-panel">
            <div className="panel-title-row">
              <h2>Plus analytics</h2>
              <span className="status-pill">{appState.plus ? "Unlocked" : "Preview"}</span>
            </div>
            <MiniChart />
            <button className="button full" onClick={() => navigate("analytics")}>
              <BarChart3 size={17} />
              Open analytics
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
  setAppState,
  setCollectionSearch,
  startAdd,
  navigate,
}: ScreenContext) {
  const filters: Array<[ScreenContext["appState"]["collectionFilter"], string]> = [
    ["all", "All"],
    ["card", "Cards"],
    ["sealed", "Sealed"],
    ["graded", "Graded"],
    ["unknown", "Unknown value"],
  ];

  const normalizedSearch = collectionSearch.trim().toLowerCase();
  const items = collection.filter((item) => {
    const catalogueItem = catalogueById.get(item.catalogueId);
    const value = getOwnedValue(item, catalogueItem);
    const matchesFilter =
      appState.collectionFilter === "all" ||
      catalogueItem?.type === appState.collectionFilter ||
      (appState.collectionFilter === "graded" && item.grade !== "Raw" && item.grade !== "N/A") ||
      (appState.collectionFilter === "unknown" && value === null);
    const matchesSearch =
      !normalizedSearch ||
      `${catalogueItem?.name} ${catalogueItem?.set} ${item.condition} ${item.location}`
        .toLowerCase()
        .includes(normalizedSearch);

    return matchesFilter && matchesSearch;
  });

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

      <div className="toolbar">
        <label className="search-box">
          <Search size={18} />
          <input
            value={collectionSearch}
            onChange={(event) => setCollectionSearch(event.target.value)}
            placeholder="Search collection"
          />
        </label>
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
      </div>

      {items.length ? (
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
          <CollectionTable items={items} catalogueById={catalogueById} openItem={(id) => {
            setAppState((current) => ({ ...current, selectedItemId: id }));
            navigate("item");
          }} />
        </>
      ) : (
        <EmptyState
          title="No matching items"
          action={
            <button className="button primary" onClick={() => startAdd("card")}>
              <Plus size={17} />
              Add card
            </button>
          }
        />
      )}
    </section>
  );
}

function AddScreen({
  appState,
  catalogueItems,
  storageLocations,
  addSearch,
  setAddSearch,
  setAppState,
  addToCollection,
  addToWishlist,
  navigate,
}: ScreenContext) {
  const results = catalogueItems.filter((item) => item.type === appState.addType);
  const normalizedSearch = addSearch.trim().toLowerCase();
  const filteredResults = results.filter((item) =>
    `${item.name} ${item.set} ${item.number}`.toLowerCase().includes(normalizedSearch),
  );
  const selected =
    catalogueItems.find((item) => item.id === appState.selectedCatalogueId && item.type === appState.addType) ??
    results[0];
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

          <div className="item-list">
            {filteredResults.map((item) => (
              <CatalogueResult
                key={item.id}
                item={item}
                selected={item.id === selected?.id}
                onClick={() => setAppState((current) => ({ ...current, selectedCatalogueId: item.id }))}
              />
            ))}
          </div>
        </section>

        <section className="tool-panel">
          <h2>Owned details</h2>
          {selected ? <CataloguePreview item={selected} /> : null}
          <form className="form-stack" onSubmit={handleSubmit}>
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
                <input name="variant" defaultValue={selected?.type === "sealed" ? "Factory sealed" : "Standard"} />
              </Field>
            </div>
            <Field label="Notes">
              <textarea name="notes" placeholder="Optional" />
            </Field>
            <div className="actions">
              <button className="button primary" type="submit">
                <Check size={17} />
                Save to collection
              </button>
              <button className="button" type="button" onClick={() => selected && void addToWishlist(selected.id)}>
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

function ItemDetailScreen({
  appState,
  archiveCollectionItem,
  catalogueById,
  collection,
  collectionEvents,
  duplicateItem,
  navigate,
  storageLocations,
  updateCollectionItem,
}: ScreenContext) {
  const [isEditing, setIsEditing] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isRemoving, setIsRemoving] = useState(false);
  const owned = collection.find((item) => item.id === appState.selectedItemId) ?? collection[0];

  if (!owned) {
    return <EmptyState title="No collection items yet" />;
  }

  const item = catalogueById.get(owned.catalogueId);

  if (!item) {
    return <EmptyState title="Item not found" />;
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

  return (
    <section className="page">
      <PageHeader
        title={item.name}
        action={
          <div className="actions">
            <button className="button" onClick={() => navigate("collection")}>
              <ArrowLeft size={17} />
              Collection
            </button>
            <button className="button" onClick={() => setIsEditing((current) => !current)}>
              {isEditing ? <X size={17} /> : <Settings size={17} />}
              {isEditing ? "Cancel edit" : "Edit"}
            </button>
            <button className="button primary" onClick={() => void duplicateItem(owned.id)}>
              <Plus size={17} />
              Duplicate lot
            </button>
          </div>
        }
      />

      <div className="detail-layout">
        <div className="detail-image">{renderItemImage(item)}</div>
        <div className="detail-stack">
          {isEditing ? (
            <section className="tool-panel">
              <h2>Edit owned details</h2>
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
                  <Field label="Location">
                    <select name="location" defaultValue={owned.location}>
                      {locationOptions.map((location) => (
                        <option key={location}>{location}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Variant">
                    <input name="variant" defaultValue={owned.variant} />
                  </Field>
                </div>
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
                  <button className="button danger" type="button" onClick={handleRemove} disabled={isRemoving}>
                    <Trash2 size={17} />
                    {isRemoving ? "Removing" : "Remove item"}
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
              ["Estimated value", formatMoney(value)],
              ["Cost basis", formatMoney(cost)],
              ["Gain/loss", formatMoney(gain), gain !== null && gain >= 0 ? "positive" : ""],
              ["Confidence", item.confidence],
              ["Source", owned.overrideValueMinor ? "Manual override" : "Sample price snapshot"],
            ]}
          />
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
  const set = sets.find((item) => item.id === appState.selectedSetId) ?? sets[0];

  if (!set) {
    return <EmptyState title="No sets found" />;
  }

  const setCards = catalogueItems.filter((item) => item.type === "card" && item.set === set.name);
  const done = completionPercent(set.owned, set.total);

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
  });

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
      <section className="tool-panel">
        <div className="set-card-header">
          <span>{set.owned} / {set.total} owned</span>
          <strong>{done}%</strong>
        </div>
        <ProgressBar value={done} />
        <div className="segmented">
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

      <div className="item-list">
        {visibleCards.map((item) => {
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
                <div className="actions">
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
                  <button className="button" onClick={() => void addToWishlist(item.id)}>
                    <Heart size={17} />
                    Want
                  </button>
                </div>
              </div>
            </article>
          );
        })}
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
}: ScreenContext) {
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

      <div className="item-list">
        {wishlist.length ? (
          wishlist.map((item) => {
            const catalogueItem = catalogueById.get(item.catalogueId);
            if (!catalogueItem) {
              return null;
            }

            return (
              <article className="item-card" key={item.id}>
                <div className="item-image">{renderItemImage(catalogueItem)}</div>
                <div className="item-main">
                  <div className="item-title-row">
                    <div>
                      <h3>{catalogueItem.name}</h3>
                      <p className="muted">{catalogueItem.set} | {catalogueItem.number}</p>
                    </div>
                    <span className="priority-pill">{item.priority}</span>
                  </div>
                  <p className="item-value">Target {formatMoney(item.targetPriceMinor ?? catalogueItem.valueMinor)}</p>
                  <p className="muted">{item.notes}</p>
                  <div className="actions">
                    <button className="button primary" onClick={() => void addToCollection(item.catalogueId)}>
                      <Check size={17} />
                      Move to collection
                    </button>
                    <button
                      className="button"
                      onClick={() => void removeWishlistItem(item.id)}
                    >
                      <Trash2 size={17} />
                      Remove
                    </button>
                  </div>
                </div>
              </article>
            );
          })
        ) : (
          <EmptyState title="No wishlist items" />
        )}
      </div>
    </section>
  );
}

function AnalyticsScreen({
  appState,
  catalogueById,
  collection,
  collectionEvents,
  storageLocations,
  summary,
  wishlistTotal,
  setAppState,
}: ScreenContext) {
  const gain = summary.value - summary.cost;
  const catalogueCounts = collection.reduce<Record<string, number>>((counts, item) => {
    counts[item.catalogueId] = (counts[item.catalogueId] ?? 0) + item.quantity;
    return counts;
  }, {});
  const duplicateItems = collection.filter((item) => (catalogueCounts[item.catalogueId] ?? 0) > 1);
  const duplicateValue = duplicateItems.reduce((total, item) => {
    return total + (getOwnedValue(item, catalogueById.get(item.catalogueId)) ?? 0);
  }, 0);
  const activeLocations = storageLocations.filter((location) => location.totalQuantity > 0).length;
  const recentActivity = collectionEvents.length
    ? `${collectionEvents[0].type} ${collectionEvents[0].itemName}`
    : "No activity yet";

  if (!appState.plus) {
    return (
      <section className="page">
        <PageHeader title="Analytics" />
        <div className="screen-split">
          <section className="section-block">
            <SectionHeader title="Preview" />
            <div className="locked-list">
              {["Value over time", "Best performers", "Duplicate review", "Price alerts"].map((label) => (
                <div className="locked-tile" key={label}>
                  <strong>{label}</strong>
                  <span className="tag red">Locked</span>
                </div>
              ))}
            </div>
          </section>
          <section className="tool-panel">
            <h2>Plus</h2>
            <MetricList
              rows={[
                ["Monthly", "GBP 2.49"],
                ["Yearly", "Discounted"],
                ["Unlocks", "Trends, alerts, reports"],
              ]}
            />
            <button className="button primary full" onClick={() => setAppState((current) => ({ ...current, plus: true }))}>
              <Sparkles size={17} />
              Simulate Plus
            </button>
          </section>
        </div>
      </section>
    );
  }

  return (
    <section className="page">
      <PageHeader title="Analytics" action={<span className="plan-pill"><Sparkles size={17} />Plus active</span>} />
      <div className="stats-grid">
        <StatCard label="Current value" value={formatMoney(summary.value)} note={`${summary.items} tracked items`} />
        <StatCard label="Cost basis" value={formatMoney(summary.cost)} note="Known purchase prices" />
        <StatCard label="Gain/loss" value={formatMoney(gain)} note="Against known cost" positive={gain >= 0} />
        <StatCard label="Duplicates" value={duplicateItems.length.toString()} note={`${formatMoney(duplicateValue)} across duplicate lots`} />
      </div>
      <div className="dashboard-grid">
        <section className="tool-panel">
          <h2>Value over time</h2>
          <MiniChart />
        </section>
        <MetricPanel
          title="Opportunities"
          rows={[
            ["Recent activity", recentActivity],
            ["Storage locations", `${activeLocations} active`],
            ["Duplicate value", formatMoney(duplicateValue)],
            ["Wishlist gap", formatMoney(wishlistTotal)],
          ]}
        />
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

function SettingsScreen({
  appState,
  viewer,
  dataSource,
  dataNotice,
  isLoadingData,
  resetSampleData,
  storageLocations,
  createStorageLocation,
  deleteStorageLocation,
  exportCollectionCsv,
  downloadImportTemplate,
  importCollectionCsv,
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
            ["Currency", "GBP"],
            ["Region", "United Kingdom"],
          ]}
        />
        <MetricPanel
          title="Subscription"
          rows={[
            ["Plan", appState.plus ? "Plus" : "Free"],
            ["Billing", appState.plus ? "Active sample state" : "Not connected"],
          ]}
        />
        <MetricPanel
          title="Data source"
          rows={[
            ["Mode", isLoadingData ? "Loading" : dataSource === "database" ? "Prisma database" : "Sample fallback"],
            ["Status", dataNotice || "Connected"],
          ]}
        />
        <DataPanel
          onExportCollection={exportCollectionCsv}
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

function DataPanel({
  onExportCollection,
  onDownloadTemplate,
  onImportCollection,
  onResetSampleData,
}: {
  onExportCollection: () => void;
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
                <td><strong>{formatMoney(getOwnedValue(item, catalogueItem))}</strong></td>
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
          <span className="confidence-pill">{catalogueItem.confidence}</span>
        </div>
        <div className="tag-row">
          <span className="tag">{item.condition}</span>
          <span className="tag">{item.language}</span>
          <span className="tag blue">Qty {item.quantity}</span>
        </div>
        <p className="item-value">{formatMoney(getOwnedValue(item, catalogueItem))}</p>
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
        <p className="item-value">{formatMoney(item.valueMinor)}</p>
      </div>
    </button>
  );
}

function CataloguePreview({ item }: { item: CatalogueItem }) {
  return (
    <div className="selected-preview">
      <div className="item-image">{renderItemImage(item)}</div>
      <div>
        <h3>{item.name}</h3>
        <p className="muted">{item.set} | {item.number}</p>
        <div className="tag-row">
          <span className="tag">{item.rarity}</span>
          <span className="tag blue">{item.confidence}</span>
        </div>
      </div>
    </div>
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

function EmptyState({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="empty-state">
      <h2>{title}</h2>
      {action}
    </div>
  );
}

function MiniChart() {
  return (
    <div className="mini-chart" aria-label="Value trend chart">
      {[39, 45, 52, 58, 64, 74, 88].map((height) => (
        <span key={height} style={{ height: `${height}%` }} />
      ))}
    </div>
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

  return item.overrideValueMinor ?? catalogueItem.valueMinor * item.quantity;
}

function importPayload(row: CollectionImportRow) {
  return {
    catalogueId: row.catalogueId,
    quantity: row.quantity,
    condition: row.condition,
    language: row.language,
    variant: row.variant,
    paid: row.paid,
    location: row.location,
    notes: row.notes,
  };
}

function storageOptionNames(locations: StorageLocation[], current?: string) {
  return uniqueValues([...locations.map((location) => location.name), current ?? "", "Unassigned"]);
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

function downloadCsv(filename: string, csv: string) {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
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

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

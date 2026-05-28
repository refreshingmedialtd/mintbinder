"use client";

import {
  ArrowLeft,
  BarChart3,
  Boxes,
  Check,
  Download,
  GalleryVerticalEnd,
  Heart,
  Layers3,
  LayoutDashboard,
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
import type { Dispatch, FormEvent, ReactNode, SetStateAction } from "react";
import { useMemo, useState } from "react";
import { completionPercent, formatMoney } from "@/lib/format";
import {
  catalogue,
  initialCollection,
  initialWishlist,
  setProgress,
} from "@/lib/sample-data";
import type { CatalogueItem, CollectionItem, ItemType, Screen, WishlistItem } from "@/lib/types";

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

export default function Home() {
  const [appState, setAppState] = useState(initialState);
  const [collection, setCollection] = useState<CollectionItem[]>(initialCollection);
  const [wishlist, setWishlist] = useState<WishlistItem[]>(initialWishlist);
  const [toast, setToast] = useState("");
  const [collectionSearch, setCollectionSearch] = useState("");
  const [addSearch, setAddSearch] = useState("");
  const [setSearch, setSetSearch] = useState("");

  const catalogueById = useMemo(() => {
    return new Map(catalogue.map((item) => [item.id, item]));
  }, []);

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
    const firstItem = catalogue.find((item) => item.type === type);
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

  function addToCollection(catalogueId: string, formData?: FormData) {
    const catalogueItem = catalogueById.get(catalogueId);
    if (!catalogueItem) {
      return;
    }

    const paidInput = String(formData?.get("paid") ?? "").replace(/[^0-9.]/g, "");
    const paidValue = paidInput ? Math.round(Number(paidInput) * 100) : undefined;
    const nextItem: CollectionItem = {
      id: `owned-${Date.now()}`,
      catalogueId,
      quantity: Math.max(1, Number(formData?.get("quantity") ?? 1)),
      condition:
        String(formData?.get("condition") ?? "") ||
        (catalogueItem.type === "sealed" ? "Sealed" : "Near mint"),
      language: String(formData?.get("language") ?? "English"),
      variant:
        String(formData?.get("variant") ?? "") ||
        (catalogueItem.type === "sealed" ? "Factory sealed" : "Standard"),
      grade: catalogueItem.type === "sealed" ? "N/A" : "Raw",
      purchasePriceMinor:
        paidValue !== undefined && Number.isFinite(paidValue) ? paidValue : undefined,
      purchaseDate: new Date().toISOString().slice(0, 10),
      location: String(formData?.get("location") ?? "Unassigned"),
      notes: String(formData?.get("notes") ?? ""),
    };

    setCollection((items) => [...items, nextItem]);
    setWishlist((items) => items.filter((item) => item.catalogueId !== catalogueId));
    setAppState((current) => ({ ...current, screen: "item", selectedItemId: nextItem.id }));
    showToast(`${catalogueItem.name} added to collection.`);
  }

  function addToWishlist(catalogueId: string) {
    const catalogueItem = catalogueById.get(catalogueId);
    if (!catalogueItem || wishlist.some((item) => item.catalogueId === catalogueId)) {
      showToast("That item is already on the wishlist.");
      return;
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

  function duplicateItem(itemId: string) {
    const source = collection.find((item) => item.id === itemId);
    if (!source) {
      return;
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

  function resetSampleData() {
    setCollection(initialCollection);
    setWishlist(initialWishlist);
    setAppState(initialState);
    showToast("Sample data reset.");
  }

  const context = {
    appState,
    catalogueById,
    collection,
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
    addToWishlist,
    duplicateItem,
    setAppState,
    setWishlist,
    showToast,
    resetSampleData,
  };

  return (
    <div className="app-shell">
      <Header plus={appState.plus} onNavigate={navigate} />
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
  catalogueById: Map<string, CatalogueItem>;
  collection: CollectionItem[];
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
  addToCollection: (catalogueId: string, formData?: FormData) => void;
  addToWishlist: (catalogueId: string) => void;
  duplicateItem: (itemId: string) => void;
  setAppState: Dispatch<SetStateAction<AppState>>;
  setWishlist: Dispatch<SetStateAction<WishlistItem[]>>;
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

function Header({
  plus,
  onNavigate,
}: {
  plus: boolean;
  onNavigate: (screen: Screen) => void;
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
        <button className="user-pill" onClick={() => onNavigate("settings")}>
          <UserRound size={17} />
          Liam
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
  catalogueById,
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
            <h2>Quick actions</h2>
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
          </section>

          <section className="section-block">
            <SectionHeader title="Set progress" action={<button className="button" onClick={() => navigate("sets")}>Open sets</button>} />
            <div className="set-list">
              {setProgress.map((set) => (
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
  addSearch,
  setAddSearch,
  setAppState,
  addToCollection,
  addToWishlist,
  navigate,
}: ScreenContext) {
  const results = catalogue.filter((item) => item.type === appState.addType);
  const normalizedSearch = addSearch.trim().toLowerCase();
  const filteredResults = results.filter((item) =>
    `${item.name} ${item.set} ${item.number}`.toLowerCase().includes(normalizedSearch),
  );
  const selected =
    catalogue.find((item) => item.id === appState.selectedCatalogueId && item.type === appState.addType) ??
    results[0];

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected) {
      return;
    }

    addToCollection(selected.id, new FormData(event.currentTarget));
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
                  selectedCatalogueId: catalogue.find((item) => item.type === "card")?.id ?? current.selectedCatalogueId,
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
                  selectedCatalogueId: catalogue.find((item) => item.type === "sealed")?.id ?? current.selectedCatalogueId,
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
                <select name="location" defaultValue={selected?.type === "sealed" ? "Sealed Box 1" : "Blue Binder"}>
                  <option>Blue Binder</option>
                  <option>Sealed Box 1</option>
                  <option>Safe</option>
                  <option>Unassigned</option>
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
              <button className="button" type="button" onClick={() => selected && addToWishlist(selected.id)}>
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
  catalogueById,
  collection,
  duplicateItem,
  navigate,
}: ScreenContext) {
  const owned = collection.find((item) => item.id === appState.selectedItemId) ?? collection[0];
  const item = catalogueById.get(owned.catalogueId);

  if (!item) {
    return <EmptyState title="Item not found" />;
  }

  const value = getOwnedValue(owned, item);
  const cost = owned.purchasePriceMinor ?? null;
  const gain = value !== null && cost !== null ? value - cost : null;

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
            <button className="button primary" onClick={() => duplicateItem(owned.id)}>
              <Plus size={17} />
              Duplicate lot
            </button>
          </div>
        }
      />

      <div className="detail-layout">
        <div className="detail-image">{renderItemImage(item)}</div>
        <div className="detail-stack">
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
        </div>
      </div>
    </section>
  );
}

function SetsScreen({
  appState,
  setSearch,
  setSetSearch,
  setAppState,
}: ScreenContext) {
  const sets = setProgress.filter((set) => set.name.toLowerCase().includes(setSearch.toLowerCase()));

  return (
    <section className="page">
      <PageHeader title="Sets" />
      <label className="search-box">
        <Search size={18} />
        <input value={setSearch} onChange={(event) => setSetSearch(event.target.value)} placeholder="Search sets" />
      </label>
      <div className="set-list">
        {sets.map((set) => (
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
  collection,
  wishlist,
  setAppState,
  addToWishlist,
  navigate,
}: ScreenContext) {
  const set = setProgress.find((item) => item.id === appState.selectedSetId) ?? setProgress[0];
  const setCards = catalogue.filter((item) => item.type === "card" && item.set === set.name);
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
                  <button className="button" onClick={() => addToWishlist(item.id)}>
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
  setWishlist,
  addToCollection,
  startAdd,
  showToast,
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
                    <button className="button primary" onClick={() => addToCollection(item.catalogueId)}>
                      <Check size={17} />
                      Move to collection
                    </button>
                    <button
                      className="button"
                      onClick={() => {
                        setWishlist((items) => items.filter((entry) => entry.id !== item.id));
                        showToast("Wishlist item removed.");
                      }}
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

function AnalyticsScreen({ appState, summary, wishlistTotal, setAppState }: ScreenContext) {
  const gain = summary.value - summary.cost;

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
        <StatCard label="Duplicates" value="8" note="Worth reviewing" />
      </div>
      <div className="dashboard-grid">
        <section className="tool-panel">
          <h2>Value over time</h2>
          <MiniChart />
        </section>
        <MetricPanel
          title="Opportunities"
          rows={[
            ["Best performer", "Umbreon VMAX"],
            ["Duplicate value", "GBP 128.00"],
            ["Grading candidate", "Charizard ex"],
            ["Wishlist gap", formatMoney(wishlistTotal)],
          ]}
        />
      </div>
    </section>
  );
}

function SettingsScreen({ appState, resetSampleData, showToast }: ScreenContext) {
  return (
    <section className="page">
      <PageHeader title="Settings" />
      <div className="screen-split">
        <MetricPanel
          title="Profile"
          rows={[
            ["Name", "Liam"],
            ["Email", "liam@example.com"],
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
        <section className="tool-panel">
          <h2>Data</h2>
          <div className="actions">
            <button className="button" onClick={() => showToast("CSV export will connect to backend data later.")}>
              <Download size={17} />
              Export CSV
            </button>
            <button className="button" onClick={() => showToast("CSV import is planned after collection CRUD.")}>
              <Upload size={17} />
              Import CSV
            </button>
            <button className="button" onClick={resetSampleData}>
              Reset sample
            </button>
          </div>
        </section>
        <section className="tool-panel">
          <h2>Storage</h2>
          <div className="tag-row">
            <span className="tag">Blue Binder</span>
            <span className="tag">Sealed Box 1</span>
            <span className="tag">Safe</span>
          </div>
        </section>
      </div>
    </section>
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

function SetProgressCard({ set, onClick }: { set: (typeof setProgress)[number]; onClick: () => void }) {
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

function capitalize(value: string) {
  return value.charAt(0).toUpperCase() + value.slice(1);
}

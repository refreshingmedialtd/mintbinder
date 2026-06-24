export type ItemType = "card" | "sealed";
export type PriceConfidence = "Strong" | "Fair" | "Weak";

export type PricePoint = {
  observedAt: string;
  valueMinor: number;
  confidence: PriceConfidence;
  source: string;
  variantLabel?: string;
};

export type CatalogueVariantOption = {
  label: string;
  valueMinor?: number;
  confidence?: PriceConfidence;
  source?: string;
  observedAt?: string;
};

export type CatalogueItem = {
  id: string;
  type: ItemType;
  name: string;
  set: string;
  number: string;
  rarity: string;
  image?: string;
  hasPrice: boolean;
  valueMinor: number;
  confidence: PriceConfidence;
  priceSource?: string;
  priceObservedAt?: string;
  priceHistory?: PricePoint[];
  variantOptions?: CatalogueVariantOption[];
};

export type CollectionItem = {
  id: string;
  catalogueId: string;
  quantity: number;
  condition: string;
  language: string;
  variant: string;
  grade: string;
  purchasePriceMinor?: number;
  purchaseDate?: string;
  location: string;
  notes?: string;
  overrideValueMinor?: number;
  valuationNote?: string;
};

export type WishlistItem = {
  id: string;
  catalogueId: string;
  priority: "Low" | "Medium" | "High" | "Grail";
  targetPriceMinor?: number;
  notes?: string;
};

export type SetProgress = {
  id: string;
  name: string;
  series?: string;
  releaseDate?: string;
  logoImage?: string;
  symbolImage?: string;
  owned: number;
  total: number;
};

export type StorageLocation = {
  id: string;
  name: string;
  type: "Binder" | "Box" | "Display" | "Safe" | "Other";
  notes?: string;
  itemCount: number;
  totalQuantity: number;
  valueMinor: number;
};

export type CollectionEvent = {
  id: string;
  type: "Added" | "Edited" | "Sold" | "Removed" | "Graded" | "Moved" | "Imported";
  itemId: string;
  catalogueId: string;
  itemName: string;
  quantity?: number;
  amountMinor?: number;
  basisMinor?: number;
  currency?: string;
  occurredAt: string;
  notes?: string;
};

export type AppDataSource = "database" | "sample";

export type AppSubscription = {
  cancelAtPeriodEnd?: boolean;
  currentPeriodEnd?: string;
  plan: "free" | "plus";
  provider?: string;
  providerSubscriptionId?: string;
  status?: string;
  entitlements: {
    "billing.portal": boolean;
    "exports.insurance_report": boolean;
    "pricing.alerts": boolean;
  };
};

export type NotificationPreferences = {
  priceAlertsEnabled: boolean;
  wishlistTargetAlertsEnabled: boolean;
  weakPriceAlertsEnabled: boolean;
  digestFrequency: "Off" | "Daily" | "Weekly";
};

export type AppData = {
  catalogue: CatalogueItem[];
  catalogueComplete?: boolean;
  collection: CollectionItem[];
  wishlist: WishlistItem[];
  sets: SetProgress[];
  storageLocations: StorageLocation[];
  events: CollectionEvent[];
  source: AppDataSource;
  subscription: AppSubscription;
  notificationPreferences: NotificationPreferences;
  notice?: string;
};

export type DashboardSummary = {
  cards: number;
  costMinor: number;
  items: number;
  sealed: number;
  unvalued: number;
  valueMinor: number;
  wishlistTargetMinor: number;
};

export type AppDashboardData = AppData & {
  dashboard: {
    generatedAt: string;
    summary: DashboardSummary;
  };
};

export type AppCatalogueData = {
  catalogue: CatalogueItem[];
  source: AppDataSource;
  notice?: string;
};

export type AppCatalogueSearchData = AppCatalogueData & {
  hasMore: boolean;
  query: {
    limit: number;
    q: string;
    rarity: string;
    set: string;
    sort: string;
    type: ItemType;
  };
  resultCount: number;
};

export type Screen =
  | "dashboard"
  | "collection"
  | "binders"
  | "add"
  | "item"
  | "sets"
  | "setDetail"
  | "wishlist"
  | "alerts"
  | "analytics"
  | "ops"
  | "settings";

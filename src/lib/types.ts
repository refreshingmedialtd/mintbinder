export type ItemType = "card" | "sealed";

export type CatalogueItem = {
  id: string;
  type: ItemType;
  name: string;
  set: string;
  number: string;
  rarity: string;
  image?: string;
  valueMinor: number;
  confidence: "Strong" | "Fair" | "Weak";
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
  plan: "free" | "plus";
  entitlements: {
    "billing.portal": boolean;
    "exports.insurance_report": boolean;
    "pricing.alerts": boolean;
  };
};

export type AppData = {
  catalogue: CatalogueItem[];
  collection: CollectionItem[];
  wishlist: WishlistItem[];
  sets: SetProgress[];
  storageLocations: StorageLocation[];
  events: CollectionEvent[];
  source: AppDataSource;
  subscription: AppSubscription;
  notice?: string;
};

export type Screen =
  | "dashboard"
  | "collection"
  | "add"
  | "item"
  | "sets"
  | "setDetail"
  | "wishlist"
  | "alerts"
  | "analytics"
  | "settings";

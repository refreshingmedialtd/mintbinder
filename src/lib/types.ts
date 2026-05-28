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

export type AppDataSource = "database" | "sample";

export type AppData = {
  catalogue: CatalogueItem[];
  collection: CollectionItem[];
  wishlist: WishlistItem[];
  sets: SetProgress[];
  source: AppDataSource;
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
  | "analytics"
  | "settings";

const catalogue = [
  {
    id: "card-charizard-151",
    type: "card",
    name: "Charizard ex",
    set: "Scarlet & Violet 151",
    number: "199/165",
    rarity: "Special Illustration Rare",
    image: "https://images.pokemontcg.io/sv3pt5/199_hires.png",
    value: 11800,
    confidence: "Fair",
  },
  {
    id: "card-umbreon-vmax",
    type: "card",
    name: "Umbreon VMAX",
    set: "Evolving Skies",
    number: "215/203",
    rarity: "Secret Rare",
    image: "https://images.pokemontcg.io/swsh7/215_hires.png",
    value: 74000,
    confidence: "Strong",
  },
  {
    id: "card-mew-ex",
    type: "card",
    name: "Mew ex",
    set: "Scarlet & Violet 151",
    number: "193/165",
    rarity: "Special Illustration Rare",
    image: "https://images.pokemontcg.io/sv3pt5/193_hires.png",
    value: 3500,
    confidence: "Fair",
  },
  {
    id: "card-pikachu",
    type: "card",
    name: "Pikachu",
    set: "Crown Zenith",
    number: "160/159",
    rarity: "Secret Rare",
    image: "https://images.pokemontcg.io/swsh12pt5/160_hires.png",
    value: 1450,
    confidence: "Strong",
  },
  {
    id: "sealed-151-bundle",
    type: "sealed",
    name: "151 Booster Bundle",
    set: "Scarlet & Violet 151",
    number: "Sealed",
    rarity: "Booster bundle",
    value: 3200,
    confidence: "Weak",
  },
  {
    id: "sealed-evolving-skies-box",
    type: "sealed",
    name: "Evolving Skies Booster Box",
    set: "Evolving Skies",
    number: "Sealed",
    rarity: "Booster box",
    value: 45000,
    confidence: "Fair",
  },
];

const setData = [
  {
    id: "set-151",
    name: "Scarlet & Violet 151",
    owned: 128,
    total: 207,
    cards: ["card-charizard-151", "card-mew-ex", "card-pikachu"],
  },
  {
    id: "set-crown-zenith",
    name: "Crown Zenith",
    owned: 96,
    total: 159,
    cards: ["card-pikachu", "card-mew-ex"],
  },
  {
    id: "set-evolving-skies",
    name: "Evolving Skies",
    owned: 42,
    total: 237,
    cards: ["card-umbreon-vmax"],
  },
];

const initialCollection = [
  {
    id: "owned-umbreon",
    catalogueId: "card-umbreon-vmax",
    quantity: 1,
    condition: "Near mint",
    language: "English",
    variant: "Alternate art",
    graded: "Raw",
    purchasePrice: 32000,
    purchaseDate: "2024-11-12",
    location: "Blue Binder",
    notes: "Long-term hold.",
  },
  {
    id: "owned-charizard",
    catalogueId: "card-charizard-151",
    quantity: 1,
    condition: "Near mint",
    language: "English",
    variant: "Reverse Holo",
    graded: "Raw",
    purchasePrice: 9200,
    purchaseDate: "2026-05-01",
    location: "Blue Binder",
    notes: "Bought at card show.",
    overrideValue: 11800,
  },
  {
    id: "owned-bundle",
    catalogueId: "sealed-151-bundle",
    quantity: 2,
    condition: "Sealed",
    language: "English",
    variant: "Factory sealed",
    graded: "N/A",
    purchasePrice: 4800,
    purchaseDate: "2025-08-18",
    location: "Sealed Box 1",
    notes: "Keep sealed.",
  },
];

const initialWishlist = [
  {
    id: "want-mew",
    catalogueId: "card-mew-ex",
    priority: "High",
    targetPrice: 3500,
    notes: "Buy if a clean copy appears.",
  },
  {
    id: "want-box",
    catalogueId: "sealed-evolving-skies-box",
    priority: "Grail",
    targetPrice: 45000,
    notes: "Only at the right price.",
  },
];

const urlParams = new URLSearchParams(window.location.search);
if (urlParams.has("reset")) {
  localStorage.removeItem("mintbinder-prototype-collection");
  localStorage.removeItem("mintbinder-prototype-wishlist");
  window.history.replaceState({}, "", window.location.pathname);
}

const state = {
  screen: "dashboard",
  addType: "card",
  collectionFilter: "all",
  setFilter: "all",
  selectedItemId: "owned-charizard",
  selectedSetId: "set-151",
  selectedCatalogueId: "card-charizard-151",
  plus: false,
  toast: "",
  collection:
    JSON.parse(localStorage.getItem("mintbinder-prototype-collection") || "null") ||
    initialCollection,
  wishlist:
    JSON.parse(localStorage.getItem("mintbinder-prototype-wishlist") || "null") ||
    initialWishlist,
};

const app = document.querySelector("#app");

function money(value) {
  if (value === null || value === undefined) {
    return "Unknown";
  }

  return `GBP ${(value / 100).toLocaleString("en-GB", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function percent(value, total) {
  if (!total) {
    return 0;
  }

  return Math.round((value / total) * 100);
}

function saveState() {
  localStorage.setItem(
    "mintbinder-prototype-collection",
    JSON.stringify(state.collection),
  );
  localStorage.setItem(
    "mintbinder-prototype-wishlist",
    JSON.stringify(state.wishlist),
  );
}

function getCatalogueItem(id) {
  return catalogue.find((item) => item.id === id);
}

function getOwnedItem(id) {
  return state.collection.find((item) => item.id === id);
}

function getOwnedValue(item) {
  const catalogueItem = getCatalogueItem(item.catalogueId);
  if (!catalogueItem) {
    return null;
  }

  return item.overrideValue ?? catalogueItem.value * item.quantity;
}

function getCostBasis(item) {
  return item.purchasePrice ?? null;
}

function collectionSummary() {
  return state.collection.reduce(
    (summary, item) => {
      const catalogueItem = getCatalogueItem(item.catalogueId);
      const value = getOwnedValue(item);
      const cost = getCostBasis(item);

      summary.items += item.quantity;
      if (catalogueItem?.type === "sealed") {
        summary.sealed += item.quantity;
      } else {
        summary.cards += item.quantity;
      }

      if (value === null) {
        summary.unvalued += item.quantity;
      } else {
        summary.value += value;
      }

      if (cost !== null) {
        summary.cost += cost;
      }

      return summary;
    },
    { value: 0, cost: 0, items: 0, cards: 0, sealed: 0, unvalued: 0 },
  );
}

function wishlistSummary() {
  return state.wishlist.reduce(
    (summary, item) => {
      const catalogueItem = getCatalogueItem(item.catalogueId);
      summary.items += 1;
      summary.value += item.targetPrice ?? catalogueItem?.value ?? 0;
      return summary;
    },
    { items: 0, value: 0 },
  );
}

function icon(name) {
  return `<i data-lucide="${name}" aria-hidden="true"></i>`;
}

function imageFor(item) {
  if (item?.image) {
    return `<img src="${item.image}" alt="${item.name}">`;
  }

  if (item?.type === "sealed") {
    return `<div class="sealed-art" aria-label="${item.name}">${item.name}</div>`;
  }

  return `<div class="image-fallback">No image</div>`;
}

function navButton(screen, label, iconName) {
  const active = state.screen === screen;
  return `
    <button class="nav-button ${active ? "active" : ""}" data-action="nav" data-screen="${screen}">
      ${icon(iconName)}
      <span>${label}</span>
    </button>
  `;
}

function bottomNavButton(screen, label, iconName, extra = "") {
  const active = state.screen === screen;
  const isAdd = screen === "add";
  return `
    <button class="${active ? "active" : ""} ${isAdd ? "add-button" : ""}" data-action="nav" data-screen="${screen}">
      ${
        isAdd
          ? `<span class="icon-wrap">${icon(iconName)}</span>`
          : icon(iconName)
      }
      <span>${label}</span>
      ${extra}
    </button>
  `;
}

function renderShell(content) {
  app.innerHTML = `
    <div class="app-shell">
      <header class="topbar">
        <button class="brand" data-action="nav" data-screen="dashboard" aria-label="Mint Binder dashboard">
          <span class="brand-mark"><span class="brand-dot"></span></span>
          <span class="brand-text">Mint Binder</span>
        </button>
        <div class="topbar-actions">
          <button class="plan-pill" data-action="nav" data-screen="analytics">
            ${icon(state.plus ? "sparkles" : "lock")}
            ${state.plus ? "Plus" : "Free"}
          </button>
          <button class="user-pill" data-action="nav" data-screen="settings">
            ${icon("user-round")}
            Liam
          </button>
        </div>
      </header>

      <div class="app-body">
        <aside class="sidebar" aria-label="Primary navigation">
          ${navButton("dashboard", "Dashboard", "layout-dashboard")}
          ${navButton("collection", "Collection", "layers")}
          ${navButton("add", "Add item", "plus-circle")}
          ${navButton("sets", "Sets", "gallery-vertical-end")}
          ${navButton("wishlist", "Wishlist", "heart")}
          ${navButton("analytics", "Analytics", "chart-no-axes-combined")}
          <div class="nav-divider"></div>
          ${navButton("settings", "Settings", "settings")}
        </aside>

        <main class="main">
          ${content}
        </main>
      </div>

      <nav class="bottom-nav" aria-label="Primary navigation">
        ${bottomNavButton("dashboard", "Home", "layout-dashboard")}
        ${bottomNavButton("collection", "Cards", "layers")}
        ${bottomNavButton("add", "Add", "plus")}
        ${bottomNavButton("sets", "Sets", "gallery-vertical-end")}
        ${bottomNavButton("wishlist", "Want", "heart")}
      </nav>

      <div class="toast ${state.toast ? "" : "hidden"}" role="status">
        ${state.toast}
      </div>
    </div>
  `;

  if (window.lucide) {
    window.lucide.createIcons();
  }
}

function render() {
  const screens = {
    dashboard: renderDashboard,
    collection: renderCollection,
    add: renderAdd,
    item: renderItemDetail,
    sets: renderSets,
    setDetail: renderSetDetail,
    wishlist: renderWishlist,
    analytics: renderAnalytics,
    settings: renderSettings,
  };

  renderShell((screens[state.screen] || renderDashboard)());
}

function renderPageHeader(title, lede, actions = "") {
  return `
    <div class="page-header">
      <div>
        <p class="eyebrow">Prototype</p>
        <h1>${title}</h1>
        <p class="lede">${lede}</p>
      </div>
      <div class="actions">${actions}</div>
    </div>
  `;
}

function renderDashboard() {
  const summary = collectionSummary();
  const wish = wishlistSummary();
  const gain = summary.value - summary.cost;
  const recent = state.collection.slice(-3).reverse();

  return `
    <section class="page">
      ${renderPageHeader(
        "Dashboard",
        "Your collection, set progress, and next collector moves in one view.",
        `<button class="button primary" data-action="nav" data-screen="add">${icon("plus")}Add item</button>`,
      )}

      <div class="stats-grid grid">
        ${statCard("Collection value", money(summary.value), `${summary.unvalued} unvalued items`)}
        ${statCard("Gain/loss", money(gain), `${money(summary.cost)} cost basis`, gain >= 0)}
        ${statCard("Items tracked", summary.items, `${summary.cards} cards | ${summary.sealed} sealed`)}
        ${statCard("Wishlist", wish.items, `${money(wish.value)} target total`)}
      </div>

      <div class="dashboard-grid grid">
        <div class="grid">
          <section class="panel">
            <div class="page-header">
              <div>
                <h2>Recent additions</h2>
                <p class="muted">Freshly tracked cards and sealed products.</p>
              </div>
            </div>
            <div class="item-list">
              ${recent.map(renderOwnedCard).join("")}
            </div>
          </section>

          <section class="panel">
            <div class="page-header">
              <div>
                <h2>Set progress</h2>
                <p class="muted">A quick read on the sets you are building.</p>
              </div>
              <button class="button" data-action="nav" data-screen="sets">${icon("arrow-right")}View all</button>
            </div>
            <div class="set-list">
              ${setData.map(renderSetCard).join("")}
            </div>
          </section>
        </div>

        <aside class="grid">
          <section class="panel">
            <h2>Quick actions</h2>
            <div class="actions">
              <button class="button primary" data-action="start-add" data-type="card">${icon("badge-plus")}Add card</button>
              <button class="button" data-action="start-add" data-type="sealed">${icon("package-plus")}Add sealed</button>
              <button class="button" data-action="nav" data-screen="wishlist">${icon("heart")}Wishlist</button>
            </div>
          </section>

          <section class="panel">
            <h2>Wishlist</h2>
            <p class="muted">${wish.items} wanted items with ${money(wish.value)} in targets.</p>
            <div class="wishlist-list" style="margin-top: 12px;">
              ${state.wishlist.slice(0, 2).map(renderWishlistCard).join("")}
            </div>
          </section>

          <section class="panel">
            <div class="item-title-row">
              <div>
                <h2>Plus analytics</h2>
                <p class="muted">Trends, alerts, ROI, and duplicate opportunities.</p>
              </div>
              <span class="status-pill">${state.plus ? "Unlocked" : "Preview"}</span>
            </div>
            <div class="mini-chart" aria-label="Value trend preview" style="margin-top: 12px;">
              <span style="height: 42%;"></span>
              <span style="height: 50%;"></span>
              <span style="height: 47%;"></span>
              <span style="height: 66%;"></span>
              <span style="height: 72%;"></span>
              <span style="height: 81%;"></span>
              <span style="height: 92%;"></span>
            </div>
            <button class="button full" data-action="nav" data-screen="analytics" style="margin-top: 12px;">
              ${icon("chart-no-axes-combined")}Open analytics
            </button>
          </section>
        </aside>
      </div>
    </section>
  `;
}

function statCard(label, value, note, good = false) {
  return `
    <article class="stat-card">
      <div class="stat-label">${label}</div>
      <div class="stat-value ${good ? "stat-good" : ""}">${value}</div>
      <div class="stat-note">${note}</div>
    </article>
  `;
}

function renderOwnedCard(item) {
  const catalogueItem = getCatalogueItem(item.catalogueId);
  if (!catalogueItem) {
    return "";
  }

  return `
    <button class="item-card clickable" data-action="open-item" data-id="${item.id}">
      <div class="item-image">${imageFor(catalogueItem)}</div>
      <div class="item-main">
        <div class="item-title-row">
          <div>
            <p class="item-title">${catalogueItem.name}</p>
            <p class="item-meta">${catalogueItem.set} | ${catalogueItem.number}</p>
          </div>
          <span class="confidence-pill">${catalogueItem.confidence}</span>
        </div>
        <div class="tag-row">
          <span class="tag">${item.condition}</span>
          <span class="tag">${item.language}</span>
          <span class="tag blue">Qty ${item.quantity}</span>
        </div>
        <div class="item-value">${money(getOwnedValue(item))}</div>
      </div>
    </button>
  `;
}

function renderCollection() {
  const filters = [
    ["all", "All"],
    ["card", "Cards"],
    ["sealed", "Sealed"],
    ["graded", "Graded"],
    ["unknown", "Unknown value"],
  ];

  const items = state.collection.filter((item) => {
    const catalogueItem = getCatalogueItem(item.catalogueId);
    if (state.collectionFilter === "all") {
      return true;
    }
    if (state.collectionFilter === "graded") {
      return item.graded !== "Raw" && item.graded !== "N/A";
    }
    if (state.collectionFilter === "unknown") {
      return getOwnedValue(item) === null;
    }
    return catalogueItem?.type === state.collectionFilter;
  });

  return `
    <section class="page">
      ${renderPageHeader(
        "Collection",
        "Browse tracked cards and sealed products with value, condition, and storage context.",
        `<button class="button primary" data-action="nav" data-screen="add">${icon("plus")}Add item</button>`,
      )}

      <section class="panel">
        <div class="toolbar">
          <input class="search-input" data-role="collection-search" placeholder="Search by card, set, or product" aria-label="Search collection">
          <div class="filter-row">
            ${filters
              .map(
                ([id, label]) => `
                  <button class="filter-chip ${state.collectionFilter === id ? "active" : ""}" data-action="collection-filter" data-filter="${id}">
                    ${label}
                  </button>
                `,
              )
              .join("")}
          </div>
        </div>
      </section>

      <section class="mobile-only">
        <div class="item-list" data-role="collection-list">
          ${items.length ? items.map(renderOwnedCard).join("") : renderEmptyCollection()}
        </div>
      </section>

      <section class="table-wrap desktop-only" data-role="collection-table">
        ${renderCollectionTable(items)}
      </section>
    </section>
  `;
}

function renderCollectionTable(items) {
  if (!items.length) {
    return `<div class="empty-state">${renderEmptyCollection()}</div>`;
  }

  return `
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
          <th>Action</th>
        </tr>
      </thead>
      <tbody>
        ${items
          .map((item) => {
            const catalogueItem = getCatalogueItem(item.catalogueId);
            return `
              <tr>
                <td>
                  <div class="table-item">
                    <div class="table-thumb">${imageFor(catalogueItem)}</div>
                    <div>
                      <strong>${catalogueItem.name}</strong><br>
                      <span class="muted">${catalogueItem.set} | ${catalogueItem.number}</span>
                    </div>
                  </div>
                </td>
                <td>${catalogueItem.type === "sealed" ? "Sealed" : "Card"}</td>
                <td>${item.condition}</td>
                <td>${item.quantity}</td>
                <td>${money(getCostBasis(item))}</td>
                <td><strong>${money(getOwnedValue(item))}</strong></td>
                <td>${item.location || "Unassigned"}</td>
                <td>
                  <button class="button" data-action="open-item" data-id="${item.id}">${icon("external-link")}Open</button>
                </td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

function renderEmptyCollection() {
  return `
    <div class="empty-state">
      <h2>No items here yet</h2>
      <p class="muted">Start with a card, sealed product, or wishlist target.</p>
      <div class="actions" style="justify-content: center;">
        <button class="button primary" data-action="start-add" data-type="card">${icon("badge-plus")}Add card</button>
        <button class="button" data-action="start-add" data-type="sealed">${icon("package-plus")}Add sealed</button>
      </div>
    </div>
  `;
}

function renderAdd() {
  const results = catalogue.filter((item) =>
    state.addType === "card" ? item.type === "card" : item.type === "sealed",
  );
  const selected = getCatalogueItem(state.selectedCatalogueId) || results[0];

  if (!state.selectedCatalogueId || selected.type !== state.addType) {
    state.selectedCatalogueId = results[0]?.id;
  }

  return `
    <section class="page">
      ${renderPageHeader(
        "Add item",
        "Search the catalogue, pick the match, and save the details you know.",
        `<button class="button" data-action="nav" data-screen="collection">${icon("x")}Cancel</button>`,
      )}

      <div class="screen-split">
        <section class="panel">
          <div class="segmented" role="group" aria-label="Item type">
            <button class="${state.addType === "card" ? "active" : ""}" data-action="add-type" data-type="card">Card</button>
            <button class="${state.addType === "sealed" ? "active" : ""}" data-action="add-type" data-type="sealed">Sealed product</button>
          </div>

          <div class="field" style="margin-top: 14px;">
            <label for="add-search">Search</label>
            <input id="add-search" data-role="add-search" placeholder="${state.addType === "card" ? "Charizard 151" : "Booster box"}">
          </div>

          <div class="result-list" style="margin-top: 14px;" data-role="add-results">
            ${results.map((item) => renderCatalogueResult(item, item.id === state.selectedCatalogueId)).join("")}
          </div>

          ${
            state.addType === "sealed"
              ? `<button class="button full" data-action="manual-sealed" style="margin-top: 12px;">${icon("package-plus")}Create manual sealed product</button>`
              : ""
          }
        </section>

        <section class="panel">
          <h2>Owned details</h2>
          ${renderSelectedPreview(selected)}
          <form class="grid" data-role="add-form" style="margin-top: 14px;">
            <div class="field-grid">
              <div class="field">
                <label for="condition">Condition</label>
                <select id="condition" name="condition">
                  <option>Near mint</option>
                  <option>Excellent</option>
                  <option>Light played</option>
                  <option>Played</option>
                  <option>Sealed</option>
                  <option>Unknown</option>
                </select>
              </div>
              <div class="field">
                <label for="language">Language</label>
                <select id="language" name="language">
                  <option>English</option>
                  <option>Japanese</option>
                  <option>German</option>
                  <option>French</option>
                  <option>Other</option>
                </select>
              </div>
              <div class="field">
                <label for="quantity">Quantity</label>
                <input id="quantity" name="quantity" type="number" min="1" value="1">
              </div>
              <div class="field">
                <label for="paid">Paid</label>
                <input id="paid" name="paid" inputmode="decimal" placeholder="GBP 0.00">
              </div>
              <div class="field">
                <label for="location">Location</label>
                <select id="location" name="location">
                  <option>Blue Binder</option>
                  <option>Sealed Box 1</option>
                  <option>Safe</option>
                  <option>Unassigned</option>
                </select>
              </div>
              <div class="field">
                <label for="variant">Variant</label>
                <input id="variant" name="variant" value="${selected.type === "sealed" ? "Factory sealed" : "Standard"}">
              </div>
            </div>
            <div class="field">
              <label for="notes">Notes</label>
              <textarea id="notes" name="notes" placeholder="Optional"></textarea>
            </div>
            <div class="actions">
              <button class="button primary" type="submit">${icon("save")}Save to collection</button>
              <button class="button" type="button" data-action="add-selected-to-wishlist">${icon("heart")}Add to wishlist</button>
            </div>
          </form>
        </section>
      </div>
    </section>
  `;
}

function renderCatalogueResult(item, selected) {
  return `
    <button class="item-card clickable ${selected ? "selected" : ""}" data-action="select-catalogue" data-id="${item.id}">
      <div class="item-image">${imageFor(item)}</div>
      <div class="item-main">
        <div class="item-title-row">
          <div>
            <p class="item-title">${item.name}</p>
            <p class="item-meta">${item.set} | ${item.number}</p>
          </div>
          <span class="tag ${selected ? "green" : ""}">${selected ? "Selected" : item.rarity}</span>
        </div>
        <div class="item-value">${money(item.value)}</div>
      </div>
    </button>
  `;
}

function renderSelectedPreview(item) {
  if (!item) {
    return "";
  }

  return `
    <div class="item-card">
      <div class="item-image">${imageFor(item)}</div>
      <div class="item-main">
        <p class="item-title">${item.name}</p>
        <p class="item-meta">${item.set} | ${item.number}</p>
        <div class="tag-row">
          <span class="tag">${item.rarity}</span>
          <span class="tag blue">${item.confidence}</span>
        </div>
      </div>
    </div>
  `;
}

function renderItemDetail() {
  const owned = getOwnedItem(state.selectedItemId) || state.collection[0];
  const item = getCatalogueItem(owned.catalogueId);
  const value = getOwnedValue(owned);
  const cost = getCostBasis(owned);
  const gain = value !== null && cost !== null ? value - cost : null;

  return `
    <section class="page">
      <div class="page-header">
        <div>
          <p class="eyebrow">${item.type === "sealed" ? "Sealed product" : "Card"}</p>
          <h1>${item.name}</h1>
          <p class="lede">${item.set} | ${item.number}</p>
        </div>
        <div class="actions">
          <button class="button" data-action="nav" data-screen="collection">${icon("arrow-left")}Collection</button>
          <button class="button primary" data-action="duplicate-item" data-id="${owned.id}">${icon("copy-plus")}Duplicate lot</button>
        </div>
      </div>

      <div class="detail-layout">
        <div class="detail-image">${imageFor(item)}</div>

        <div class="detail-stack">
          <section class="panel">
            <h2>Owned details</h2>
            <div class="metric-list">
              ${metricRow("Quantity", owned.quantity)}
              ${metricRow("Condition", owned.condition)}
              ${metricRow("Language", owned.language)}
              ${metricRow("Variant", owned.variant)}
              ${metricRow("Grade", owned.graded)}
              ${metricRow("Location", owned.location || "Unassigned")}
            </div>
          </section>

          <section class="panel">
            <h2>Value</h2>
            <div class="metric-list">
              ${metricRow("Estimated value", money(value))}
              ${metricRow("Cost basis", money(cost))}
              ${metricRow("Gain/loss", money(gain), gain >= 0 ? "stat-good" : "")}
              ${metricRow("Confidence", item.confidence)}
              ${metricRow("Source", owned.overrideValue ? "Manual override" : "Prototype snapshot")}
            </div>
          </section>

          <section class="panel">
            <h2>Notes</h2>
            <p class="muted">${owned.notes || "No notes yet."}</p>
          </section>
        </div>
      </div>
    </section>
  `;
}

function metricRow(label, value, valueClass = "") {
  return `
    <div class="metric-row">
      <span>${label}</span>
      <span class="${valueClass}">${value ?? "Unknown"}</span>
    </div>
  `;
}

function renderSets() {
  return `
    <section class="page">
      ${renderPageHeader(
        "Sets",
        "Track completion by set and jump into missing or wishlisted cards.",
        "",
      )}

      <section class="panel">
        <input class="search-input" data-role="set-search" placeholder="Search sets" aria-label="Search sets">
      </section>

      <section class="set-list" data-role="set-list">
        ${setData.map(renderSetCard).join("")}
      </section>
    </section>
  `;
}

function renderSetCard(set) {
  const done = percent(set.owned, set.total);
  return `
    <button class="set-card" data-action="open-set" data-id="${set.id}">
      <div class="set-card-header">
        <div>
          <div class="set-name">${set.name}</div>
          <div class="muted">${set.owned} / ${set.total} owned</div>
        </div>
        <div class="set-percent">${done}%</div>
      </div>
      <div class="progress"><span style="width: ${done}%;"></span></div>
    </button>
  `;
}

function renderSetDetail() {
  const set = setData.find((item) => item.id === state.selectedSetId) || setData[0];
  const done = percent(set.owned, set.total);
  const setCards = catalogue.filter(
    (item) => item.type === "card" && item.set === set.name,
  );

  return `
    <section class="page">
      <div class="page-header">
        <div>
          <p class="eyebrow">Set progress</p>
          <h1>${set.name}</h1>
          <p class="lede">${set.owned} / ${set.total} owned | ${done}% complete</p>
        </div>
        <button class="button" data-action="nav" data-screen="sets">${icon("arrow-left")}Sets</button>
      </div>

      <section class="panel">
        <div class="progress"><span style="width: ${done}%;"></span></div>
        <div class="segmented" role="group" aria-label="Set filter" style="margin-top: 14px;">
          ${["all", "owned", "missing", "want"]
            .map(
              (id) => `
                <button class="${state.setFilter === id ? "active" : ""}" data-action="set-filter" data-filter="${id}">
                  ${id[0].toUpperCase()}${id.slice(1)}
                </button>
              `,
            )
            .join("")}
        </div>
      </section>

      <section class="item-list">
        ${setCards.map((item, index) => renderSetCardRow(item, index)).join("")}
      </section>
    </section>
  `;
}

function renderSetCardRow(item, index) {
  const owned = state.collection.some((entry) => entry.catalogueId === item.id);
  const wanted = state.wishlist.some((entry) => entry.catalogueId === item.id);
  const missing = !owned;

  if (state.setFilter === "owned" && !owned) {
    return "";
  }
  if (state.setFilter === "missing" && !missing) {
    return "";
  }
  if (state.setFilter === "want" && !wanted) {
    return "";
  }

  return `
    <div class="item-card">
      <div class="item-image">${imageFor(item)}</div>
      <div class="item-main">
        <div class="item-title-row">
          <div>
            <p class="item-title">${item.name}</p>
            <p class="item-meta">${item.set} | ${item.number}</p>
          </div>
          <span class="tag ${owned ? "green" : wanted ? "amber" : ""}">
            ${owned ? "Owned" : wanted ? "Want" : "Missing"}
          </span>
        </div>
        <div class="actions" style="margin-top: 10px;">
          ${
            owned
              ? `<button class="button" data-action="open-owned-by-catalogue" data-id="${item.id}">${icon("external-link")}Open</button>`
              : `<button class="button primary" data-action="quick-add-from-set" data-id="${item.id}">${icon("plus")}Add</button>`
          }
          ${
            wanted
              ? `<button class="button" data-action="nav" data-screen="wishlist">${icon("heart")}Wishlist</button>`
              : `<button class="button" data-action="wishlist-catalogue" data-id="${item.id}">${icon("heart")}Want</button>`
          }
        </div>
      </div>
    </div>
  `;
}

function renderWishlist() {
  const wish = wishlistSummary();

  return `
    <section class="page">
      ${renderPageHeader(
        "Wishlist",
        `${wish.items} wanted items with ${money(wish.value)} in targets.`,
        `<button class="button primary" data-action="nav" data-screen="add">${icon("plus")}Add target</button>`,
      )}

      <section class="panel">
        <div class="filter-row">
          <button class="filter-chip active">All</button>
          <button class="filter-chip">High</button>
          <button class="filter-chip">Grail</button>
          <button class="filter-chip">Price target</button>
        </div>
      </section>

      <section class="wishlist-list">
        ${
          state.wishlist.length
            ? state.wishlist.map(renderWishlistCard).join("")
            : `<div class="empty-state">
                <h2>No wishlist items yet</h2>
                <p class="muted">Track cards and sealed products you want next.</p>
                <button class="button primary" data-action="nav" data-screen="sets">${icon("gallery-vertical-end")}Browse sets</button>
              </div>`
        }
      </section>
    </section>
  `;
}

function renderWishlistCard(item) {
  const catalogueItem = getCatalogueItem(item.catalogueId);
  if (!catalogueItem) {
    return "";
  }

  return `
    <article class="item-card">
      <div class="item-image">${imageFor(catalogueItem)}</div>
      <div class="item-main">
        <div class="item-title-row">
          <div>
            <p class="item-title">${catalogueItem.name}</p>
            <p class="item-meta">${catalogueItem.set} | ${catalogueItem.number}</p>
          </div>
          <span class="priority-pill">${item.priority}</span>
        </div>
        <div class="item-value">Target ${money(item.targetPrice ?? catalogueItem.value)}</div>
        <p class="muted">${item.notes || ""}</p>
        <div class="actions" style="margin-top: 10px;">
          <button class="button primary" data-action="move-wishlist" data-id="${item.id}">${icon("check")}Move to collection</button>
          <button class="button" data-action="remove-wishlist" data-id="${item.id}">${icon("trash-2")}Remove</button>
        </div>
      </div>
    </article>
  `;
}

function renderAnalytics() {
  const summary = collectionSummary();
  const gain = summary.value - summary.cost;

  if (!state.plus) {
    return `
      <section class="page">
        ${renderPageHeader(
          "Analytics",
          "Plus unlocks deeper collection trends, alerts, and decision support.",
          "",
        )}

        <div class="screen-split">
          <section class="panel">
            <h2>Preview</h2>
            <div class="locked-preview">
              <div class="locked-tile"><strong>Value over time</strong><span class="tag red">Locked</span></div>
              <div class="locked-tile"><strong>Best performers</strong><span class="tag red">Locked</span></div>
              <div class="locked-tile"><strong>Duplicates to review</strong><span class="tag red">Locked</span></div>
              <div class="locked-tile"><strong>Price alerts</strong><span class="tag red">Locked</span></div>
            </div>
          </section>

          <section class="panel">
            <h2>Start Plus</h2>
            <p class="muted">Free includes tracking, sets, wishlist, manual values, and CSV export.</p>
            <div class="metric-list" style="margin-top: 12px;">
              ${metricRow("Monthly", "GBP 2.49")}
              ${metricRow("Yearly", "Discounted")}
              ${metricRow("Access", "Analytics, alerts, reports")}
            </div>
            <button class="button primary full" data-action="unlock-plus" style="margin-top: 12px;">${icon("sparkles")}Simulate Plus</button>
          </section>
        </div>
      </section>
    `;
  }

  return `
    <section class="page">
      ${renderPageHeader(
        "Analytics",
        "Full collection intelligence for value, performance, and next moves.",
        `<span class="plan-pill">${icon("sparkles")}Plus active</span>`,
      )}

      <div class="stats-grid grid">
        ${statCard("Current value", money(summary.value), `${summary.items} tracked items`)}
        ${statCard("Cost basis", money(summary.cost), "Known purchase prices")}
        ${statCard("Gain/loss", money(gain), "Against known cost", gain >= 0)}
        ${statCard("Duplicates", "8", "Worth reviewing")}
      </div>

      <div class="dashboard-grid grid">
        <section class="panel">
          <h2>Value over time</h2>
          <div class="mini-chart" aria-label="Value over time">
            <span style="height: 39%;"></span>
            <span style="height: 45%;"></span>
            <span style="height: 52%;"></span>
            <span style="height: 58%;"></span>
            <span style="height: 64%;"></span>
            <span style="height: 74%;"></span>
            <span style="height: 88%;"></span>
          </div>
        </section>

        <section class="panel">
          <h2>Opportunities</h2>
          <div class="metric-list">
            ${metricRow("Best performer", "Umbreon VMAX")}
            ${metricRow("Duplicate value", "GBP 128.00")}
            ${metricRow("Grading candidate", "Charizard ex")}
            ${metricRow("Wishlist gap", money(wishlistSummary().value))}
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderSettings() {
  return `
    <section class="page">
      ${renderPageHeader("Settings", "Account, preferences, billing, and data ownership.", "")}

      <div class="screen-split">
        <section class="panel">
          <h2>Profile</h2>
          <div class="metric-list">
            ${metricRow("Name", "Liam")}
            ${metricRow("Email", "liam@example.com")}
            ${metricRow("Currency", "GBP")}
            ${metricRow("Region", "United Kingdom")}
          </div>
        </section>

        <section class="panel">
          <h2>Subscription</h2>
          <div class="metric-list">
            ${metricRow("Plan", state.plus ? "Plus" : "Free")}
            ${metricRow("Billing", state.plus ? "Active prototype" : "Not connected")}
          </div>
          <button class="button primary full" data-action="unlock-plus" style="margin-top: 12px;">${icon("sparkles")}Simulate Plus</button>
        </section>

        <section class="panel">
          <h2>Data</h2>
          <div class="actions">
            <button class="button" data-action="prototype-export">${icon("download")}Export CSV</button>
            <button class="button" data-action="prototype-import">${icon("upload")}Import CSV</button>
            <button class="button" data-action="reset-prototype">${icon("rotate-ccw")}Reset prototype</button>
          </div>
        </section>

        <section class="panel">
          <h2>Storage locations</h2>
          <div class="tag-row">
            <span class="tag">Blue Binder</span>
            <span class="tag">Sealed Box 1</span>
            <span class="tag">Safe</span>
          </div>
        </section>
      </div>
    </section>
  `;
}

function setToast(message) {
  state.toast = message;
  render();

  window.clearTimeout(setToast.timer);
  setToast.timer = window.setTimeout(() => {
    state.toast = "";
    render();
  }, 2200);
}

function addCollectionItem(catalogueId, formData = {}) {
  const item = getCatalogueItem(catalogueId);
  const quantity = Number(formData.quantity || 1);
  const paidInput = String(formData.paid || "").replace(/[^0-9.]/g, "");
  const paid = paidInput ? Math.round(Number(paidInput) * 100) : undefined;

  const collectionItem = {
    id: `owned-${Date.now()}`,
    catalogueId,
    quantity: Number.isFinite(quantity) && quantity > 0 ? quantity : 1,
    condition: formData.condition || (item.type === "sealed" ? "Sealed" : "Near mint"),
    language: formData.language || "English",
    variant: formData.variant || (item.type === "sealed" ? "Factory sealed" : "Standard"),
    graded: item.type === "sealed" ? "N/A" : "Raw",
    purchasePrice: paid,
    purchaseDate: new Date().toISOString().slice(0, 10),
    location: formData.location || "Unassigned",
    notes: formData.notes || "",
  };

  state.collection.push(collectionItem);
  state.selectedItemId = collectionItem.id;
  saveState();
  setToast(`${item.name} added to collection.`);
  state.screen = "item";
  render();
}

function addWishlistItem(catalogueId) {
  const exists = state.wishlist.some((item) => item.catalogueId === catalogueId);
  const catalogueItem = getCatalogueItem(catalogueId);

  if (!exists) {
    state.wishlist.push({
      id: `want-${Date.now()}`,
      catalogueId,
      priority: catalogueItem.value > 10000 ? "Grail" : "High",
      targetPrice: catalogueItem.value,
      notes: "Added from prototype.",
    });
    saveState();
  }

  setToast(`${catalogueItem.name} added to wishlist.`);
}

app.addEventListener("click", (event) => {
  const actionTarget = event.target.closest("[data-action]");
  if (!actionTarget) {
    return;
  }

  const { action } = actionTarget.dataset;

  if (action === "nav") {
    state.screen = actionTarget.dataset.screen;
    render();
  }

  if (action === "start-add") {
    state.addType = actionTarget.dataset.type;
    state.selectedCatalogueId =
      catalogue.find((item) => item.type === state.addType)?.id || "";
    state.screen = "add";
    render();
  }

  if (action === "collection-filter") {
    state.collectionFilter = actionTarget.dataset.filter;
    render();
  }

  if (action === "add-type") {
    state.addType = actionTarget.dataset.type;
    state.selectedCatalogueId =
      catalogue.find((item) => item.type === state.addType)?.id || "";
    render();
  }

  if (action === "select-catalogue") {
    state.selectedCatalogueId = actionTarget.dataset.id;
    render();
  }

  if (action === "add-selected-to-wishlist") {
    addWishlistItem(state.selectedCatalogueId);
  }

  if (action === "manual-sealed") {
    state.selectedCatalogueId = "sealed-151-bundle";
    setToast("Manual sealed product flow selected for prototype.");
  }

  if (action === "open-item") {
    state.selectedItemId = actionTarget.dataset.id;
    state.screen = "item";
    render();
  }

  if (action === "duplicate-item") {
    const item = getOwnedItem(actionTarget.dataset.id);
    if (item) {
      const copy = { ...item, id: `owned-${Date.now()}`, notes: `${item.notes} Duplicate lot.` };
      state.collection.push(copy);
      state.selectedItemId = copy.id;
      saveState();
      setToast("Lot duplicated.");
    }
  }

  if (action === "open-set") {
    state.selectedSetId = actionTarget.dataset.id;
    state.screen = "setDetail";
    render();
  }

  if (action === "set-filter") {
    state.setFilter = actionTarget.dataset.filter;
    render();
  }

  if (action === "open-owned-by-catalogue") {
    const owned = state.collection.find((item) => item.catalogueId === actionTarget.dataset.id);
    if (owned) {
      state.selectedItemId = owned.id;
      state.screen = "item";
      render();
    }
  }

  if (action === "quick-add-from-set") {
    state.selectedCatalogueId = actionTarget.dataset.id;
    state.addType = "card";
    state.screen = "add";
    render();
  }

  if (action === "wishlist-catalogue") {
    addWishlistItem(actionTarget.dataset.id);
    render();
  }

  if (action === "move-wishlist") {
    const wish = state.wishlist.find((item) => item.id === actionTarget.dataset.id);
    if (wish) {
      state.wishlist = state.wishlist.filter((item) => item.id !== wish.id);
      addCollectionItem(wish.catalogueId, {
        quantity: 1,
        condition: "Near mint",
        language: "English",
        location: "Blue Binder",
      });
    }
  }

  if (action === "remove-wishlist") {
    state.wishlist = state.wishlist.filter((item) => item.id !== actionTarget.dataset.id);
    saveState();
    setToast("Wishlist item removed.");
  }

  if (action === "unlock-plus") {
    state.plus = true;
    setToast("Plus unlocked for this prototype session.");
    state.screen = "analytics";
    render();
  }

  if (action === "prototype-export") {
    setToast("CSV export is represented here; backend export comes later.");
  }

  if (action === "prototype-import") {
    setToast("CSV import is planned for the MVP build.");
  }

  if (action === "reset-prototype") {
    localStorage.removeItem("mintbinder-prototype-collection");
    localStorage.removeItem("mintbinder-prototype-wishlist");
    state.collection = initialCollection;
    state.wishlist = initialWishlist;
    state.plus = false;
    state.screen = "dashboard";
    setToast("Prototype data reset.");
  }
});

app.addEventListener("submit", (event) => {
  if (!event.target.matches("[data-role='add-form']")) {
    return;
  }

  event.preventDefault();
  const formData = Object.fromEntries(new FormData(event.target).entries());
  addCollectionItem(state.selectedCatalogueId, formData);
});

app.addEventListener("input", (event) => {
  if (event.target.matches("[data-role='collection-search']")) {
    const query = event.target.value.trim().toLowerCase();
    const cards = [...document.querySelectorAll("[data-role='collection-list'] .item-card")];
    cards.forEach((card) => {
      card.classList.toggle("hidden", !card.textContent.toLowerCase().includes(query));
    });
  }

  if (event.target.matches("[data-role='add-search']")) {
    const query = event.target.value.trim().toLowerCase();
    const cards = [...document.querySelectorAll("[data-role='add-results'] .item-card")];
    cards.forEach((card) => {
      card.classList.toggle("hidden", !card.textContent.toLowerCase().includes(query));
    });
  }

  if (event.target.matches("[data-role='set-search']")) {
    const query = event.target.value.trim().toLowerCase();
    const cards = [...document.querySelectorAll("[data-role='set-list'] .set-card")];
    cards.forEach((card) => {
      card.classList.toggle("hidden", !card.textContent.toLowerCase().includes(query));
    });
  }
});

render();

# PokeStop MVP Spec

## MVP Goal

Build a mobile-first web/PWA MVP that lets users track Pokemon cards and sealed products, understand basic collection value, manage wishlists, and view set progress. The MVP should also establish the data and subscription foundations needed for advanced analytics later.

The MVP should prove:

- Users can build a collection quickly.
- Users can see useful value and progress information.
- The app has a credible reason to exist beyond a spreadsheet.
- Free and Plus boundaries are clear enough to support monetization.

## Recommended Technical Direction

The recommended initial stack is:

- Frontend: Next.js with TypeScript.
- Backend: Next.js API routes or a dedicated TypeScript API service.
- Database: PostgreSQL.
- ORM: Prisma.
- Auth: managed auth or app-native email/password plus OAuth later.
- Payments: Square by default, with Stripe retained as a fallback provider.
- Storage: S3-compatible object storage for future owned-copy photos and exports.
- Background jobs: scheduled workers for catalogue sync and price snapshots.

The fuller technical plan lives in [ARCHITECTURE.md](ARCHITECTURE.md).

The architecture should keep these areas separate:

- Catalogue data.
- User-owned collection data.
- Pricing providers.
- Subscription entitlements.
- Import/export.

## MVP User Roles

### Visitor

Can view landing/auth screens but cannot create a collection.

### Free User

Can track a useful collection and use core hobby features.

### Plus User

Can access advanced analytics, richer pricing, alerts, and organization tools.

### Admin

Can manage catalogue imports, sealed products, pricing sources, and basic operational data.

## MVP Scope

### Must Have

- User account creation and login.
- Card search by name, set, number, and rarity where data allows.
- Sealed product search or manual creation.
- Add card to collection.
- Add sealed product to collection.
- Edit owned item details.
- Remove owned item.
- Quantity support.
- Condition support.
- Language support.
- Raw or graded status.
- Purchase price and purchase date.
- Manual current value override.
- Wishlist.
- Set completion view.
- Basic collection dashboard.
- CSV export.
- Subscription entitlement model.
- Free/Plus feature gates, even if Plus checkout arrives slightly later.

### Should Have

- CSV import.
- Storage location field.
- Notes field.
- Basic duplicate view.
- Basic gain/loss calculation.
- Simple price snapshot table.
- Manual sealed product valuation.
- Admin catalogue import command or screen.

### Could Have

- Price alerts.
- Binder visualizer.
- Grading calculator.
- Owned-copy image uploads.
- Public collection sharing.
- Trade matching.
- Native mobile app.

### Not In MVP

- Marketplace selling.
- Direct buying.
- Automated eBay listing creation.
- Full social network features.
- AI card scanning.
- Full master set variant logic for every edge case.
- Native app store releases.
- Tax reporting.

## Free Vs Plus MVP Boundary

### Free

- Add, edit, duplicate, sell/remove, and manage cards.
- Add, edit, duplicate, sell/remove, and manage sealed products, including private manual sealed-product entries.
- Quantity, condition, language, variant, grade, purchase price/date, notes, manual current value, and storage-location tracking.
- Basic dashboard with collection value, gain/loss, item mix, unvalued item count, recent history, and quick actions.
- Collection search, filters, sorting, grid/list view, and desktop table view.
- Basic collection review signals.
- Wishlist with priorities, target prices, notes, and move-to-collection flow.
- Set progress and set detail views.
- Light and dark themes.
- Item-level market value, source/confidence labels, and limited price-history context where pricing data exists.
- Notification preferences can be configured, but automated email delivery requires Plus.
- CSV import, CSV export, and import template download.

### Plus

- Full portfolio analytics dashboard.
- Portfolio value movement/history, collection health, portfolio mix, best/worst performer, realised sales, and gain/loss analysis.
- Deeper weak-price, duplicate review, grading opportunity, and collection-health insights.
- Price alert emails, wishlist target digests, and weak-price confidence digests.
- Insurance report export.
- Extended theme palette with collector-style colour schemes.
- Richer price-confidence and reporting views as pricing sources mature.
- Priority access to future advanced reporting and automation tools.

For MVP, Plus features can be partially implemented behind gates while the product validates demand.

## Core Screens

The screen-level UX plan and wireframes live in [UX_WIREFRAMES.md](UX_WIREFRAMES.md).

### 1. Dashboard

Purpose: give users a fast summary of the collection.

Content:

- Total collection value.
- Total items.
- Cards versus sealed products.
- Recent additions.
- Wishlist count.
- Set progress highlights.
- Basic gain/loss if purchase prices exist.
- Prompts for useful next actions.

### 2. Collection

Purpose: browse, search, and manage owned items.

Content:

- Search.
- Filters for item type, set, condition, language, value, graded status, and storage location.
- Sort by value, date added, set number, name, or gain/loss.
- List/grid toggle.
- Bulk actions later.

### 3. Add Item

Purpose: make adding a card or sealed product fast.

Flow:

1. Search catalogue.
2. Select card or sealed product.
3. Enter quantity, condition, language, purchase price, purchase date, storage location, notes, and graded status.
4. Save to collection or wishlist.

### 4. Item Detail

Purpose: show the user's owned copy plus catalogue and pricing context.

Content:

- Card or product image.
- Set and numbering.
- Owned quantity.
- Condition/language/variant.
- Purchase data.
- Current estimated value.
- Manual override.
- Price source and confidence where available.
- History later.

### 5. Set Progress

Purpose: help collectors complete sets.

Content:

- Set list.
- Completion percentage.
- Owned/missing counts.
- Missing cards.
- Wishlist shortcuts.
- Duplicate indicators later.

### 6. Wishlist

Purpose: track desired cards and products.

Content:

- Wishlist items.
- Target price.
- Priority.
- Notes.
- Estimated total cost.
- Move to collection.

### 7. Analytics

Purpose: deliver the Plus subscription value.

Content:

- Total value over time.
- Cost basis.
- Gain/loss.
- Best performers.
- Worst performers.
- Sealed versus singles.
- Condition breakdown.
- Set breakdown.
- Duplicate opportunities.

### 8. Settings

Purpose: account and data ownership.

Content:

- Profile.
- Subscription status.
- Billing link.
- Import/export.
- Data deletion.
- Currency and region.

## Primary User Flows

### Add First Card

1. User signs up.
2. User searches for a card.
3. User selects the correct card.
4. User enters condition and quantity.
5. User optionally enters purchase price.
6. User sees the dashboard update.

Acceptance criteria:

- Flow can be completed in under 60 seconds.
- User can skip unknown details.
- Item appears immediately in collection and dashboard.

### Track A Set

1. User opens Set Progress.
2. User selects a set.
3. User sees owned and missing cards.
4. User adds missing cards to wishlist.

Acceptance criteria:

- Completion percentage updates after collection changes.
- Missing card list is filterable/searchable.

### Add Sealed Product

1. User searches sealed catalogue.
2. If missing, user creates a manual sealed product entry.
3. User enters quantity, purchase price, and storage location.
4. Product appears in collection and dashboard.

Acceptance criteria:

- MVP does not require every sealed product to exist in the global catalogue.
- Manual entries can be edited later.

### Upgrade To Plus

1. User clicks a gated analytics feature.
2. User sees a concise upgrade screen.
3. User subscribes.
4. Plus entitlement unlocks immediately.

Acceptance criteria:

- Free users can understand what they are missing.
- Paid users do not lose access if billing status is active.

## Data Model Draft

This section is the MVP summary. The fuller implementation model lives in [DATA_MODEL.md](DATA_MODEL.md).

### User

- id.
- email.
- display name.
- preferred currency.
- preferred region.
- created date.

### Subscription

- id.
- user id.
- provider.
- provider customer id.
- provider subscription id.
- plan.
- status.
- current period end.

### Card Set

- id.
- provider ids.
- name.
- series.
- release date.
- printed total.
- total.
- symbol image.
- logo image.

### Card Printing

- id.
- provider ids.
- set id.
- name.
- number.
- rarity.
- supertype.
- subtypes.
- artist.
- image urls.
- legalities.
- variant metadata.

### Sealed Product

- id.
- provider ids.
- name.
- product type.
- related set id.
- release date.
- image url.
- notes.
- is user created.

### Collection Item

- id.
- user id.
- item type: card or sealed product.
- card printing id.
- sealed product id.
- quantity.
- condition.
- language.
- variant label.
- graded company.
- graded score.
- purchase price.
- purchase date.
- current value override.
- storage location id.
- notes.
- created date.
- updated date.

### Wishlist Item

- id.
- user id.
- item type.
- card printing id.
- sealed product id.
- target price.
- priority.
- notes.
- created date.

### Storage Location

- id.
- user id.
- name.
- type: binder, box, display, safe, other.
- notes.

### Price Snapshot

- id.
- item type.
- card printing id.
- sealed product id.
- source.
- condition.
- language.
- variant label.
- price.
- currency.
- confidence score.
- captured date.

### Collection Event

- id.
- user id.
- collection item id.
- event type: added, edited, sold, removed, graded.
- quantity.
- amount.
- date.
- notes.

## Pricing And Valuation Rules

MVP should support manual pricing first and automated pricing second.

Valuation priority:

1. User manual current value override.
2. Latest matching price snapshot.
3. Catalogue-level rough estimate.
4. Unknown value.

Price confidence should consider:

- Source reliability.
- Number of data points.
- Recency.
- Condition match.
- Language match.
- Variant match.

MVP can store confidence even if the first implementation uses a simple score.

## Milestones

### Milestone 1: Planning Complete

- Project brief.
- MVP spec.
- Data model documented.
- Architecture documented.

### Milestone 2: UX Prototype

- Dashboard.
- Collection.
- Add item.
- Item detail.
- Set progress.
- Wishlist.
- Analytics gate.

### Milestone 3: Foundation Build

- App shell.
- Auth.
- Database.
- Catalogue seed/import.
- Collection CRUD.

### Milestone 4: MVP Features

- Dashboard calculations.
- Wishlist.
- Set progress.
- Sealed product support.
- CSV export.

### Milestone 5: Monetization

- Square subscription integration.
- Entitlements.
- Plus gates.
- Billing management.

### Milestone 6: Beta Polish

- Responsive QA.
- Import/export hardening.
- Empty states.
- Error states.
- Basic admin tools.
- User feedback loop.

## Open Decisions

- Final product name.
- Auth provider.
- Database hosting.
- Pricing data providers.
- Currency/region defaults.
- Whether CSV import ships in the first beta or shortly after.
- Whether manual sealed product entries are private forever or can become shared catalogue candidates.

## Build Principles

- Keep the first version focused.
- Make adding items fast.
- Treat user data ownership seriously.
- Design Plus around real collector value, not artificial frustration.
- Keep pricing providers swappable.
- Prefer useful estimates over false precision.
- Preserve hobby joy while making analytics feel powerful.

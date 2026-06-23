# Mint Binder UX Wireframes

## Purpose

This document defines the first user experience for the Mint Binder MVP before app code is built. It covers navigation, core screens, main flows, important states, and wireframe-level layout decisions.

The goal is not final visual design. The goal is to make the product flow obvious enough that implementation can begin with fewer surprises.

## UX Principles

- The first screen after login should be the user's collection dashboard.
- Adding a card or sealed product should feel fast and forgiving.
- Unknown details should not block users from saving an item.
- Collection value should be useful, but uncertainty should be visible.
- Set progress and wishlist should create hobby momentum.
- Plus features should be discoverable without making the free tier feel broken.
- The app should feel visual and collector-friendly, but dense enough for repeated use.

## Primary Navigation

### Mobile PWA Navigation

Use a persistent bottom navigation for the authenticated app.

Primary tabs:

- Dashboard.
- Collection.
- Add.
- Sets.
- Wishlist.

Secondary areas live behind Settings or contextual links:

- Analytics.
- Storage.
- Import/export.
- Billing.
- Profile.

Reasoning:

- Add is important enough to be a primary action.
- Analytics is valuable, but it is also mostly Plus-focused and does not need to be one of the first five tabs.
- Settings and billing should stay out of the main hobby loop.

### Desktop Navigation

Use a left sidebar for the authenticated app.

Primary sidebar items:

- Dashboard.
- Collection.
- Add item.
- Sets.
- Wishlist.
- Analytics.
- Settings.

Admin-only links can appear at the bottom for admin users:

- Catalogue.
- Sealed products.
- Pricing.

## App Shell Wireframes

### Mobile App Shell

```text
+--------------------------------+
| Mint Binder                 [User] |
|--------------------------------|
|                                |
| Page content                   |
|                                |
|                                |
|                                |
|--------------------------------|
| Home | Cards | Add | Sets | Want |
+--------------------------------+
```

Notes:

- The app name can later become a logo/brand mark.
- The user button opens account, billing, and settings.
- The bottom nav labels should stay short enough for small phones.

### Desktop App Shell

```text
+---------------+------------------------------------------+
| Mint Binder      | Page title                         [User] |
|---------------|------------------------------------------|
| Dashboard     |                                          |
| Collection    | Page content                             |
| Add item      |                                          |
| Sets          |                                          |
| Wishlist      |                                          |
| Analytics     |                                          |
| Settings      |                                          |
+---------------+------------------------------------------+
```

Notes:

- Desktop should support denser tables, filters, and side panels.
- Mobile should prefer cards, sheets, and stacked summaries.

## Core Screens

## 1. Dashboard

Purpose: help users understand the collection at a glance and know what to do next.

MVP content:

- Total estimated value.
- Total items.
- Cards versus sealed products.
- Unvalued item count.
- Recent additions.
- Set progress highlights.
- Wishlist summary.
- Basic gain/loss if purchase prices exist.
- Plus teaser for deeper analytics.

Mobile wireframe:

```text
+--------------------------------+
| Mint Binder                 [User] |
|--------------------------------|
| Collection value               |
| GBP 1,284.50        +GBP 93.20 |
| 186 items | 12 unvalued        |
|--------------------------------|
| [Add card] [Add sealed]        |
|--------------------------------|
| Set progress                   |
| Scarlet & Violet      84%      |
| Crown Zenith          61%      |
| View all sets                  |
|--------------------------------|
| Recent additions               |
| [Card image] Charizard ex      |
| [Card image] Booster Box       |
|--------------------------------|
| Wishlist                       |
| 24 wanted | Est. GBP 410       |
|--------------------------------|
| Plus analytics                 |
| See trends, alerts, and ROI    |
| [Preview]                      |
|--------------------------------|
| Home | Cards | Add | Sets | Want |
+--------------------------------+
```

Desktop layout:

- Top stat row.
- Left column: value, gain/loss, item mix.
- Middle column: set progress and recent additions.
- Right column: wishlist and Plus analytics preview.

Empty state:

- Show a warm first-card prompt.
- Primary action: Add your first card.
- Secondary action: Add sealed product.
- Tertiary action: Import CSV later.

## 2. Collection

Purpose: browse, search, filter, and manage owned items.

MVP content:

- Search.
- Filter chips.
- Sort control.
- List/grid toggle.
- Item cards on mobile.
- Dense table on desktop.
- Quick edit actions.
- Empty and filtered-empty states.

Mobile wireframe:

```text
+--------------------------------+
| Collection                 [+] |
|--------------------------------|
| Search collection              |
| [Search by card, set, product] |
|--------------------------------|
| Type v  Set v  Condition v     |
| Sort: Value high to low        |
|--------------------------------|
| [Img] Umbreon VMAX             |
| Evolving Skies #215            |
| NM | English | Qty 1           |
| GBP 740.00                     |
|--------------------------------|
| [Img] 151 Booster Bundle       |
| Sealed | Qty 2                 |
| GBP 64.00                      |
|--------------------------------|
| Home | Cards | Add | Sets | Want |
+--------------------------------+
```

Desktop layout:

- Search and filters above the list.
- Table columns: image, name, set/product type, condition, language, quantity, cost, value, location, actions.
- Optional side panel for selected item preview.

Key states:

- No collection items.
- No results for filter.
- Items with unknown value.
- Archived/sold items hidden by default.

## 3. Add Item

Purpose: make adding cards and sealed products fast.

MVP flow:

1. Choose card or sealed product.
2. Search catalogue.
3. Select result.
4. Enter only required collection details.
5. Save to collection or wishlist.

Mobile wireframe:

```text
+--------------------------------+
| Add item                  [X]  |
|--------------------------------|
| [Card] [Sealed product]        |
|--------------------------------|
| Search                         |
| [Charizard 151...]             |
|--------------------------------|
| Results                        |
| [Img] Charizard ex             |
| Scarlet & Violet 151 #199      |
|--------------------------------|
| [Img] Charizard ex             |
| Obsidian Flames #223           |
|--------------------------------|
| Selected item                  |
| Condition       [Near mint v]  |
| Language        [English v]    |
| Quantity        [-] 1 [+]      |
| Paid            [GBP 0.00]     |
| Purchase date   [Optional]     |
| Location        [Optional v]   |
| Notes           [Optional]     |
|--------------------------------|
| [Save to collection]           |
| [Add to wishlist]              |
+--------------------------------+
```

Add form rules:

- Required: selected item, quantity.
- Strongly suggested: condition for cards.
- Optional: purchase price, date, location, notes.
- Graded fields appear only when graded is enabled.
- Manual sealed product creation appears when search has no good result.

Manual sealed product fields:

- Name.
- Product type.
- Quantity.
- Purchase price.
- Current value override.
- Related set optional.
- Storage location optional.

## 4. Item Detail

Purpose: combine catalogue details with the user's owned copy data.

MVP content:

- Image.
- Name.
- Set/product details.
- Owned lot details.
- Quantity.
- Condition/language/variant.
- Purchase price and date.
- Estimated value.
- Price source/confidence if available.
- Manual value override.
- Storage location.
- Notes.
- Edit/archive actions.

Mobile wireframe:

```text
+--------------------------------+
| < Collection              Edit |
|--------------------------------|
| [Large item image]             |
| Charizard ex                   |
| Scarlet & Violet 151 #199      |
|--------------------------------|
| Owned details                  |
| Qty 1 | Near mint | English    |
| Raw | Reverse Holo             |
|--------------------------------|
| Value                          |
| GBP 118.00                     |
| Source: Manual override        |
|--------------------------------|
| Cost basis                     |
| Paid GBP 92.00 on 2026-05-01   |
| Gain GBP 26.00                 |
|--------------------------------|
| Location                       |
| Blue Binder                    |
|--------------------------------|
| Notes                          |
| Bought at card show            |
+--------------------------------+
```

Actions:

- Edit.
- Duplicate lot.
- Move location.
- Mark sold later.
- Archive/remove.

## 5. Sets

Purpose: help collectors complete sets.

MVP content:

- Search sets.
- Set list.
- Completion percentage.
- Owned count.
- Missing count.
- Recent sets or pinned sets later.

Mobile wireframe:

```text
+--------------------------------+
| Sets                           |
|--------------------------------|
| Search sets                    |
| [Scarlet...]                   |
|--------------------------------|
| Scarlet & Violet 151           |
| 128 / 207 owned          62%   |
| [Progress bar]                 |
|--------------------------------|
| Crown Zenith                   |
| 96 / 159 owned           60%   |
| [Progress bar]                 |
|--------------------------------|
| Evolving Skies                 |
| 42 / 237 owned           18%   |
| [Progress bar]                 |
|--------------------------------|
| Home | Cards | Add | Sets | Want |
+--------------------------------+
```

## 6. Set Detail

Purpose: show owned, missing, wishlisted, and duplicate cards in a set.

MVP content:

- Set hero row with logo/symbol if available.
- Completion percentage.
- Owned/missing tabs.
- Search within set.
- Card grid/list.
- Add missing card to wishlist.
- Add owned card to collection.

Mobile wireframe:

```text
+--------------------------------+
| < Sets                         |
| Scarlet & Violet 151           |
| 128 / 207 owned          62%   |
| [Progress bar]                 |
|--------------------------------|
| [All] [Owned] [Missing] [Want] |
| Search in set                  |
|--------------------------------|
| [Img] Bulbasaur #001     Owned |
| [Img] Ivysaur #002       Want  |
| [Img] Venusaur ex #003   Add   |
| [Img] Charmander #004    Owned |
+--------------------------------+
```

Set completion MVP rules:

- Completion is based on distinct card printings owned.
- Variant-aware master set tracking comes later.
- Wishlist status should be visible from the set detail screen.

## 7. Wishlist

Purpose: help users plan future purchases and move wanted items into collection.

MVP content:

- Wishlist items.
- Priority.
- Target price.
- Estimated current value if available.
- Notes.
- Move to collection action.
- Total estimated wishlist cost.

Mobile wireframe:

```text
+--------------------------------+
| Wishlist                   [+] |
|--------------------------------|
| 24 wanted | Est. GBP 410       |
| [High] [Grail] [All]           |
|--------------------------------|
| [Img] Mew ex                   |
| 151 #193 | High                |
| Target GBP 35.00               |
| [Move to collection]           |
|--------------------------------|
| [Img] Evolving Skies Box       |
| Sealed | Grail                 |
| Target GBP 450.00              |
|--------------------------------|
| Home | Cards | Add | Sets | Want |
+--------------------------------+
```

Empty state:

- Explain that wishlist helps track missing cards and sealed products.
- Primary action: Browse sets.
- Secondary action: Add wishlist item.

## 8. Analytics

Purpose: make the Plus subscription feel obviously useful.

Free user experience:

- Show a preview with blurred/limited charts or sample insight cards.
- Explain the specific unlocked value.
- Keep the CTA low-pressure.

Plus user content:

- Value over time.
- Cost basis.
- Gain/loss.
- Best performers.
- Worst performers.
- Sealed versus singles.
- Set breakdown.
- Duplicate opportunities.

Mobile free wireframe:

```text
+--------------------------------+
| Analytics                      |
|--------------------------------|
| Plus unlocks collection trends |
| and smarter decisions.         |
|--------------------------------|
| Preview                        |
| Value over time        Locked  |
| Best performers        Locked  |
| Duplicates to review   Locked  |
|--------------------------------|
| [Start Plus]                  |
| GBP 2.49/month                |
|--------------------------------|
| Free includes tracking, sets, |
| wishlist, and basic value.    |
+--------------------------------+
```

Mobile Plus wireframe:

```text
+--------------------------------+
| Analytics                      |
|--------------------------------|
| Value over time                |
| [Chart]                        |
|--------------------------------|
| Gain/loss                      |
| Cost GBP 930 | Value GBP 1,284 |
|--------------------------------|
| Best performers                |
| [Img] Card A   +GBP 64         |
| [Img] Card B   +GBP 41         |
|--------------------------------|
| Opportunities                  |
| 8 duplicates worth reviewing   |
+--------------------------------+
```

## 9. Settings

Purpose: account, preferences, billing, data ownership.

MVP content:

- Profile.
- Currency.
- Region.
- Subscription status.
- Billing portal.
- Import/export.
- Storage locations.
- Data deletion later.

Mobile wireframe:

```text
+--------------------------------+
| Settings                       |
|--------------------------------|
| Profile                        |
| Liam                           |
| liam@example.com               |
|--------------------------------|
| Preferences                    |
| Currency GBP                   |
| Region United Kingdom          |
|--------------------------------|
| Subscription                   |
| Free plan                      |
| [Manage or upgrade]            |
|--------------------------------|
| Data                           |
| [Export CSV]                   |
| [Import CSV]                   |
|--------------------------------|
| Storage locations              |
| Blue Binder, Safe, Box 1       |
+--------------------------------+
```

## Public Screens

Public pages should stay lightweight for MVP.

### Landing Page

Purpose:

- Explain the product quickly.
- Drive signups.
- Link pricing.

Content:

- Product name.
- Short value proposition.
- App screenshots or mockups once available.
- Free tier and Plus teaser.
- Signup CTA.

### Pricing Page

Purpose:

- Explain free versus Plus.
- Avoid hiding the free plan.

Content:

- Free plan.
- Plus plan.
- Monthly and yearly pricing.
- Feature comparison.
- Legal disclaimer about no official affiliation.

### Auth Screens

Purpose:

- Signup and login.
- Keep fields minimal.

MVP:

- Email/password.
- OAuth later if chosen.

## Key User Flows

### Flow A: Add First Card

```text
Signup -> Dashboard empty state -> Add card -> Search -> Select result
-> Enter quantity/condition -> Save -> Dashboard with first item
```

Success criteria:

- Can complete with only item, quantity, and condition.
- Dashboard updates immediately.
- User sees a clear next action.

### Flow B: Add Sealed Product

```text
Add -> Sealed product -> Search -> Select result or create manual
-> Enter quantity and optional purchase price -> Save -> Collection
```

Success criteria:

- Missing sealed products do not block users.
- Manual product is private by default.

### Flow C: Complete A Set

```text
Sets -> Choose set -> Missing tab -> Add item to wishlist
-> Later move wishlist item to collection -> Set progress updates
```

Success criteria:

- Set progress updates after collection changes.
- Missing/wishlist status is easy to scan.

### Flow D: Wishlist To Collection

```text
Wishlist -> Select item -> Move to collection
-> Add owned details -> Save -> Wishlist item removed or marked acquired
```

Success criteria:

- User does not need to search again.
- Purchase price can be entered during move.

### Flow E: Discover Plus

```text
Dashboard teaser or Analytics tab -> Plus preview -> Pricing
-> Checkout -> Return to app -> Entitlements unlock
```

Success criteria:

- Free users understand the value before checkout.
- Paid access is enforced by backend entitlements.

## Important States

### Empty Collection

Show:

- Friendly message.
- Add card CTA.
- Add sealed product CTA.
- Import CSV option if available.

Avoid:

- Huge blank dashboards.
- Making the user pick too many setup preferences first.

### No Search Results

Card search:

- Suggest checking spelling.
- Suggest searching by set or number.

Sealed search:

- Offer manual sealed product creation.

### Unknown Value

Show:

- `Unknown value`.
- Manual value override action.
- Price source explanation where relevant.

Avoid:

- Treating unknown as zero without telling the user.

### Plus Gate

Show:

- What is locked.
- Why it helps.
- Price.
- Free tier reassurance.

Avoid:

- Blocking normal collection management.

### Pre-Beta Plus Binders

Purpose: make collection organization feel tactile, personal, and worth upgrading for.

Concept:

- Add a Binders tab within Collection.
- Lock Binders to Plus users, with a tasteful preview for free users.
- Give every Plus user a default Full Collection binder.
- Let users create custom binders using cards they already own.
- Offer binder cover artwork choices, including clean, set-inspired, premium, and playful options.
- Treat this as a pre-beta signature feature rather than a distant future idea.

Interaction direction:

- Binder grid/list should feel like choosing a real binder from a shelf.
- Opening a binder should animate it forward and open in place.
- Cards should sit in page-like slots rather than normal app cards.
- Selecting a card should lift it out, enlarge/focus it, and dim or soften the page behind it.
- Returning the card should animate it back into its slot.

Open UX questions:

- Can the same card appear in multiple custom binders?
- Do custom binders support manual ordering, automatic sorting, or both?
- Are binders purely presentation/organization, or do they also drive analytics and reports?
- How much of the binder preview should free users see before upgrading?

### Focused Set Builder

Purpose: complement the existing Sets menu with a goal-driven mode inside one set detail view.

This is not a replacement for the Sets menu. The Sets menu remains the full catalogue of sets. Set Builder is a focused collector workflow once a user has chosen a set.

Concept:

- Let the user mark one set as active.
- Show missing, owned, and wanted cards with fast filters.
- Offer bulk wishlist actions for missing cards.
- Highlight the next practical chase card based on target price, market value, rarity, and existing progress.
- Keep normal set-detail browsing available for users who just want the list.

### Import Errors

Show:

- Number of rows imported.
- Number of rows skipped.
- Downloadable error details later.
- Clear reason per failed row later.

## Component Inventory

Core reusable components:

- App shell.
- Bottom navigation.
- Sidebar navigation.
- Stat card.
- Item card.
- Item table row.
- Search input.
- Filter chips.
- Sort menu.
- Segmented control.
- Quantity stepper.
- Currency input.
- Condition selector.
- Language selector.
- Storage selector.
- Empty state.
- Plus gate.
- Progress bar.
- Value confidence badge.
- Item image fallback.

## Responsive Behavior

Mobile:

- Cards instead of tables.
- Bottom nav.
- Filters in a sheet.
- Add/edit forms as full-screen pages or sheets.
- Sticky save action on long forms.

Desktop:

- Sidebar navigation.
- Tables where density helps.
- Filter sidebar or top filter row.
- Detail side panels for quick review.
- Wider analytics layouts.

## Accessibility Notes

- All buttons need visible text or accessible labels.
- Do not rely on color alone for status.
- Form fields need labels.
- Touch targets should be comfortable on mobile.
- Value changes should include sign and label, not color only.
- Locked Plus content should be understandable to screen readers.

## UX Risks

### Add Flow Becomes Too Heavy

Mitigation:

- Require very little.
- Hide advanced fields behind expandable sections.
- Let users edit later.

### Analytics Feels Too Financial

Mitigation:

- Pair numbers with collection-friendly language.
- Keep set progress and wishlist visible.
- Do not overemphasize trading-style behavior.

### Pricing Confidence Confuses Users

Mitigation:

- Use simple labels first: Strong, Fair, Weak, Unknown.
- Explain details only on item detail or Plus analytics.

### Plus Feels Like A Wall

Mitigation:

- Keep tracking, set progress, wishlist, and export free.
- Gate automation, history, deeper analytics, and reports.

## Prototype Recommendation

The first clickable prototype should cover:

1. Empty dashboard.
2. Add first card.
3. Dashboard after first item.
4. Collection list.
5. Item detail.
6. Set detail with missing/wishlist states.
7. Wishlist.
8. Analytics Plus gate.

This prototype can be built as static app screens before connecting auth, database, or pricing providers.

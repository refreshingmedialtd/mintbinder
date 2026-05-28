# PokeStop Project Brief

## Working Title

PokeStop is the temporary project name. Before public launch, choose a brand name that does not imply affiliation with Pokemon, Nintendo, Creatures, Game Freak, The Pokemon Company, Pokemon GO, or any official product.

## Product Summary

PokeStop is a Pokemon card and sealed product collection tracker for collectors who want the hobby to stay fun while also understanding the value of what they own.

The product should help users answer four questions quickly:

- What do I own?
- What is it worth?
- What am I missing?
- What should I buy, sell, grade, trade, or hold next?

The app should feel more capable than a simple catalogue. It should combine collection tracking, set completion, value history, wishlist planning, and practical analytics in one clean mobile-first experience.

## Target Users

### Casual Collectors

Collectors who buy packs, singles, and sealed products for enjoyment. They need simple tracking, wishlist support, and a satisfying way to see their collection grow.

### Set Builders

Collectors trying to complete specific sets, master sets, promos, or language variants. They need set progress, missing card views, duplicate tracking, and wishlist links.

### Value-Conscious Collectors

Collectors who care about value, purchase price, performance, and whether specific cards are worth grading or selling. They need analytics, price history, alerts, and confidence indicators.

### Small Sellers And Traders

Collectors who sell duplicates, trade locally, or manage inventory casually. They need duplicates, sale history, storage locations, and exports.

## Product Positioning

PokeStop should sit between a joyful collector app and a lightweight portfolio tool.

It should not become a cold finance dashboard. Pokemon collecting is nostalgic, visual, and emotional. The analytics should feel helpful and empowering, not predatory or spreadsheet-heavy.

Positioning statement:

> A collection tracker for Pokemon cards and sealed products that shows what you own, what it is worth, what you are missing, and what moves might be worth making next.

## Differentiators

The app should aim to be better than existing collection trackers through:

- Strong set completion and master set tracking.
- A flexible data model for cards, variants, slabs, raw cards, and sealed products.
- Price source transparency and price confidence scoring.
- Useful analytics beyond total value.
- Duplicate management and wishlist-driven collection planning.
- Grading opportunity insights.
- Clean mobile-first design with enough warmth to match the hobby.
- Free tier that feels useful, with low-cost paid features for power collectors.

## Core Product Pillars

### 1. Collection Tracking

Users can track cards and sealed products with practical details:

- Card or sealed product identity.
- Quantity.
- Condition.
- Language.
- Variant or printing.
- Raw or graded status.
- Purchase price.
- Purchase date.
- Storage location.
- Notes.
- Owned copy photos later, if needed.

### 2. Set And Wishlist Progress

Users can see what they own and what they are missing:

- Set progress percentage.
- Missing card list.
- Reverse holo and variant support where possible.
- Wishlist items.
- Duplicate indicators.
- Master set goals in later versions.

### 3. Market And Value Intelligence

The app should estimate collection value while being honest about uncertainty:

- Current estimated value.
- Historical snapshots.
- Gain/loss versus cost basis.
- Source-aware pricing.
- Confidence score for price quality.
- Manual overrides.
- Price alerts for paid users.

### 4. Collection Decisions

The app should help users decide what to do next:

- Best and worst performers.
- Duplicates that may be worth selling or trading.
- Wishlist cost estimates.
- Potential grading candidates.
- Cards with sudden movement.
- Sealed versus singles breakdown.

### 5. Import, Export, And Ownership

Users should not feel trapped:

- CSV import.
- CSV export.
- Backup-friendly data model.
- Insurance-style collection reports for paid users.

## Monetization Strategy

PokeStop should have a generous free plan and a very low-cost subscription for advanced features.

### Free Tier

The free tier should be genuinely useful:

- Track cards and sealed products.
- Basic collection dashboard.
- Basic estimated value.
- Wishlist.
- Set completion.
- Manual price paid and manual value override.
- CSV export.
- Limited price history or limited automatic price refreshes.

### Plus Tier

The Plus tier should unlock advanced collector tools:

- Full analytics dashboard.
- Price history charts.
- Price alerts.
- Portfolio gain/loss.
- Grading opportunity calculator.
- Multi-source price comparison.
- Price confidence details.
- Duplicate manager.
- Binder, box, and storage organization.
- Advanced import/export.
- Insurance-style reports.
- Priority data refreshes.

Initial target price:

- Monthly: approximately GBP 2.49 or USD 2.99.
- Yearly: discounted enough to feel like the obvious choice for active collectors.

## Platform Strategy

Build web/PWA first, but design the backend and UI patterns so mobile apps can follow without a rewrite.

Recommended sequence:

1. Web/PWA MVP.
2. Responsive mobile-first interface.
3. Shared API and database.
4. Native mobile app using the same backend once core flows are validated.

This avoids the cost of building two frontends before the product shape is proven.

## Data And API Strategy

Card catalogue and market data can change, and third-party API access is not guaranteed. PokeStop should therefore use provider-agnostic architecture from the beginning.

Principles:

- Store our own normalized catalogue records.
- Keep external IDs for each provider.
- Isolate each pricing source behind a provider interface.
- Cache price snapshots.
- Allow manual user overrides.
- Display price source and confidence instead of pretending all estimates are equal.
- Avoid building core product logic around one provider's terms or availability.

Potential sources to evaluate:

- Pokemon TCG API for card and set catalogue data.
- eBay APIs or approved marketplace data providers for sold/listing signals.
- Other licensed or affiliate-compatible price sources.
- Manual/imported pricing as a fallback.

## Design Direction

The app should feel:

- Clear.
- Fast.
- Trustworthy.
- Visual.
- Fun without being childish.
- Useful for repeated daily or weekly use.

The first screen should be the actual collection experience, not a marketing page. For authenticated users, the dashboard should immediately show collection value, recent changes, set progress, wishlist progress, and useful next actions.

## Success Measures

Early product success should be measured by:

- Users can add their first item in under 60 seconds.
- Users understand their collection value at a glance.
- Users can identify missing cards from a set.
- Users trust the price estimate because the source/confidence is clear.
- Free users keep returning.
- Plus users feel the analytics and alerts justify the low subscription.

## Key Risks

### Pricing Data Availability

Pricing APIs may be restricted, paid, incomplete, or legally sensitive. Mitigation: provider abstraction, caching, manual overrides, and source transparency.

### Catalogue Complexity

Pokemon cards have many variants, languages, promos, errors, reverse holos, stamped cards, and graded forms. Mitigation: start with a clean core model and add complexity deliberately.

### Subscription Value

If too much is free, Plus may feel unnecessary. If too little is free, users may not trust the product. Mitigation: make tracking and set progress free, monetize advanced analytics and automation.

### Scope Creep

Scanning, marketplace selling, social features, and native apps are attractive but expensive. Mitigation: ship a strong collection and analytics MVP before expanding.

## Initial Roadmap

### Phase 0: Planning

- Project brief.
- MVP spec.
- Data model document.
- Architecture document.
- Wireframes.

### Phase 1: Prototype

- Static clickable screens.
- Collection dashboard.
- Add item flow.
- Set progress view.
- Wishlist view.

### Phase 2: MVP Foundation

- Authentication.
- Database schema.
- Catalogue import.
- Collection CRUD.
- Sealed product support.

### Phase 3: Collection Intelligence

- Dashboard analytics.
- Set progress.
- Cost basis.
- Basic value tracking.
- Duplicates.

### Phase 4: Monetization

- Free/Plus gating.
- Subscription checkout.
- Billing management.
- Plus-only analytics.

### Phase 5: Beta

- Import/export.
- Pricing source evaluation.
- Feedback loop.
- Mobile PWA polish.

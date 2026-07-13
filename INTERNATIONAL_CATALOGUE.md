# International Catalogue Plan

Last updated: 13 July 2026

## Why This Matters

Mint Binder should treat Japanese, Traditional Chinese, Simplified Chinese, and Korean cards as first-class catalogue printings, not as language notes attached to English cards. That means each localized printing needs its own catalogue record, image, set, language, region, provider IDs, and eventually local market pricing.

This is a core USP: most collection apps handle English and some Japanese. Korean and complete Chinese coverage are the opportunity.

## Source Position

- TCGdex is the first import target because it has a public REST API, an MIT-licensed database, card images, localized set/card records, and explicit multilingual support. Docs: https://tcgdex.dev/
- TCGdex status should be checked before each large import: https://api.tcgdex.net/status
- Current TCGdex reality is uneven. Traditional Chinese is useful, Japanese is partial, Simplified Chinese is early, and Korean is currently too thin to be our only Korean source.
- The official Japanese Pokemon Card site is useful for verification, but its page copyright notice says images/content must not be reproduced without permission: https://www.pokemon-card.com/card-search/

## Current Implementation

- `card_sets` and `card_printings` now have first-class `language` and `region` columns.
- Existing English imports default to `language = en` and `region = international`.
- Catalogue API search accepts `language=all|en|ja|zh-tw|zh-cn|ko`.
- Add Item has a catalogue language filter and collection lot language options for Japanese, Traditional Chinese, Simplified Chinese, and Korean.
- International card search has an initial localized-name alias layer for high-value/common Pokemon, so English searches such as `chariz` can match Japanese `リザードン`, Traditional Chinese `噴火龍`, Simplified Chinese `喷火龙`, and Korean `리자몽`.
- Set detail loading now uses set IDs where available, so localized sets with duplicate names do not bleed into each other.
- TCGdex batch import endpoint:
  - `POST /api/jobs/international-catalogue-refresh`
  - Protected by `JOB_SECRET`
  - Body: `{ "language": "ja", "page": 1, "pageSize": 50, "maxPages": 1 }`
- Local runner:
  - `TCGDEX_IMPORT_LANGUAGE=ja npm run job:international-catalogue-batch`
  - `npm run job:international-catalogue-backfill` imports every supported TCGdex page for `ja`, `zh-tw`, `zh-cn`, and `ko` in safer chunks.
  - Optional controls: `TCGDEX_BACKFILL_LANGUAGES=ja,zh-tw,zh-cn,ko`, `TCGDEX_BACKFILL_PAGE_SIZE=250`, `TCGDEX_BACKFILL_CHUNK_PAGES=2`, `TCGDEX_BACKFILL_START_PAGE=1`.
- Supported first-pass language codes: `ja`, `zh-tw`, `zh-cn`, `ko`
- Starter Neon imports run on 10 July 2026:
  - Japanese: 500 cards / 60 sets
  - Traditional Chinese: 250 cards / 83 sets
  - Simplified Chinese: 150 cards / 8 sets
  - Korean: 150 cards / 3 sets
- Full TCGdex-backed Neon import run on 10 July 2026:
  - Japanese: 6,246 cards / 60 sets
  - Traditional Chinese: 7,436 cards / 83 sets
  - Simplified Chinese: 877 cards / 8 sets
  - Korean: 239 cards / 3 sets
- Source-backed coverage verified on 13 July 2026 after rerunning the international backfill:
  - Japanese: 6,246 cards / 60 sets / 3,297 cards with images
  - Traditional Chinese: 7,436 cards / 83 sets / 2,146 cards with images
  - Simplified Chinese: 877 cards / 8 sets / 0 cards with images
  - Korean: 239 cards / 3 sets / 0 cards with images
- Current source-backed full import target is every card exposed by the TCGdex language endpoints. This gets Mint Binder much closer to the USP quickly, but it is not a legal claim that every official card ever printed in those regions is complete beyond TCGdex. True exhaustive coverage still needs a licensed/permissioned source strategy for any gaps, especially Korean and newer Asian-language releases.
- TCGdex variant metadata now feeds catalogue variant options and search text, so imported localized cards can expose source-backed finishes such as Normal, Holofoil, Reverse Holofoil, 1st Edition, promo stamp, and non-standard sizes where the source provides them.
- Image coverage is uneven in the current TCGdex source. Some international rows expose no image field and their deterministic asset URLs return 404, so Mint Binder should keep showing a clear no-image placeholder rather than storing broken links until a licensed image source or cache process is added.
- Operations now reports per-language card, image, and price coverage so Japanese, Traditional Chinese, Simplified Chinese, and Korean gaps remain visible separately from English Pokemon TCG API coverage.
- Japanese card pricing has a first scheduled updater path through TCGCSV's TCGplayer `Pokemon Japan` category (`categoryId = 85`):
  - Local direct runner: `npm run job:tcgcsv-japan-card-pricing`
  - Protected live runner: `npm run job:live-japan-card-pricing`
  - Protected endpoint: `POST /api/jobs/international-card-pricing`
  - Default source/language written to snapshots: `tcgcsv-japan-card`, `ja`
  - Production controls: `TCGCSV_JAPAN_CARD_GROUP_LIMIT=1`, `TCGCSV_JAPAN_CARD_ONLY_UNPRICED_GROUPS=false`, `TCGCSV_JAPAN_CARD_PRICE_ONLY_UNPRICED=false`, and `TCGCSV_JAPAN_CARD_WAIT_MS=120`
  - Selection rotates by oldest `tcgcsv-japan-card` snapshot, with never-priced groups first, so hourly runs fill blanks and build Japanese price history.
- Traditional Chinese, Simplified Chinese, and Korean pricing remains intentionally unautomated until a reviewed CSV/licensed source exists. The official Asia Pokemon Card site is useful for manual verification, but its terms prohibit copying/reproducing site content outside the service without permission, so it should not be used as an automated import source.

## Rollout Order

1. Run small TCGdex pilot imports for `ja` and `zh-tw`, then inspect Add Item, Sets, images, and duplicate behaviour.
2. Increase `pageSize`/`maxPages` gradually once the UI is confirmed stable.
3. Run `zh-cn` and `ko` as partial imports only, then review the coverage gaps rather than presenting them as complete.
4. Expand the localized-name alias table beyond the first high-value/common Pokemon set. Long term this should be generated from a licensed species-name dataset rather than maintained by hand.
5. Build a coverage dashboard grouped by language and region: sets, cards, images, priced records.
6. Keep Traditional Chinese, Simplified Chinese, and Korean price gaps visible in Operations while evaluating reviewed CSV, licensed-data, or direct-partner options. Do not scrape official pages or local marketplace pages into production without rights review.
7. Expand local-market pricing sources per language. Japanese now has a TCGCSV-backed first pass; Traditional Chinese, Simplified Chinese, and Korean still need a source that does not require personal/business API verification or unauthorized reuse.

## Open Decisions

- Whether to keep TCGdex image URLs hot-linked or cache images behind our own asset pipeline after confirming terms and bandwidth expectations.
- Whether Korean requires a manually curated dataset, a marketplace-derived catalogue seed, or a data partnership.
- How to map equivalent artworks across languages for collection intelligence without collapsing distinct localized printings.
- How much localized card text we need for beta. Names, set, number, rarity, image, language, and region are enough for collection tracking; full rules text can follow.

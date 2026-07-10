# International Catalogue Plan

Last updated: 10 July 2026

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
  - Supported first-pass language codes: `ja`, `zh-tw`, `zh-cn`, `ko`
- Starter Neon imports run on 10 July 2026:
  - Japanese: 500 cards / 60 sets
  - Traditional Chinese: 250 cards / 83 sets
  - Simplified Chinese: 150 cards / 8 sets
  - Korean: 150 cards / 3 sets

## Rollout Order

1. Run small TCGdex pilot imports for `ja` and `zh-tw`, then inspect Add Item, Sets, images, and duplicate behaviour.
2. Increase `pageSize`/`maxPages` gradually once the UI is confirmed stable.
3. Run `zh-cn` and `ko` as partial imports only, then review the coverage gaps rather than presenting them as complete.
4. Expand the localized-name alias table beyond the first high-value/common Pokemon set. Long term this should be generated from a licensed species-name dataset rather than maintained by hand.
5. Build a coverage dashboard grouped by language and region: sets, cards, images, priced records.
6. Research licensed or partnership-friendly Korean and Simplified Chinese sources. Do not scrape official pages into production without rights review.
7. Add local-market pricing sources per language. Catalogue coverage should land before price coverage, but the UI must clearly show unpriced international cards.

## Open Decisions

- Whether to keep TCGdex image URLs hot-linked or cache images behind our own asset pipeline after confirming terms and bandwidth expectations.
- Whether Korean requires a manually curated dataset, a marketplace-derived catalogue seed, or a data partnership.
- How to map equivalent artworks across languages for collection intelligence without collapsing distinct localized printings.
- How much localized card text we need for beta. Names, set, number, rarity, image, language, and region are enough for collection tracking; full rules text can follow.

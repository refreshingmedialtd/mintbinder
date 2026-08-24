# Insurance report fonts

The Japanese, Korean, Simplified Chinese and Traditional Chinese static
TrueType builds are from
the [notofonts/noto-cjk](https://github.com/notofonts/noto-cjk) project. These
copies are mirrored by
[Nextcloud](https://github.com/nextcloud/server/tree/master/core/fonts). The
insurance exporter selects among them by actual Unicode glyph coverage and
embeds only the region fonts required by a report. This keeps the existing
Japanese appearance while preventing missing-glyph boxes for Korean and for
Chinese characters outside the Japanese subset.

The Arabic, Devanagari and Thai static TrueType builds come directly from the
official [Noto font dashboard](https://notofonts.github.io/). They preserve
accepted account, storage and catalogue evidence in those scripts. Characters
without a bundled monochrome outline (including emoji) are deliberately shown
as an explicit `[U+XXXXX]` marker in the PDF; they are never silently changed to
`?`.

Pinned file checksums:

- `NotoSansJP-Regular.ttf`: `7C8597677E9FAC0F54D7848AD18BC6A708DFB5BAA4EBF4BD91E66EFCCA313BF3`
- `NotoSansKR-Regular.ttf`: `9DB318B65EE9C575A43E7EFD273DBDD1AFEF26E467EEA3E1073A50E1A6595F6D`
- `NotoSansSC-Regular.ttf`: `5CF8B2A0576D5680284AB03A7A8219499D59BBE981A79BB3DC0031F251C39736`
- `NotoSansTC-Regular.ttf`: `F78E4152BF5364F8B7F503BD339A18F3ECA55300587E105E5FE5E267ACD125F4`
- `NotoSansArabic-Regular.ttf`: `7B5E989F16F038DE13FEC71D10B2BEE1FC11B5B997A8DBB7B6B75A50652513BD`
- `NotoSansDevanagari-Regular.ttf`: `181763D019E7E11CD3B0F5F7F7DAFB237BCEE081F0F077700E7E588D39AB2127`
- `NotoSansThai-Regular.ttf`: `57F54F86B7666273CA83A4785F73C53C57CCE3B27C778A1F7CEA01F41BAC00ED`

The font is distributed under the SIL Open Font License 1.1. The complete
license text is included in `OFL-Noto-CJK.txt`.

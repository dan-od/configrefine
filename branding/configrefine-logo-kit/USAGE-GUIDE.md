# ConfigRefine logo — usage guide

## The idea
A config block: a parent line with two indented child lines, the last one trimmed.
It is the shape of every IOS config (`interface …` and its indented lines), and the
trimmed line is the "refine": noise cut away.

## Colours

| Name | HEX | RGB | Use |
|---|---|---|---|
| Amber | `#E8B250` | 232 178 80 | Tile, "Refine" on dark backgrounds |
| Deep amber | `#B47814` | 180 120 20 | "Refine" on light backgrounds |
| Navy | `#080C18` | 8 12 24 | Dark background |
| Ink | `#0A0E1A` | 10 14 26 | Bars inside the tile |
| Light text | `#EAF0F8` | 234 240 248 | "Config" on dark backgrounds |
| Dark text | `#1A1E2E` | 26 30 46 | "Config" on light backgrounds |

Contrast checked: amber on navy 10.1:1, ink bars on amber 10.0:1, deep amber on white 3.7:1
(passes the 3:1 minimum for graphics and large text). Plain amber on white is only 1.9:1,
so never set amber text on a white background; use deep amber.

## Versions

| Background | Use |
|---|---|
| Dark (navy or any dark colour) | `*-color-on-dark.svg` |
| Light (white or light grey) | `*-color-on-light.svg` |
| One colour, light background (print, stamps) | `*-black.svg` |
| One colour, dark background | `*-white.svg` |

Lockups: **horizontal** (default), **stacked** (square spaces, title slides), **wordmark** (when the
icon is already on screen), **tile** alone (avatars, app icon, favicon).

## Clear space
Keep empty space around the logo at least the height of the tile's corner radius
(about 19% of the tile's height) on every side. Nothing else enters that space.

## Minimum sizes
- Tile: 16 px. Below 48 px use `configrefine-tile-small.svg` (heavier bars, built for small sizes).
- Horizontal lockup: 120 px wide on screen, 30 mm in print.
- Stacked lockup: 64 px wide.

## Don't
- Change the colours, or swap which word is amber.
- Recolour the bars inside the tile, or add more bars.
- Stretch, rotate, outline, or add shadows or gradients.
- Re-type the wordmark: it is outlined Inter ExtraBold with −2% letter-spacing. Use the files.
- Put the colour logo on a busy photo; use the white one-colour version on a dark overlay.

## Files

| Folder | Contents |
|---|---|
| `svg/` | Masters: symbol, small-size symbol, tile, horizontal, stacked, wordmark in every colour version, link-preview image |
| `png/` | 1200 px PNGs of the main lockups and tile, and `configrefine-og-image.png` (1200×630) |
| `web/` | `favicon.ico`, `favicon.svg`, favicon PNGs, `apple-touch-icon.png`, `icon-192/512.png`, `maskable-512.png`, `site.webmanifest`, `head-snippet.html` |
| `presentation.html` | Presentation board with mockups (README, app icon, website, terminal, sticker, social) |

## Fonts and trademark
The wordmark uses Inter (SIL Open Font License, which allows logo use), converted to outlines.
No trademark search has been done; run one before registering the name or mark.

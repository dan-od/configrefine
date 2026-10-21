# Square favicons

The app uses square-cornered tiles (to match its header). These are the sources for the square
versions of the kit's favicons in `public/`; the original kit in `../configrefine-logo-kit/` is unchanged.

- `favicon-square.svg`: square tile with the kit's `tile-small` bars. Used as `public/favicon.svg`
  and rendered (in Chrome) to `favicon-32.png` and `favicon-48.png`.
- `favicon-16-pixel-aligned.svg`: the same mark with the bars snapped to whole pixels at 16 px
  (2 px bars, 1 px gaps, rows 4-5 / 7-8 / 10-11). Rendered to `favicon-16.png`; at 16 px the kit
  geometry blurs the gaps between the bars.
- `favicon.ico` bundles the 16 / 32 / 48 PNGs.

`apple-touch-icon.png`, `icon-192.png`, `icon-512.png` and `maskable-512.png` were already square in
the kit and are used as-is.

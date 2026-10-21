// ConfigRefine tile, inlined from branding/configrefine-logo-kit/svg/configrefine-tile-small.svg
// (the heavier-bar version the kit specifies below 48 px). Colours are fixed to the kit's amber
// and ink, not the theme accent, so the tile looks the same in dark and light mode.
const BARS =
  "M66.50 50.02H189.50A18.86 18.86 0 0 1 189.50 87.74H66.50A18.86 18.86 0 0 1 66.50 50.02Z" +
  "M112.42 104.14H189.50A18.86 18.86 0 0 1 189.50 141.86H112.42A18.86 18.86 0 0 1 112.42 104.14Z" +
  "M112.42 158.26H141.94A18.86 18.86 0 0 1 141.94 195.98H112.42A18.86 18.86 0 0 1 112.42 158.26Z";
// Square corners to match the app's old header tile (the kit's tile has a 48/256 radius)
const TILE = "M0 0H256V256H0Z";

// Decorative: the live "ConfigRefine" text next to it carries the name
export function Logo({ size = 32, style }) {
  return (
    <svg width={size} height={size} viewBox="0 0 256 256" aria-hidden="true" focusable="false"
      style={{ display: "block", flexShrink: 0, ...style }}>
      <path fillRule="evenodd" fill="#e8b250" d={TILE + BARS} />
      <path fill="#0a0e1a" d={BARS} />
    </svg>
  );
}

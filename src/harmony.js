/**
 * harmony.js — color harmony generation and nearest-Bambu-color snapping.
 *
 * Generates up to 4 harmonious hues from a random base, then snaps each
 * generated color to the nearest real Bambu PLA color in the selectable palette.
 */

export const HARMONIES = [
  { value: 'analogous',           label: 'Analogous' },
  { value: 'complementary',       label: 'Complementary' },
  { value: 'split-complementary', label: 'Split-Complementary' },
  { value: 'triad',               label: 'Triad' },
  { value: 'square',              label: 'Square' },
  { value: 'monochromatic',       label: 'Monochromatic' },
];

/**
 * Generate up to 4 target HSL colors for the given harmony and a random base hue.
 * Returns an array of { h, s, l } objects (h in [0,360), s/l in [0,1]).
 */
export function generateHarmonyColors(harmonyValue) {
  const baseHue = Math.random() * 360;
  const s = 0.6 + Math.random() * 0.35; // 60–95% saturation
  const l = 0.40 + Math.random() * 0.20; // 40–60% lightness

  switch (harmonyValue) {
    case 'analogous':
      return [
        { h: baseHue, s, l },
        { h: (baseHue + 30) % 360, s, l },
        { h: (baseHue - 30 + 360) % 360, s, l },
        { h: (baseHue + 60) % 360, s, l: l * 0.85 },
      ];

    case 'complementary': {
      const comp = (baseHue + 180) % 360;
      return [
        { h: baseHue, s, l },
        { h: comp, s, l },
        { h: baseHue, s: s * 0.7, l: Math.min(0.9, l + 0.2) },
        { h: comp, s: s * 0.7, l: Math.min(0.9, l + 0.2) },
      ];
    }

    case 'split-complementary': {
      return [
        { h: baseHue, s, l },
        { h: (baseHue + 150) % 360, s, l },
        { h: (baseHue + 210) % 360, s, l },
        { h: baseHue, s: s * 0.6, l: Math.min(0.9, l + 0.25) },
      ];
    }

    case 'triad':
      return [
        { h: baseHue, s, l },
        { h: (baseHue + 120) % 360, s, l },
        { h: (baseHue + 240) % 360, s, l },
        { h: baseHue, s: s * 0.5, l: Math.min(0.9, l + 0.3) },
      ];

    case 'square':
      return [
        { h: baseHue, s, l },
        { h: (baseHue + 90) % 360, s, l },
        { h: (baseHue + 180) % 360, s, l },
        { h: (baseHue + 270) % 360, s, l },
      ];

    case 'monochromatic':
    default:
      return [
        { h: baseHue, s, l: 0.30 },
        { h: baseHue, s, l: 0.50 },
        { h: baseHue, s: s * 0.7, l: 0.65 },
        { h: baseHue, s: s * 0.5, l: 0.80 },
      ];
  }
}

/**
 * Convert HSL (h in [0,360), s/l in [0,1]) to { r, g, b } (each in [0,255]).
 */
function hslToRGB({ h, s, l }) {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0, g = 0, b = 0;
  if (h < 60)       { r = c; g = x; b = 0; }
  else if (h < 120) { r = x; g = c; b = 0; }
  else if (h < 180) { r = 0; g = c; b = x; }
  else if (h < 240) { r = 0; g = x; b = c; }
  else if (h < 300) { r = x; g = 0; b = c; }
  else              { r = c; g = 0; b = x; }
  return {
    r: Math.round((r + m) * 255),
    g: Math.round((g + m) * 255),
    b: Math.round((b + m) * 255),
  };
}

/**
 * Parse a hex color string (#RRGGBB) to { r, g, b }.
 */
function hexToRGB(hex) {
  const clean = hex.replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

/**
 * Perceptual color distance in RGB space (simple Euclidean with luma weighting).
 */
function colorDistance(a, b) {
  const dr = a.r - b.r;
  const dg = a.g - b.g;
  const db = a.b - b.b;
  return Math.sqrt(2 * dr * dr + 4 * dg * dg + 3 * db * db);
}

/**
 * Snap a target HSL color to the nearest color in the provided palette array.
 * @param {object} targetHSL - { h, s, l }
 * @param {Array}  palette   - array of color objects { id, hex, ... }
 * @returns the closest color object from palette
 */
export function snapToNearest(targetHSL, palette) {
  const targetRGB = hslToRGB(targetHSL);
  let best = palette[0];
  let bestDist = Infinity;

  palette.forEach(color => {
    const rgb = hexToRGB(color.hex);
    const dist = colorDistance(targetRGB, rgb);
    if (dist < bestDist) {
      bestDist = dist;
      best = color;
    }
  });

  return best;
}

/**
 * Generate a randomized set of up to 4 harmonious Bambu colors.
 * Each generated hue is snapped to the nearest real color in the palette.
 * Returns an array of color objects (may contain duplicates if the palette is small).
 *
 * @param {string} harmonyValue - one of the HARMONIES values
 * @param {Array}  palette      - selectable colors (excluded series already removed)
 * @returns Array of up to 4 color objects
 */
export function randomizeHarmony(harmonyValue, palette) {
  const hslColors = generateHarmonyColors(harmonyValue);
  return hslColors.map(hsl => snapToNearest(hsl, palette));
}

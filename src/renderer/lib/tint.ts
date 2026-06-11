/**
 * Tint color utilities for workspace profiles.
 *
 * A profile tint is layered over the app as a low-alpha wash, so it must read
 * well in both light and dark themes. Generated colors are constrained to a
 * band of the HSL space (mid saturation + mid lightness) that stays legible
 * either way, with hues spread around the wheel.
 */

const HEX_RE = /^#[0-9a-fA-F]{6}$/;

/** True when `value` is a valid 6-digit hex color like "#7c66dc". */
export function isValidTint(value: unknown): value is string {
  return typeof value === 'string' && HEX_RE.test(value.trim());
}

function hslToHex(h: number, s: number, l: number): string {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = (((h % 360) + 360) % 360) / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0, g = 0, b = 0;
  if (hp >= 0 && hp < 1) { r = c; g = x; b = 0; }
  else if (hp < 2) { r = x; g = c; b = 0; }
  else if (hp < 3) { r = 0; g = c; b = x; }
  else if (hp < 4) { r = 0; g = x; b = c; }
  else if (hp < 5) { r = x; g = 0; b = c; }
  else { r = c; g = 0; b = x; }
  const m = l - c / 2;
  const toHex = (v: number) => Math.round((v + m) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

/** Shortest distance between two hues on the color wheel (0–180). */
function circularHueDistance(a: number, b: number): number {
  return Math.abs(((a - b + 540) % 360) - 180);
}

/**
 * Generate a pleasant, theme-safe tint color.
 *
 * Hue is random across the wheel; saturation ~55–70% and lightness ~55–65%
 * keep the color vivid enough to recognize but soft enough to wash subtly.
 * Pass `avoidHue` (0–360) to bias the new hue away from the current color so a
 * tap visibly changes things.
 */
export function generateTintColor(avoidHue?: number): string {
  let hue = Math.floor(Math.random() * 360);
  if (typeof avoidHue === 'number' && Number.isFinite(avoidHue)) {
    let attempts = 0;
    while (circularHueDistance(hue, avoidHue) < 45 && attempts < 12) {
      hue = Math.floor(Math.random() * 360);
      attempts++;
    }
  }
  const sat = 0.55 + Math.random() * 0.15;   // 0.55–0.70
  const light = 0.55 + Math.random() * 0.10; // 0.55–0.65
  return hslToHex(hue, sat, light);
}

/** Extract the hue (0–360) of a hex color, for avoid-repeat logic. Null if invalid. */
export function hueOf(hex: string): number | null {
  if (!isValidTint(hex)) return null;
  const body = hex.trim().slice(1);
  const r = parseInt(body.slice(0, 2), 16) / 255;
  const g = parseInt(body.slice(2, 4), 16) / 255;
  const b = parseInt(body.slice(4, 6), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  if (d === 0) return 0;
  let h: number;
  if (max === r) h = ((g - b) / d) % 6;
  else if (max === g) h = (b - r) / d + 2;
  else h = (r - g) / d + 4;
  return ((Math.round(h * 60) % 360) + 360) % 360;
}

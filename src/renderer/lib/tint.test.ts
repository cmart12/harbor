import { describe, it, expect } from 'vitest';
import { generateTintColor, isValidTint, hueOf } from './tint';

const HEX_RE = /^#[0-9a-f]{6}$/i;

describe('isValidTint', () => {
  it('accepts 6-digit hex colors', () => {
    expect(isValidTint('#7c66dc')).toBe(true);
    expect(isValidTint('#FFFFFF')).toBe(true);
    expect(isValidTint('  #abc123  ')).toBe(true);
  });

  it('rejects invalid values', () => {
    expect(isValidTint('#fff')).toBe(false);
    expect(isValidTint('7c66dc')).toBe(false);
    expect(isValidTint('#gggggg')).toBe(false);
    expect(isValidTint('')).toBe(false);
    expect(isValidTint(null)).toBe(false);
    expect(isValidTint(42)).toBe(false);
  });
});

describe('generateTintColor', () => {
  it('always returns a valid 6-digit hex color', () => {
    for (let i = 0; i < 200; i++) {
      const color = generateTintColor();
      expect(color).toMatch(HEX_RE);
      expect(isValidTint(color)).toBe(true);
    }
  });

  it('never returns pure black or white (stays in the mid band)', () => {
    for (let i = 0; i < 200; i++) {
      const color = generateTintColor().toLowerCase();
      expect(color).not.toBe('#000000');
      expect(color).not.toBe('#ffffff');
    }
  });

  it('biases away from an avoided hue', () => {
    // Generated hue should usually be far from the avoided one. Allow a few
    // near-misses since the bias is best-effort, but require a strong majority.
    let far = 0;
    const samples = 100;
    for (let i = 0; i < samples; i++) {
      const h = hueOf(generateTintColor(0));
      expect(h).not.toBeNull();
      const dist = Math.abs(((h! - 0 + 540) % 360) - 180);
      if (dist >= 45) far++;
    }
    expect(far).toBeGreaterThan(samples * 0.8);
  });
});

describe('hueOf', () => {
  it('returns 0 for grayscale colors', () => {
    expect(hueOf('#808080')).toBe(0);
    expect(hueOf('#000000')).toBe(0);
  });

  it('returns ~0 for red, ~120 for green, ~240 for blue', () => {
    expect(hueOf('#ff0000')).toBe(0);
    expect(hueOf('#00ff00')).toBe(120);
    expect(hueOf('#0000ff')).toBe(240);
  });

  it('returns null for invalid input', () => {
    expect(hueOf('not-a-color')).toBeNull();
    expect(hueOf('#fff')).toBeNull();
  });
});

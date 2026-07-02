// Brand-aligned colormaps (single amber accent on near-black).
// t in [0,1] -> [r,g,b] 0..255.
function lerp(a, b, t) { return a + (b - a) * t; }

function ramp(stops) {
  return (t) => {
    t = Math.max(0, Math.min(1, t));
    for (let i = 0; i < stops.length - 1; i++) {
      const [t0, c0] = stops[i], [t1, c1] = stops[i + 1];
      if (t <= t1) {
        const f = (t - t0) / (t1 - t0 || 1);
        return [lerp(c0[0], c1[0], f), lerp(c0[1], c1[1], f), lerp(c0[2], c1[2], f)];
      }
    }
    return stops[stops.length - 1][1].slice();
  };
}

// near-black -> amber -> pale: reads as "low ... high value", stays on brand
export const CMAP_VALUE = ramp([
  [0.0, [16, 16, 16]],
  [0.34, [86, 56, 14]],
  [0.60, [196, 128, 14]],
  [0.82, [255, 176, 6]],
  [1.0, [255, 226, 158]],
]);

// terrain / yield: amber-dominant with a hot tip
export const CMAP_HEAT = ramp([
  [0.0, [14, 14, 14]],
  [0.38, [70, 50, 26]],
  [0.64, [198, 120, 18]],
  [0.85, [255, 176, 6]],
  [1.0, [255, 138, 78]],
]);

export function cssRamp(cmap, n = 8) {
  const out = [];
  for (let i = 0; i < n; i++) {
    const [r, g, b] = cmap(i / (n - 1));
    out.push(`rgb(${r | 0},${g | 0},${b | 0}) ${(i / (n - 1) * 100).toFixed(0)}%`);
  }
  return `linear-gradient(90deg, ${out.join(',')})`;
}

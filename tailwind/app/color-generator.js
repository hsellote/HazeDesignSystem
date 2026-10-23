/**
 * Haze Design System — Color Generator.
 *
 * Builds a light-to-dark shade ramp from any base colour and exports it as CSS,
 * Tailwind 3 / 4, JSON or tokens. The default algorithm is the one
 * tools/build-palette.py uses: every step is solved to a target WCAG contrast
 * against white by bisecting OKLCH lightness, so the AA / AAA guarantees hold
 * for any hue, not just the shipped ones.
 *
 * `markup()` is static and token-only (the registry test forbids literal hex);
 * `mount(root)` wires it and returns a cleanup for the explorer's canvas.
 */

/* ---------- colour maths: sRGB, HSL, HSV, OKLab / OKLCH, WCAG ---------- */

const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
const toLin = (c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
const toGam = (c) => (c <= 0.0031308 ? 12.92 * c : 1.055 * c ** (1 / 2.4) - 0.055);

export const hexToRgb = (h) => {
  h = h.replace('#', '');
  if (h.length === 3) h = [...h].map((c) => c + c).join('');
  return [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
};
export const rgbToHex = (rgb) => '#' + rgb.map((c) => Math.round(clamp(c) * 255).toString(16).padStart(2, '0')).join('');

function rgbToOklab([r, g, b]) {
  r = toLin(r); g = toLin(g); b = toLin(b);
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}
function oklabToLinear([L, a, b]) {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return [
    4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  ];
}
const rgbToOklch = (rgb) => {
  const [L, a, b] = rgbToOklab(rgb);
  let h = (Math.atan2(b, a) * 180) / Math.PI;
  if (h < 0) h += 360;
  return [L, Math.hypot(a, b), h];
};
const inGamut = (lin) => lin.every((c) => c >= -1e-4 && c <= 1 + 1e-4);
const lchLin = (L, C, h) => oklabToLinear([L, C * Math.cos((h * Math.PI) / 180), C * Math.sin((h * Math.PI) / 180)]);

/* OKLCH -> sRGB, reducing chroma until the colour fits — the same move build-palette.py makes. */
function oklchToRgb(L, C, h) {
  L = clamp(L);
  h = ((h % 360) + 360) % 360;
  if (!inGamut(lchLin(L, C, h))) {
    let lo = 0, hi = C;
    for (let i = 0; i < 30; i++) {
      const mid = (lo + hi) / 2;
      if (inGamut(lchLin(L, mid, h))) lo = mid; else hi = mid;
    }
    C = lo;
  }
  return lchLin(L, C, h).map((c) => toGam(clamp(c)));
}
const oklabToRgb = ([L, a, b]) => oklchToRgb(L, Math.hypot(a, b), (Math.atan2(b, a) * 180) / Math.PI);

function rgbToHsl([r, g, b]) {
  const mx = Math.max(r, g, b), mn = Math.min(r, g, b), l = (mx + mn) / 2, d = mx - mn;
  let h = 0, s = 0;
  if (d) {
    s = d / (1 - Math.abs(2 * l - 1));
    h = mx === r ? ((g - b) / d) % 6 : mx === g ? (b - r) / d + 2 : (r - g) / d + 4;
    h *= 60;
    if (h < 0) h += 360;
  }
  return [h, s, l];
}
function hslToRgb(h, s, l) {
  const c = (1 - Math.abs(2 * l - 1)) * s, x = c * (1 - Math.abs(((h / 60) % 2) - 1)), m = l - c / 2;
  const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
  return [r + m, g + m, b + m];
}
const rgbToHsv = (rgb) => {
  const [h] = rgbToHsl(rgb), v = Math.max(...rgb), d = v - Math.min(...rgb);
  return [h, v ? d / v : 0, v];
};
const hsvToRgb = (h, s, v) => {
  const l = v * (1 - s / 2);
  const sl = l === 0 || l === 1 ? 0 : (v - l) / Math.min(l, 1 - l);
  return hslToRgb(((h % 360) + 360) % 360, clamp(sl), clamp(l));
};

const lum = (rgb) => { const [r, g, b] = rgb.map(toLin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const WHITE = [1, 1, 1];
const BLACK = [0, 0, 0];

/* ---------- reading a typed or pasted value ---------- */

export function parseColour(raw) {
  const s = raw.trim().toLowerCase();
  let m;
  if ((m = s.match(/^#?([0-9a-f]{3}|[0-9a-f]{6})$/))) return hexToRgb(m[1]);
  const parts = (str) => str.split(/[\s,/]+/).filter(Boolean);
  const num = (t, scale) => (t.endsWith('%') ? parseFloat(t) / 100 : parseFloat(t) / scale);
  if ((m = s.match(/^rgba?\((.+)\)$/))) {
    const v = parts(m[1]).slice(0, 3).map((t) => num(t, 255));
    if (v.length === 3 && !v.some(isNaN)) return v.map((x) => clamp(x));
  }
  if ((m = s.match(/^hsla?\((.+)\)$/))) {
    const p = parts(m[1]);
    const h = parseFloat(p[0]), sv = num(p[1] || '', 100), lv = num(p[2] || '', 100);
    if (![h, sv, lv].some(isNaN)) return hslToRgb(((h % 360) + 360) % 360, clamp(sv), clamp(lv));
  }
  if ((m = s.match(/^oklch\((.+)\)$/))) {
    const p = parts(m[1]);
    const L = num(p[0] || '', 1), C = (p[1] || '').endsWith('%') ? (parseFloat(p[1]) / 100) * 0.4 : parseFloat(p[1]), h = parseFloat(p[2]);
    if (![L, C, h].some(isNaN)) return oklchToRgb(L > 1 ? L / 100 : L, C, h);
  }
  return null;
}

/* ---------- names: the nearest of a small list, in OKLab ---------- */

const NAMES = [
  ['Matcha', '#84b067'], ['Sage', '#9caf88'], ['Moss', '#7a8b4f'], ['Fern', '#4f7942'], ['Pine', '#2f5d3a'],
  ['Forest', '#1f4d2b'], ['Mint', '#98d7b0'], ['Seafoam', '#9fe2c8'], ['Jade', '#00a86b'], ['Emerald', '#2e9b5f'],
  ['Lime', '#a6d608'], ['Chartreuse', '#c3d93b'], ['Olive', '#808000'], ['Khaki', '#c3b091'], ['Teal', '#127c7c'],
  ['Lagoon', '#4fb3b3'], ['Aqua', '#7fdbd4'], ['Turquoise', '#2fc6c0'], ['Water Leaf', '#a1e9de'], ['Sky', '#87c4ec'],
  ['Glacier', '#bfe0f0'], ['Cerulean', '#2a7fbf'], ['Cobalt', '#1f4fb0'], ['Denim', '#3b5f8f'], ['Navy', '#1b2a4a'],
  ['Periwinkle', '#a6b2f0'], ['Indigo', '#4b3fa8'], ['Iris', '#6a5fcf'], ['Lavender', '#b9a7e6'], ['Violet', '#7d4fc4'],
  ['Grape', '#5b2a86'], ['Plum', '#7d3f6e'], ['Orchid', '#c46fc4'], ['Mauve', '#c39bbf'], ['Magenta', '#d23ba0'],
  ['Fuchsia', '#e04fd1'], ['Rose', '#e8728f'], ['Blush', '#f2b8c2'], ['Cherry', '#c41e3a'], ['Crimson', '#a51d2d'],
  ['Wine', '#6d1f2f'], ['Ruby', '#b0204a'], ['Scarlet', '#e0312b'], ['Coral', '#f2785c'], ['Salmon', '#f59f8b'],
  ['Peach', '#f8c3a0'], ['Apricot', '#f6b179'], ['Tangerine', '#f28c28'], ['Brick', '#a8432f'], ['Rust', '#b4532a'],
  ['Terracotta', '#c4704f'], ['Clay', '#b98a6e'], ['Amber', '#f0a500'], ['Honey', '#e0a83a'], ['Mustard', '#d4a72c'],
  ['Saffron', '#f4c430'], ['Lemon', '#f5e050'], ['Butter', '#f8e7a1'], ['Cream', '#f6f0dc'], ['Sand', '#d9c7a3'],
  ['Wheat', '#e6d3a7'], ['Tan', '#c7a27c'], ['Caramel', '#b07a3d'], ['Mocha', '#7b5a46'], ['Cocoa', '#5a3e2f'],
  ['Espresso', '#3b2a22'], ['Taupe', '#8b7d70'], ['Stone', '#9a978e'], ['Pebble', '#b8b6ae'], ['Ash', '#c9cbc6'],
  ['Silver', '#c0c4c8'], ['Slate', '#5d6b78'], ['Steel', '#7a8a99'], ['Graphite', '#43464b'], ['Charcoal', '#33363a'],
  ['Ink', '#1c2019'], ['Pearl', '#ece9e2'], ['Snow', '#f8faf9'],
].map(([n, h]) => [n, rgbToOklab(hexToRgb(h))]);

export function nearestName(rgb) {
  const p = rgbToOklab(rgb);
  let best = NAMES[0][0], d = Infinity;
  for (const [n, q] of NAMES) {
    const e = (q[0] - p[0]) ** 2 + (q[1] - p[1]) ** 2 + (q[2] - p[2]) ** 2;
    if (e < d) { d = e; best = n; }
  }
  return best;
}
const slug = (s) => s.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'color';

/* ---------- algorithms: each returns { rgbs, anchor } for n steps, light to dark ---------- */

const lerp = (a, b, t) => a + (b - a) * t;
const sample = (arr, t) => {
  const x = clamp(t) * (arr.length - 1), i = Math.min(arr.length - 2, Math.floor(x));
  return lerp(arr[i], arr[i + 1], x - i);
};
const shiftL = (L, s) => clamp(0.5 + (L - 0.5) * (1 + s * 0.6), 0.02, 0.995);
const nearestIdx = (arr, v) => arr.reduce((bi, x, i) => (Math.abs(x - v) < Math.abs(arr[bi] - v) ? i : bi), 0);
const steps = (n) => [...Array(n)].map((_, i) => (n === 1 ? 0.5 : i / (n - 1)));

// Target contrast vs white per step — TARGETS in tools/build-palette.py.
const HAZE_TARGETS = [1.03, 1.08, 1.22, 1.55, 2.2, 3.1, 4.65, 7.15, 10.4, 13.6, 16.6];
const chromaAt = (L, peak) => peak * Math.max(0, Math.sin(Math.PI * L ** 0.85)) ** 0.75;
function solveStep(target, h, peak) {
  let lo = 0, hi = 1, rgb;
  for (let i = 0; i < 40; i++) {
    const L = (lo + hi) / 2;
    rgb = oklchToRgb(L, chromaAt(L, peak), h);
    if (contrast(rgb, WHITE) > target) lo = L; else hi = L;
  }
  return rgb;
}

// Lightness and relative-chroma curves, light to dark.
const CURVE_L = [0.971, 0.936, 0.885, 0.811, 0.71, 0.627, 0.548, 0.488, 0.424, 0.376, 0.278];
const CURVE_C = [0.08, 0.16, 0.3, 0.52, 0.8, 0.95, 1, 0.94, 0.8, 0.64, 0.45];
const TWELVE_L = [0.993, 0.981, 0.956, 0.931, 0.904, 0.868, 0.817, 0.75, 0.63, 0.59, 0.5, 0.3];
const TWELVE_C = [0.05, 0.1, 0.22, 0.32, 0.42, 0.52, 0.64, 0.82, 1, 1, 0.92, 0.5];

/* Place the base at the step whose lightness it matches, keep it exact, and bend
   the neighboring steps toward it. */
function anchored(n, base, Ls, Cs, s, hueAt) {
  const [bL, bC, bh] = rgbToOklch(base);
  const ts = steps(n);
  const curve = ts.map((t) => sample(Ls, t));
  const anchor = nearestIdx(curve, bL);
  const delta = bL - curve[anchor];
  const peak = bC / Math.max(0.05, sample(Cs, ts[anchor]));
  const rgbs = ts.map((t, i) => {
    if (i === anchor) return base;
    const fall = Math.max(0, 1 - Math.abs(t - ts[anchor]) * 2.2);
    return oklchToRgb(shiftL(curve[i] + delta * fall, s), peak * sample(Cs, t), hueAt ? hueAt(bh, t, ts[anchor]) : bh);
  });
  return { rgbs, anchor };
}

export const ALGORITHMS = {
  haze: {
    label: 'Haze · contrast-solved',
    hint: 'Every step is solved to a target contrast against white, so 500 is always a 3:1 border color, 600 AA text and 700 AAA text. The same method builds the Haze palette.',
    run(n, base, s) {
      const [, bC, bh] = rgbToOklch(base);
      const peak = Math.max(0.015, bC * 1.1);
      const rgbs = steps(n).map((t) => solveStep(Math.exp(Math.log(sample(HAZE_TARGETS, t)) * (1 + s * 0.35)), bh, peak));
      const anchor = nearestIdx(rgbs.map((r) => Math.log(contrast(r, WHITE))), Math.log(contrast(base, WHITE)));
      return { rgbs, anchor };
    },
  },
  tailwind: {
    label: 'Tailwind-style',
    hint: 'An OKLCH lightness curve with chroma peaking mid-ramp. Your color is kept exactly at the step whose lightness it matches.',
    run: (n, b, s) => anchored(n, b, CURVE_L, CURVE_C, s),
  },
  radix: {
    label: 'Radix-style',
    hint: 'Twelve-step logic: soft backgrounds, then component fills and borders, your color as the solid step, then two text steps.',
    run: (n, b, s) => anchored(n, b, TWELVE_L, TWELVE_C, s),
  },
  ant: {
    label: 'Ant-style',
    hint: 'HSV steps around your color: lighter steps lose saturation and drift warm, darker steps gain saturation and drift cool.',
    run(n, base, s) {
      const [h, sv, v] = rgbToHsv(base);
      const anchor = Math.round((n - 1) * 0.5);
      const warm = h >= 60 && h <= 240 ? -1 : 1;
      const k = 1 + s * 0.5;
      const rgbs = [...Array(n)].map((_, i) => {
        if (i === anchor) return base;
        const d = (i - anchor) / Math.max(1, anchor);
        if (d < 0) { const a = -d; return hsvToRgb(h + warm * 10 * a, clamp(sv * (1 - 0.88 * a ** 0.9)), clamp(v + (1 - v) * a ** 0.75 * k)); }
        return hsvToRgb(h - warm * 8 * d, clamp(sv + (1 - sv) * 0.25 * d), clamp(v * (1 - 0.82 * d * k)));
      });
      return { rgbs, anchor };
    },
  },
  lightness: {
    label: 'Lightness scale',
    hint: 'Holds hue and saturation, and steps HSL lightness evenly from near-white to near-black.',
    run(n, base, s) {
      const [h, sat, l] = rgbToHsl(base);
      const Ls = steps(n).map((t) => shiftL(lerp(0.96, 0.1, t), s));
      return { rgbs: Ls.map((L) => hslToRgb(h, sat, L)), anchor: nearestIdx(Ls, l) };
    },
  },
  saturation: {
    label: 'Saturation scale',
    hint: 'Holds hue and lightness, and steps saturation from gray to full color.',
    run(n, base, s) {
      const [h, sat, l] = rgbToHsl(base);
      const Ss = steps(n).map((t) => clamp(t ** (1 - s * 0.5)));
      return { rgbs: Ss.map((S) => hslToRgb(h, S, l)), anchor: nearestIdx(Ss, sat) };
    },
  },
  hueshift: {
    label: 'Hue shift scale',
    hint: 'The lightness curve with hue rotating as it goes: light steps lean warm, dark steps lean cool.',
    run: (n, b, s) => anchored(n, b, CURVE_L, CURVE_C, s, (h, t, ta) => h - 40 * (t - ta)),
  },
  mono: {
    label: 'Monochromatic',
    hint: 'Mixes your color toward white for tints and toward a deep ink for shades, in OKLab so the steps feel even.',
    run(n, base, s) {
      const lab = rgbToOklab(base), white = rgbToOklab(WHITE), ink = rgbToOklab(hexToRgb('#0b0d0a'));
      const anchor = Math.round((n - 1) / 2);
      const rgbs = [...Array(n)].map((_, i) => {
        if (i === anchor) return base;
        const light = i < anchor;
        const span = Math.max(1, light ? anchor : n - 1 - anchor);
        const t = clamp((Math.abs(i - anchor) / span) * (light ? 0.92 : 0.85) * (1 + s * 0.15));
        const target = light ? white : ink;
        return oklabToRgb(lab.map((x, k) => lerp(x, target[k], t)));
      });
      return { rgbs, anchor };
    },
  },
  analogous: {
    label: 'Analogous',
    hint: 'Neighboring hues, 60° either side of your color, at its lightness and chroma.',
    run(n, base, s) {
      const [L, C, h] = rgbToOklch(base), anchor = Math.round((n - 1) / 2);
      const rgbs = steps(n).map((t, i) => (i === anchor ? base : oklchToRgb(shiftL(L, s * (t - 0.5)), C, h - 60 + 120 * t)));
      return { rgbs, anchor };
    },
  },
  complementary: {
    label: 'Complementary',
    hint: 'Blends from your color to its opposite hue through OKLab, passing a neutral midpoint.',
    run(n, base, s) {
      const [L, C, h] = rgbToOklch(base);
      const a = rgbToOklab(base), b = rgbToOklab(oklchToRgb(shiftL(L, s), C, h + 180));
      return { rgbs: [...Array(n)].map((_, i) => (i === 0 ? base : oklabToRgb(a.map((x, k) => lerp(x, b[k], n === 1 ? 0 : i / (n - 1)))))), anchor: 0 };
    },
  },
};

/* ---------- naming ---------- */

export const NAMINGS = {
  tw: '50, 100 … 900, 950',
  hundreds: '100, 200 … 1000',
  steps: '1, 2 … 12',
  tens: '10, 20 … 100',
  zero: '0, 5, 10 … 100',
  letters: 'a, b, c …',
};

export function stepNames(pattern, n) {
  const r = [...Array(n)].map((_, i) => i);
  switch (pattern) {
    case 'tw':
      if (n === 11) return ['50', '100', '200', '300', '400', '500', '600', '700', '800', '900', '950'];
      return r.map((i) => String(i === 0 ? 50 : i * 100));
    case 'hundreds': return r.map((i) => String((i + 1) * 100));
    case 'steps': return r.map((i) => String(i + 1));
    case 'tens': return r.map((i) => String((i + 1) * 10));
    case 'zero': return r.map((i) => String(Math.round((n === 1 ? 0 : i / (n - 1)) * 100)));
    default: return r.map((i) => (i < 26 ? String.fromCharCode(97 + i) : 'a' + String.fromCharCode(97 + i - 26)));
  }
}

/* ---------- notation ---------- */

const round = (x, d = 0) => +x.toFixed(d);
export function formatColour(rgb, notation) {
  if (notation === 'rgb') return `rgb(${rgb.map((c) => Math.round(c * 255)).join(' ')})`;
  if (notation === 'hsl') { const [h, s, l] = rgbToHsl(rgb); return `hsl(${round(h)} ${round(s * 100)}% ${round(l * 100)}%)`; }
  if (notation === 'oklch') { const [L, C, h] = rgbToOklch(rgb); return `oklch(${round(L * 100, 1)}% ${round(C, 3)} ${round(C < 0.002 ? 0 : h, 1)})`; }
  return rgbToHex(rgb);
}

/* ---------- exports ---------- */

export function exportCode(format, name, names, rgbs, notation) {
  const s = slug(name), v = (rgb) => formatColour(rgb, notation);
  const pairs = names.map((n, i) => [n, rgbs[i]]);
  switch (format) {
    case 'css': return `:root {\n${pairs.map(([n, c]) => `  --${s}-${n}: ${v(c)};`).join('\n')}\n}`;
    case 'tw3': return `// tailwind.config.js\nmodule.exports = {\n  theme: {\n    extend: {\n      colors: {\n        '${s}': {\n${pairs.map(([n, c]) => `          '${n}': '${v(c)}',`).join('\n')}\n        },\n      },\n    },\n  },\n};`;
    case 'tw4': return `@theme {\n${pairs.map(([n, c]) => `  --color-${s}-${n}: ${v(c)};`).join('\n')}\n}`;
    case 'tokens': return JSON.stringify(pairs.map(([n, c]) => {
      const cw = contrast(c, WHITE);
      const use = cw >= 4.5 ? 'text-safe on white' : cw >= 3 ? 'borders and icons, not text' : 'fills only';
      return { name: `${s}-${n}`, value: v(c), usage: `${name} ramp, step ${n}. ${cw.toFixed(2)}:1 on white (${use}).` };
    }), null, 2);
    default: return JSON.stringify({ [s]: Object.fromEntries(pairs.map(([n, c]) => [n, v(c)])) }, null, 2);
  }
}

export function svgCode(name, names, rgbs) {
  const w = 120, h = 140, gap = 12, width = rgbs.length * (w + gap) - gap;
  const cells = rgbs.map((c, i) => {
    const x = i * (w + gap), hex = rgbToHex(c).toUpperCase(), ink = inkFor(c);
    return `  <g id="${slug(name)}-${names[i]}">\n    <rect x="${x}" y="0" width="${w}" height="${h}" rx="11" fill="${hex}"/>\n    <text x="${x + 12}" y="24" fill="${ink}" font-family="JetBrains Mono, monospace" font-size="13" font-weight="600">${names[i]}</text>\n    <text x="${x + 12}" y="${h - 14}" fill="${ink}" font-family="JetBrains Mono, monospace" font-size="11">${hex}</text>\n  </g>`;
  });
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${h}" viewBox="0 0 ${width} ${h}">\n${cells.join('\n')}\n</svg>`;
}

// Black or white, whichever reads better: one of the two always clears 4.5:1.
const inkFor = (rgb) => (contrast(rgb, WHITE) >= contrast(rgb, BLACK) ? '#FFFFFF' : '#000000');

/* ---------- markup (static, token-only) ---------- */

const eyebrow = 'font-mono text-label uppercase text-content-muted';
const field = 'h-10 w-full rounded-lg border border-edge-strong bg-surface px-3 text-content';
const segBtn = 'h-7 rounded-md px-2.5 font-mono text-2xs text-content-secondary aria-pressed:bg-surface aria-pressed:text-content aria-pressed:shadow-xs';
const section = 'grid min-w-0 content-start gap-3.5 border-t border-edge p-5 first:border-t-0 @3xl:border-t-0 @3xl:border-l @3xl:first:border-l-0';

export function markup() {
  const opts = (o) => Object.entries(o).map(([k, v]) => `<option value="${k}">${typeof v === 'string' ? v : v.label}</option>`).join('');
  return `<div class="@container grid grid-cols-1 gap-6" data-colour-generator>
  <div class="grid grid-cols-1 rounded-2xl border border-edge bg-surface @3xl:grid-cols-[minmax(0,1.25fr)_minmax(0,1fr)_minmax(0,1fr)]">
    <section class="${section}" aria-labelledby="cg-base-label">
      <div class="flex items-center justify-between gap-2">
        <p id="cg-base-label" class="${eyebrow}">Base color</p>
        <div class="inline-flex gap-0.5 rounded-lg border border-edge-strong bg-surface-sunken p-0.5" role="group" aria-label="Slider model">
          <button type="button" class="${segBtn}" data-model="rgb" aria-pressed="true">RGB</button>
          <button type="button" class="${segBtn}" data-model="hsl" aria-pressed="false">HSL</button>
          <button type="button" class="${segBtn}" data-model="oklch" aria-pressed="false">OKLCH</button>
        </div>
      </div>
      <div class="flex items-center gap-2.5">
        <label class="relative h-10 w-10 shrink-0 overflow-hidden rounded-lg border border-edge-strong" data-cg="chip">
          <input type="color" data-cg="picker" aria-label="Color picker" class="absolute -inset-2 h-14 w-14 cursor-pointer opacity-0" />
        </label>
        <label for="cg-hex" class="sr-only">Hex, RGB, HSL or OKLCH value</label>
        <input id="cg-hex" type="text" spellcheck="false" autocomplete="off" aria-describedby="cg-hex-msg"
               class="${field} min-w-0 flex-1 font-mono text-body uppercase aria-invalid:border-state-danger" />
      </div>
      <p id="cg-hex-msg" role="status" class="min-h-[18px] text-xs text-state-danger"></p>
      <div class="grid gap-2" data-cg="sliders"></div>
    </section>
    <section class="${section}">
      <label for="cg-algo" class="${eyebrow}">Algorithm</label>
      <select id="cg-algo" class="${field} text-base">${opts(ALGORITHMS)}</select>
      <p class="text-xs text-content-muted" data-cg="hint"></p>
      <label for="cg-shift" class="${eyebrow}">Contrast shift</label>
      <div class="grid grid-cols-[minmax(0,1fr)_44px] items-center gap-2.5">
        <input id="cg-shift" type="range" min="-1" max="1" step="0.05" value="0" class="hz-range" />
        <output for="cg-shift" class="text-right font-mono text-xs text-content" data-cg="shift-out">0.00</output>
      </div>
    </section>
    <section class="${section}">
      <label for="cg-naming" class="${eyebrow}">Naming pattern</label>
      <select id="cg-naming" class="${field} text-base">${opts(NAMINGS)}</select>
      <p id="cg-count-label" class="${eyebrow}">Shade count</p>
      <div class="flex items-center gap-3" role="group" aria-labelledby="cg-count-label">
        <button type="button" class="hz-btn hz-btn-secondary hz-btn-s w-[34px] rounded-full px-0 text-lg" data-cg="minus" aria-label="Fewer shades">−</button>
        <output class="min-w-[2ch] text-center font-mono text-2xl font-semibold text-content" aria-live="polite" data-cg="count">11</output>
        <button type="button" class="hz-btn hz-btn-secondary hz-btn-s w-[34px] rounded-full px-0 text-lg" data-cg="plus" aria-label="More shades">+</button>
      </div>
      <button type="button" class="hz-btn hz-btn-primary hz-btn-s" data-cg="random">Random color <kbd class="rounded-xs border border-current px-1 font-mono text-2xs">Space</kbd></button>
    </section>
  </div>

  <section aria-labelledby="cg-name">
    <div class="flex flex-wrap items-end justify-between gap-3">
      <div>
        <p class="${eyebrow}">Palette</p>
        <label for="cg-name" class="sr-only">Palette name</label>
        <input id="cg-name" type="text" spellcheck="false" autocomplete="off"
               class="-ml-1.5 w-[min(100%,22ch)] rounded-md border border-transparent bg-transparent px-1.5 font-display text-2xl font-semibold text-content hover:border-edge" />
      </div>
      <div class="flex flex-wrap gap-2">
        <button type="button" class="hz-btn hz-btn-secondary hz-btn-s" data-cg="copy-svg">Copy SVG for Figma</button>
        <button type="button" class="hz-btn hz-btn-secondary hz-btn-s" data-cg="copy-list">Copy hex list</button>
      </div>
    </div>
    <!-- one row, every shade side by side; scrolls sideways only when there is no room left -->
    <div role="list" aria-label="Shades" class="mt-2.5 grid grid-flow-col auto-cols-[minmax(54px,1fr)] gap-1 overflow-x-auto pb-1 pt-0.5" data-cg="grid"></div>
  </section>

  <section aria-label="Export" class="overflow-hidden rounded-2xl border border-edge bg-surface">
    <div class="flex flex-wrap items-center justify-between gap-2.5 border-b border-edge bg-surface-sunken px-4 py-3">
      <div role="tablist" aria-label="Export format" class="flex flex-wrap gap-0.5" data-cg="formats">
        <button type="button" role="tab" data-format="css" aria-selected="true" tabindex="0" class="rounded-md px-3 py-1.5 text-sm font-medium text-content-muted aria-selected:bg-surface aria-selected:text-accent aria-selected:shadow-xs">CSS</button>
        <button type="button" role="tab" data-format="tw3" aria-selected="false" tabindex="-1" class="rounded-md px-3 py-1.5 text-sm font-medium text-content-muted aria-selected:bg-surface aria-selected:text-accent aria-selected:shadow-xs">Tailwind 3</button>
        <button type="button" role="tab" data-format="tw4" aria-selected="false" tabindex="-1" class="rounded-md px-3 py-1.5 text-sm font-medium text-content-muted aria-selected:bg-surface aria-selected:text-accent aria-selected:shadow-xs">Tailwind 4</button>
        <button type="button" role="tab" data-format="tokens" aria-selected="false" tabindex="-1" class="rounded-md px-3 py-1.5 text-sm font-medium text-content-muted aria-selected:bg-surface aria-selected:text-accent aria-selected:shadow-xs">Tokens</button>
        <button type="button" role="tab" data-format="json" aria-selected="false" tabindex="-1" class="rounded-md px-3 py-1.5 text-sm font-medium text-content-muted aria-selected:bg-surface aria-selected:text-accent aria-selected:shadow-xs">JSON</button>
      </div>
      <div class="inline-flex gap-0.5 rounded-lg border border-edge-strong bg-surface-sunken p-0.5" role="group" aria-label="Color notation">
        <button type="button" class="${segBtn}" data-notation="hex" aria-pressed="true">HEX</button>
        <button type="button" class="${segBtn}" data-notation="rgb" aria-pressed="false">RGB</button>
        <button type="button" class="${segBtn}" data-notation="hsl" aria-pressed="false">HSL</button>
        <button type="button" class="${segBtn}" data-notation="oklch" aria-pressed="false">OKLCH</button>
      </div>
    </div>
    <pre tabindex="0" aria-label="Export code" class="max-h-[340px] overflow-auto p-4 font-mono text-[12.5px] leading-relaxed text-content" data-cg="code"></pre>
    <div class="flex flex-wrap items-center justify-between gap-2.5 border-t border-edge bg-surface-sunken px-4 py-3">
      <p class="text-xs text-content-muted">Click a shade to copy it. Badges show contrast on white: AAA 7:1, AA 4.5:1, UI 3:1.</p>
      <button type="button" class="hz-btn hz-btn-primary hz-btn-s" data-cg="copy-code">Copy code</button>
    </div>
  </section>

  <p class="text-xs text-content-muted">Press <kbd class="rounded-xs border border-edge-strong px-1 font-mono text-2xs text-content">Space</kbd> for a random color, or paste a hex, rgb(), hsl() or oklch() value anywhere on the page.</p>
  <p role="status" class="fixed bottom-5 left-1/2 -translate-x-1/2 rounded-lg bg-surface-inverse px-3.5 py-2 text-xs font-medium text-content-inverse shadow-lg" data-cg="toast" hidden></p>
</div>`;
}

/* ---------- behaviour ---------- */

const MODELS = {
  rgb: {
    ch: [['R', 0, 255, 1], ['G', 0, 255, 1], ['B', 0, 255, 1]],
    get: (rgb) => rgb.map((c) => Math.round(c * 255)),
    set: (v) => v.map((c) => c / 255),
  },
  hsl: {
    ch: [['H', 0, 360, 1], ['S', 0, 100, 1], ['L', 0, 100, 1]],
    get: (rgb) => { const [h, s, l] = rgbToHsl(rgb); return [Math.round(h), Math.round(s * 100), Math.round(l * 100)]; },
    set: ([h, s, l]) => hslToRgb(h % 360, s / 100, l / 100),
  },
  oklch: {
    ch: [['L', 0, 100, 0.5], ['C', 0, 0.37, 0.005], ['H', 0, 360, 1]],
    get: (rgb) => { const [L, C, h] = rgbToOklch(rgb); return [round(L * 100, 1), round(C, 3), Math.round(C < 0.002 ? 0 : h)]; },
    set: ([L, C, h]) => oklchToRgb(L / 100, C, h),
  },
};

export function mount(root) {
  const doc = root.ownerDocument;
  const win = doc.defaultView;
  const host = root.querySelector('[data-colour-generator]');
  const $ = (sel) => host.querySelector(sel);
  const cg = (name) => $(`[data-cg="${name}"]`);
  const state = {
    base: hexToRgb('#759d66'), algorithm: 'haze', shift: 0, naming: 'tw', count: 11,
    model: 'rgb', format: 'css', notation: 'hex', name: '', named: false, result: null,
  };
  const off = [];
  const on = (el, type, fn) => { el.addEventListener(type, fn); off.push(() => el.removeEventListener(type, fn)); };

  function buildSliders() {
    const m = MODELS[state.model];
    cg('sliders').innerHTML = m.ch.map(([label, min, max, step], i) => `
      <div class="grid grid-cols-[16px_minmax(0,1fr)_44px] items-center gap-2.5 font-mono text-2xs text-content-muted">
        <label for="cg-s${i}">${label}</label>
        <input id="cg-s${i}" type="range" min="${min}" max="${max}" step="${step}" class="hz-range" />
        <output for="cg-s${i}" class="text-right text-content" data-out="${i}"></output>
      </div>`).join('');
    m.ch.forEach((_, i) => on($(`#cg-s${i}`), 'input', () => {
      setBase(m.set(m.ch.map((__, k) => parseFloat($(`#cg-s${k}`).value))), 'slider');
    }));
  }

  function syncSliders(source) {
    const m = MODELS[state.model], vals = m.get(state.base);
    m.ch.forEach(([, min, max], i) => {
      const input = $(`#cg-s${i}`);
      if (source !== 'slider') input.value = vals[i];
      $(`[data-out="${i}"]`).textContent = vals[i];
      // paint each track with the range it sweeps through
      const stops = [0, 0.25, 0.5, 0.75, 1].map((t) => { const v = [...vals]; v[i] = min + (max - min) * t; return rgbToHex(m.set(v)); });
      input.style.setProperty('--hz-range-track', `linear-gradient(90deg, ${stops.join(', ')})`);
    });
  }

  function setBase(rgb, source) {
    state.base = rgb.map((c) => clamp(c));
    const hex = rgbToHex(state.base);
    if (source !== 'hex') {
      $('#cg-hex').value = hex.toUpperCase();
      $('#cg-hex').removeAttribute('aria-invalid');
      $('#cg-hex-msg').textContent = '';
    }
    cg('picker').value = hex;
    cg('chip').style.background = hex;
    if (!state.named) state.name = nearestName(state.base);
    syncSliders(source);
    paint();
  }

  function paint() {
    const { rgbs, anchor } = ALGORITHMS[state.algorithm].run(state.count, state.base, state.shift);
    const names = stepNames(state.naming, state.count);
    state.result = { rgbs, anchor, names };
    if (doc.activeElement !== $('#cg-name')) $('#cg-name').value = state.name;
    cg('hint').textContent = ALGORITHMS[state.algorithm].hint;
    cg('count').textContent = state.count;
    cg('minus').disabled = state.count <= 3;
    cg('plus').disabled = state.count >= 20;
    cg('grid').innerHTML = rgbs.map((rgb, i) => {
      const hex = rgbToHex(rgb), cw = contrast(rgb, WHITE);
      const grade = cw >= 7 ? 'AAA' : cw >= 4.5 ? 'AA' : cw >= 3 ? 'UI' : '';
      const base = i === anchor;
      return `<button type="button" role="listitem" data-i="${i}" style="background:${hex};color:${inkFor(rgb)}"
        class="relative grid min-h-28 content-between rounded-lg border border-edge p-1.5 text-left transition-transform duration-150 hover:-translate-y-0.5"
        aria-label="${names[i]} ${hex.toUpperCase()}, ${cw.toFixed(2)} to 1 on white${base ? ', your base color' : ''}. Copy">
        <span class="font-mono text-xs font-semibold">${names[i]}</span>
        ${base ? '<span class="absolute right-1.5 top-1.5 h-1.5 w-1.5 rounded-full bg-current" aria-hidden="true"></span>' : ''}
        <span class="grid gap-1 font-mono text-[10px] leading-tight">
          <span class="${state.notation === 'hex' ? 'whitespace-nowrap tracking-tight' : 'break-all'} uppercase">${formatColour(rgb, state.notation)}</span>
          <span class="flex flex-col items-start gap-0.5"><span class="rounded-xs border border-current px-1">${cw.toFixed(2)}</span>${grade ? `<span class="rounded-xs border border-current px-1">${grade}</span>` : ''}</span>
        </span>
      </button>`;
    }).join('');
    cg('code').textContent = currentCode();
  }

  const currentCode = () => exportCode(state.format, state.name, state.result.names, state.result.rgbs, state.notation);

  let toastTimer;
  function toast(msg) {
    const t = cg('toast');
    t.textContent = msg;
    t.hidden = false;
    win.clearTimeout(toastTimer);
    toastTimer = win.setTimeout(() => { t.hidden = true; }, 1600);
  }
  function copy(text, label) {
    const legacy = () => {
      const ta = doc.createElement('textarea');
      ta.value = text;
      ta.style.cssText = 'position:fixed;top:0;opacity:0';
      doc.body.appendChild(ta);
      ta.select();
      let ok = false;
      try { ok = doc.execCommand('copy'); } catch { ok = false; }
      ta.remove();
      toast(ok ? label : 'Copy was blocked. Select the text and press ⌘C.');
    };
    if (win.navigator.clipboard && win.isSecureContext) win.navigator.clipboard.writeText(text).then(() => toast(label), legacy);
    else legacy();
  }

  function randomColour() {
    state.named = false;
    setBase(oklchToRgb(0.52 + Math.random() * 0.25, 0.06 + Math.random() * 0.13, Math.random() * 360), 'random');
  }

  on($('#cg-hex'), 'input', (e) => {
    const rgb = parseColour(e.target.value);
    if (rgb) {
      e.target.removeAttribute('aria-invalid');
      $('#cg-hex-msg').textContent = '';
      setBase(rgb, 'hex');
    } else {
      e.target.setAttribute('aria-invalid', 'true');
      $('#cg-hex-msg').textContent = e.target.value.trim() ? 'Enter a hex value, or rgb(), hsl() or oklch().' : '';
    }
  });
  on($('#cg-hex'), 'blur', (e) => { if (!e.target.getAttribute('aria-invalid')) e.target.value = rgbToHex(state.base).toUpperCase(); });
  on(cg('picker'), 'input', (e) => setBase(hexToRgb(e.target.value), 'picker'));
  host.querySelectorAll('[data-model]').forEach((b) => on(b, 'click', () => {
    state.model = b.dataset.model;
    host.querySelectorAll('[data-model]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    buildSliders();
    syncSliders();
  }));
  on($('#cg-algo'), 'change', (e) => { state.algorithm = e.target.value; paint(); });
  on($('#cg-shift'), 'input', (e) => { state.shift = parseFloat(e.target.value); cg('shift-out').textContent = state.shift.toFixed(2); paint(); });
  on($('#cg-naming'), 'change', (e) => { state.naming = e.target.value; paint(); });
  on(cg('minus'), 'click', () => { state.count = Math.max(3, state.count - 1); paint(); });
  on(cg('plus'), 'click', () => { state.count = Math.min(20, state.count + 1); paint(); });
  on($('#cg-name'), 'input', (e) => {
    state.named = !!e.target.value.trim();
    state.name = state.named ? e.target.value : nearestName(state.base);
    cg('code').textContent = currentCode();
  });
  on($('#cg-name'), 'blur', (e) => { e.target.value = state.name; });
  on(cg('random'), 'click', randomColour);
  on(cg('grid'), 'click', (e) => {
    const tile = e.target.closest('[data-i]');
    if (!tile) return;
    const i = +tile.dataset.i, value = formatColour(state.result.rgbs[i], state.notation);
    copy(value, `Copied ${state.result.names[i]} · ${value}`);
  });
  const tabs = [...cg('formats').querySelectorAll('[role="tab"]')];
  const selectFormat = (tab, focus) => {
    state.format = tab.dataset.format;
    tabs.forEach((t) => { t.setAttribute('aria-selected', String(t === tab)); t.tabIndex = t === tab ? 0 : -1; });
    if (focus) tab.focus();
    cg('code').textContent = currentCode();
  };
  tabs.forEach((t, i) => {
    on(t, 'click', () => selectFormat(t, false));
    on(t, 'keydown', (e) => {
      const next = { ArrowRight: (i + 1) % tabs.length, ArrowLeft: (i - 1 + tabs.length) % tabs.length, Home: 0, End: tabs.length - 1 }[e.key];
      if (next === undefined) return;
      e.preventDefault();
      selectFormat(tabs[next], true);
    });
  });
  host.querySelectorAll('[data-notation]').forEach((b) => on(b, 'click', () => {
    state.notation = b.dataset.notation;
    host.querySelectorAll('[data-notation]').forEach((x) => x.setAttribute('aria-pressed', String(x === b)));
    paint();
  }));
  on(cg('copy-code'), 'click', () => copy(cg('code').textContent, 'Copied export code'));
  on(cg('copy-svg'), 'click', () => copy(svgCode(state.name, state.result.names, state.result.rgbs), 'Copied SVG. Paste it into Figma.'));
  on(cg('copy-list'), 'click', () => copy(state.result.rgbs.map((c, i) => `${state.result.names[i]} ${rgbToHex(c).toUpperCase()}`).join('\n'), 'Copied hex list'));

  const typing = (el) => el && ((el.tagName === 'INPUT' && !['range', 'color', 'button'].includes(el.type)) || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
  on(doc, 'keydown', (e) => {
    if (e.code !== 'Space' || e.metaKey || e.ctrlKey || e.altKey || typing(doc.activeElement)) return;
    // Space still presses whatever button has focus
    if (doc.activeElement?.tagName === 'BUTTON' && doc.activeElement !== cg('random')) return;
    e.preventDefault();
    randomColour();
  });
  on(doc, 'paste', (e) => {
    if (typing(doc.activeElement)) return;
    const rgb = parseColour(e.clipboardData?.getData('text') || '');
    if (!rgb) return;
    e.preventDefault();
    state.named = false;
    setBase(rgb, 'paste');
    toast(`Pasted ${rgbToHex(rgb).toUpperCase()}`);
  });

  buildSliders();
  setBase(state.base);
  return () => { win.clearTimeout(toastTimer); off.forEach((fn) => fn()); };
}

/**
 * Haze test kit — the assertions behind each component's Tests tab.
 *
 * These run for real against the rendered canvas, in the browser, with no
 * install step. They are the same checks the exported Playwright / Vitest
 * specs make, so "green here" and "green in CI" mean the same thing.
 */

/* ---------------- colour maths (WCAG 2.1) ---------------- */

export function parseColor(str) {
  if (!str) return null;
  const m = str.match(/rgba?\(([^)]+)\)/);
  if (!m) return null;
  const parts = m[1].split(/[\s,\/]+/).filter(Boolean).map(Number);
  const [r, g, b] = parts;
  const a = parts.length > 3 ? parts[3] : 1;
  return { r, g, b, a };
}

const win = (el) => el.ownerDocument.defaultView;
const cs = (el) => win(el).getComputedStyle(el);

export function luminance({ r, g, b }) {
  const f = (c) => {
    c /= 255;
    return c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

export function contrastRatio(fg, bg) {
  const l1 = luminance(fg);
  const l2 = luminance(bg);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Composite a possibly-translucent colour over an opaque backdrop. */
function flatten(fg, bg) {
  if (fg.a >= 1) return fg;
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
    a: 1,
  };
}

/** Walk ancestors until an opaque background is found — what the eye sees. */
export function effectiveBackground(el) {
  const doc = el.ownerDocument;
  let node = el;
  let acc = null;
  while (node && node !== doc.documentElement) {
    const c = parseColor(cs(node).backgroundColor);
    if (c && c.a > 0) {
      acc = acc ? flatten(acc, c) : c;
      if (acc.a >= 1) return acc;
    }
    node = node.parentElement;
  }
  const html = parseColor(cs(doc.documentElement).backgroundColor);
  return acc && html ? flatten(acc, html) : (acc || html || { r: 255, g: 255, b: 255, a: 1 });
}

/** Contrast of an element's text against whatever is actually behind it. */
export function textContrast(el) {
  const style = cs(el);
  const bg = effectiveBackground(el);
  const fg = flatten(parseColor(style.color) || { r: 0, g: 0, b: 0, a: 1 }, bg);
  return contrastRatio(fg, bg);
}

/** WCAG 1.4.3 threshold for this element's rendered size. */
export function requiredTextContrast(el) {
  const style = cs(el);
  const px = parseFloat(style.fontSize);
  const weight = parseInt(style.fontWeight, 10) || 400;
  const isLarge = px >= 24 || (px >= 18.66 && weight >= 700);
  return isLarge ? 3.0 : 4.5;
}

/* ---------------- accessibility helpers ---------------- */

const FOCUSABLE = 'a[href],button,input,select,textarea,[tabindex]:not([tabindex="-1"])';

export function accessibleName(el) {
  const label = el.getAttribute('aria-label');
  if (label && label.trim()) return label.trim();
  const by = el.getAttribute('aria-labelledby');
  if (by) {
    const t = by.split(/\s+/).map((id) => el.ownerDocument.getElementById(id)?.textContent || '').join(' ');
    if (t.trim()) return t.trim();
  }
  if (el.id) {
    const lbl = el.ownerDocument.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (lbl?.textContent.trim()) return lbl.textContent.trim();
  }
  const closestLabel = el.closest('label');
  if (closestLabel?.textContent.trim()) return closestLabel.textContent.trim();
  if (el.tagName === 'IMG') return (el.getAttribute('alt') || '').trim();
  return (el.textContent || '').trim();
}

export function isFocusable(el) {
  if (el.disabled) return false;
  if (el.getAttribute('aria-hidden') === 'true') return false;
  return el.matches(FOCUSABLE);
}

export function focusableWithin(root) {
  return [...root.querySelectorAll(FOCUSABLE)].filter((el) => !el.disabled);
}

/* ---------------- assertion surface ---------------- */

export class AssertionError extends Error {}

function fail(msg) {
  throw new AssertionError(msg);
}

export function expect(actual, label = 'value') {
  return {
    toExist() {
      if (!actual) fail(`expected ${label} to exist in the canvas, found none`);
      return this;
    },
    toBe(v) {
      if (actual !== v) fail(`expected ${label} to be ${JSON.stringify(v)}, got ${JSON.stringify(actual)}`);
      return this;
    },
    toBeGreaterThanOrEqual(v) {
      if (!(actual >= v)) fail(`expected ${label} ≥ ${v}, got ${typeof actual === 'number' ? actual.toFixed(2) : actual}`);
      return this;
    },
    toContain(v) {
      if (!actual || !actual.includes(v)) fail(`expected ${label} to contain ${JSON.stringify(v)}, got ${JSON.stringify(actual)}`);
      return this;
    },
    toBeTruthy() {
      if (!actual) fail(`expected ${label} to be truthy, got ${JSON.stringify(actual)}`);
      return this;
    },
    toBeFalsy() {
      if (actual) fail(`expected ${label} to be falsy, got ${JSON.stringify(actual)}`);
      return this;
    },
  };
}

/* ---------------- reusable checks ---------------- */

/** Every text node in the canvas meets its WCAG 1.4.3 threshold. */
export const checkContrast = {
  name: 'All visible text meets WCAG AA contrast',
  wcag: '1.4.3 Contrast (Minimum)',
  fn(root) {
    const els = [...root.querySelectorAll('*')].filter((el) => {
      if (!el.offsetParent && cs(el).position !== 'fixed') return false;
      const own = [...el.childNodes].some((n) => n.nodeType === 3 && n.nodeValue.trim());
      return own;
    });
    expect(els.length, 'text-bearing elements').toBeGreaterThanOrEqual(1);
    const failures = [];
    for (const el of els) {
      const ratio = textContrast(el);
      const need = requiredTextContrast(el);
      if (ratio < need) {
        const txt = el.textContent.trim().slice(0, 28);
        failures.push(`"${txt}" ${ratio.toFixed(2)}:1 (needs ${need})`);
      }
    }
    if (failures.length) fail(failures.join('; '));
    return `${els.length} text elements checked`;
  },
};

/** Interactive elements expose a name and can take keyboard focus. */
export const checkInteractive = {
  name: 'Interactive elements are named and focusable',
  wcag: '4.1.2 Name, Role, Value · 2.1.1 Keyboard',
  fn(root) {
    const els = focusableWithin(root);
    if (!els.length) return 'no interactive elements in this story';
    let rovers = 0;
    for (const el of els) {
      const name = accessibleName(el);
      if (!name) fail(`<${el.tagName.toLowerCase()}> has no accessible name`);

      // A roving-tabindex member (tabs, menus, grids) is deliberately out of the
      // tab order and reached with arrow keys — requiring a tab stop here would
      // punish the correct ARIA pattern. It still must be named, checked above.
      if (el.getAttribute('tabindex') === '-1' || el.hidden || el.closest('[hidden]')) {
        rovers += 1;
        continue;
      }

      if (!isFocusable(el)) fail(`"${name}" cannot receive keyboard focus`);
      el.focus();
      if (el.ownerDocument.activeElement !== el && !el.contains(el.ownerDocument.activeElement)) {
        fail(`"${name}" did not take focus when focused programmatically`);
      }
    }
    els[0].blur();
    return `${els.length - rovers} focusable, ${rovers} roving/hidden, all named`;
  },
};

/** Does this computed style paint something a sighted keyboard user would see? */
function hasVisibleIndicator(style) {
  const outline = parseFloat(style.outlineWidth) > 0 && style.outlineStyle !== 'none';
  const shadow = style.boxShadow && style.boxShadow !== 'none';
  return outline || shadow;
}

/**
 * Focus must be visible — WCAG 2.4.7.
 *
 * Two-stage on purpose. Browsers only apply :focus-visible after genuine user
 * activation, so a programmatic focus() in a fresh tab or a CI run would report
 * a false failure. When the live check cannot confirm, fall back to proving a
 * :focus-visible rule exists in the cascade that WOULD paint an indicator on
 * this element — which is the thing we actually care about.
 */
export const checkFocusVisible = {
  name: 'Focus is visible on keyboard focus',
  wcag: '2.4.7 Focus Visible',
  fn(root) {
    const els = focusableWithin(root);
    if (!els.length) return 'no interactive elements in this story';
    const el = els[0];
    const doc = el.ownerDocument;

    // stage 1 — live
    el.focus({ focusVisible: true });
    const live = el.matches(':focus-visible') && hasVisibleIndicator(cs(el));
    el.blur();
    if (live) return 'focus indicator present';

    // stage 2 — prove the rule exists.
    // Must recurse: Tailwind v4 wraps everything in native @layer blocks, so
    // sheet.cssRules yields CSSLayerBlockRule containers, not style rules.
    const paintsIndicator = (style) =>
      (style.outlineWidth && style.outlineStyle !== 'none') ||
      style.boxShadow ||
      style.getPropertyValue('--tw-ring-shadow') ||
      style.getPropertyValue('--tw-ring-offset-shadow');

    const findRule = (rules) => {
      for (const rule of rules) {
        // grouping rule (@layer, @media, @supports, @container) — descend
        if (rule.cssRules && !rule.selectorText) {
          const hit = findRule(rule.cssRules);
          if (hit) return hit;
          continue;
        }
        if (!rule.selectorText || !rule.selectorText.includes(':focus-visible')) continue;
        if (!paintsIndicator(rule.style)) continue;
        // would this selector match our element once the pseudo-class is met?
        const base = rule.selectorText.replace(/:focus-visible/g, '').trim();
        if (!base || base === '*') return rule.selectorText;
        try {
          if (el.matches(base)) return rule.selectorText;
        } catch { /* unparseable selector — skip */ }
      }
      return null;
    };

    let found = null;
    for (const sheet of doc.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue; // cross-origin sheet (fonts) — nothing to read
      }
      found = findRule(rules);
      if (found) break;
    }

    if (found) return `":focus-visible" rule in cascade (${found})`;
    fail('no visible focus indicator: neither a live ring nor a :focus-visible rule that would paint one');
  },
};

/**
 * Pointer targets should be at least 24x24 CSS px — WCAG 2.5.8 (AA, 2.2).
 *
 * Two exceptions from the spec are honoured, or this would fire constantly on
 * correct markup:
 *   - "Inline": a link inside a sentence, sized by the surrounding line-height.
 *   - The real target is the wrapping <label>, not the 16px checkbox inside it.
 */
function effectiveTarget(el) {
  const label = el.closest('label');
  if (label && /^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) return label;
  return el;
}

function isInlineInSentence(el) {
  if (el.tagName !== 'A') return false;
  const parent = el.parentElement;
  if (!parent) return false;
  if (!/^(P|LI|SPAN|TD|DD|H1|H2|H3|H4|H5|H6|LABEL|DIV)$/.test(parent.tagName)) return false;
  // there is other text around it, so the line box constrains the target
  const own = el.textContent.trim();
  const around = parent.textContent.trim();
  return around.length > own.length + 2;
}

export const checkTargetSize = {
  name: 'Pointer targets are at least 24×24px',
  wcag: '2.5.8 Target Size (Minimum)',
  fn(root) {
    const els = focusableWithin(root);
    if (!els.length) return 'no interactive elements in this story';
    const small = [];
    let exempt = 0;
    for (const el of els) {
      if (isInlineInSentence(el)) { exempt += 1; continue; }
      const target = effectiveTarget(el);
      const r = target.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      if (r.width < 24 || r.height < 24) {
        small.push(`${accessibleName(el) || el.tagName} ${Math.round(r.width)}×${Math.round(r.height)}`);
      }
    }
    if (small.length) fail(small.join('; '));
    return `${els.length - exempt} target(s) ≥ 24×24${exempt ? `, ${exempt} inline-exempt` : ''}`;
  },
};

/** Images carry alt text (empty alt is valid, but it must be present). */
export const checkImages = {
  name: 'Images declare alt text',
  wcag: '1.1.1 Non-text Content',
  fn(root) {
    const imgs = [...root.querySelectorAll('img')];
    if (!imgs.length) return 'no images in this story';
    for (const img of imgs) {
      if (!img.hasAttribute('alt')) fail(`<img src="${img.getAttribute('src')}"> has no alt attribute`);
    }
    return `${imgs.length} image(s) have alt`;
  },
};

/** The baseline suite every story runs. */
export const BASE_CHECKS = [
  checkContrast,
  checkInteractive,
  checkFocusVisible,
  checkTargetSize,
  checkImages,
];

/** Run a suite against a root element; never throws. */
export function runChecks(checks, root) {
  return checks.map((check) => {
    const started = performance.now();
    try {
      const detail = check.fn(root);
      return { name: check.name, wcag: check.wcag, status: 'pass', detail, ms: performance.now() - started };
    } catch (err) {
      return {
        name: check.name,
        wcag: check.wcag,
        status: err instanceof AssertionError ? 'fail' : 'error',
        detail: err.message,
        ms: performance.now() - started,
      };
    }
  });
}

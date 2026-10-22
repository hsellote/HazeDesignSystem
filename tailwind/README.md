# Haze Design System — Tailwind v4

A Storybook-style component explorer for the Haze design language: searchable component tree, isolated iframe canvas, live controls, light/dark themes, and a **Tests** tab that runs real accessibility assertions against whatever is on screen.

```bash
npm install
npm run build    # compile dist/haze.css
npm run serve    # http://localhost:8788
```

Open `http://localhost:8788/index.html`. Press `/` to jump to the search box.

**Current status:** 386 in-browser checks across 24 stories × 2 themes, 302 rendered classes all compiling, 32 contrast assertions — all green on Tailwind **4.3.3**.

## What's here

```
index.html               the explorer shell
app/
  stories.js             the component registry — one entry per component
  app.js                 sidebar, routing, controls, tabs, test runner
  testkit.js             WCAG maths + the assertions behind the Tests tab
src/input.css            THE CONFIG — v4 is CSS-first, there is no tailwind.config.js
tokens.generated.css     GENERATED — raw values, :root and .dark
theme.generated.css      GENERATED — the @theme inline block mapping them to utilities
tools/
  build-palette.py       the palette solver (see below)
  build-css.mjs          the CSS build (PostCSS API, not the CLI)
  check-classes.mjs      asserts every rendered class has a rule in dist/haze.css
  serve.py               no-cache dev server
tests/
  a11y.spec.js           Playwright — every story, both themes
  render.test.js         Vitest — registry and markup invariants
assets/                  brand marks — synced, not hand-copied (see below)
dist/haze.css            the compiled stylesheet you actually ship
```

## Colour: solved, not picked

`tools/build-palette.py` does not contain a list of hand-chosen hexes. Each ramp step declares a **target WCAG contrast ratio against white**, and the script binary-searches OKLCH lightness until it hits that target, clamping chroma to stay inside sRGB.

That makes the guarantees structural:

| Step | Target vs white | Meaning |
|---|---|---|
| `500` | 3.1:1 | Non-text contrast — borders, focus rings, icons (WCAG 1.4.11) |
| `600` | 4.65:1 | AA body text on a white surface |
| `700` | 7.15:1 | AAA body text on a white surface |

The script then asserts **15 semantic pairings in each theme** — body text on surface, label on a filled button, meaningful borders, accent on the inverse surface — and **exits non-zero if any drops below its minimum**.

```bash
npm run palette    # 30/30 assertions currently pass
```

Run it in CI and a contrast regression cannot merge.

## Colour: two layers

**Ramps** — `brand`, `neutral`, `danger`, `warning`, `info`, each `50 → 950`. Mode-independent. Use when you need one specific step.

**Semantic roles** — `surface`, `content`, `accent`, `edge`, `state`. These swap under `.dark`, so `bg-surface text-content` is correct in both themes with no `dark:` variant. **Reach for these first.**

```html
<!-- good: works in both themes -->
<div class="bg-surface text-content border border-edge">…</div>

<!-- avoid: needs a dark: variant for every property -->
<div class="bg-white text-neutral-900 dark:bg-neutral-900 dark:text-neutral-50">…</div>
```

The mechanism is `@theme inline`:

```css
/* tokens.generated.css — raw values, swapped by .dark */
:root { --role-surface: #FFFFFF; }
.dark { --role-surface: #2B2F28; }

/* theme.generated.css — maps them onto utilities */
@theme inline { --color-surface: var(--role-surface); }
```

`inline` is the important word. It makes `.bg-surface` emit `var(--role-surface)` rather than baking in the light value, which is what lets `.dark` override it at runtime. Plain `@theme` would freeze it.

Opacity modifiers work on all of it — `bg-surface/50`, `border-edge-strong/40` — because v4 composes them with `color-mix()`.

## Dark mode

Class strategy, declared in CSS:

```css
@custom-variant dark (&:where(.dark, .dark *));
```

Put `dark` on `<html>`. `index.html` reads the stored preference before first paint so the shell never flashes the wrong theme. To follow the OS instead:

```js
document.documentElement.classList.toggle(
  'dark',
  localStorage.theme === 'dark' ||
    (!('theme' in localStorage) && matchMedia('(prefers-color-scheme: dark)').matches)
);
```

## Spacing, gutters and layout

Tailwind's 4px scale is unchanged — use `p-4`, `gap-6` inside components. On top of it sit **named layout steps** so page rhythm stays consistent:

| Token | Value | Use for |
|---|---|---|
| `gutter-sm` | 16px | Dense grids, mobile gutters |
| `gutter` | 24px | Default grid gutter and card padding |
| `gutter-lg` | 32px | Page gutters at `lg` and up |
| `section` | 64px | Vertical space between page sections |
| `section-lg` | 96px | Major section breaks |
| `field` | 10px | Vertical padding inside inputs and buttons |

`container` is a `@utility` in v4 rather than a config object — centred, with responsive gutters (16 → 24 at `sm` → 32 at `lg`).

## Typography

Every step in the scale carries its own line-height and tracking, so `text-body` is a finished decision rather than just a size.

**Two families**, matching the portfolio:

| Token | Family | Carries |
|---|---|---|
| `font-sans` | Poppins 400/500 | UI and body copy |
| `font-display` | Poppins 500/600 | Headings, stat values |
| `font-mono` | JetBrains Mono 400/500 | Labels, metadata, code |
| `font-script` | JetBrains Mono | The aside voice — tracked out, accent-coloured |

`font-sans` and `font-display` resolve to the same family on purpose: heading versus body is a difference of **weight**, not of family. Keeping both names means the intent stays readable in the markup, and swapping in a separate display face later is a one-line change. `font-script` is likewise an alias onto mono — the aside voice keeps its own name even though it no longer has its own font.

## Layout

The explorer docks the details panel **beside** the canvas, not under it, so the preview and the controls are visible at once:

| Width | Layout |
|---|---|
| ≥ 1536px (`2xl`) | canvas + 32rem panel, side by side |
| ≥ 1024px (`lg`) | canvas + 26rem panel, side by side |
| < 1024px | stacked, panel underneath |

Nothing scrolls the page — every region scrolls inside itself. That depends on an unbroken height chain: `body` and the outer grid are `overflow-hidden`, the outer grid pins its row with `grid-rows-[minmax(0,1fr)]`, and `main` plus every nested flex/grid child carries `min-h-0`. Drop any one of those and the row sizes to content, `main` grows past the screen, and the page scrolls again.

The Controls grid sizes itself with a **container query** (`@sm:grid-cols-2 @3xl:grid-cols-3`), so it reflows to the panel's own width — 2 columns when docked to the side, 3 when the panel is wide and short underneath.

## Alert tones

Four tones, each defined once in `ALERT_TONE` so the colour, the icon and the live-region politeness cannot drift apart:

| Tone | Colour role | Live region | Icon | Use |
|---|---|---|---|---|
| `info` | `state-info` | `role="status"` | ⓘ circle | Neutral information |
| `success` | `state-success` | `role="status"` | ✓ tick | An action completed |
| `warning` | `state-warning` | `role="status"` | △ triangle | Needs attention, nothing failed |
| `error` | `state-danger` | `role="alert"` | ✕ cross | Something failed |

**`error` vs `danger`** — the same colour role, two names for two contexts. A button is `danger` (destructive intent); a message is an `error` (something went wrong). `hz-btn-danger` and the alert's `error` tone both resolve to `state-danger`.

Backgrounds and borders are opacity modifiers on the same role (`bg-state-info/5`, `border-state-info/30`), so they follow the theme automatically — the roles flip from the 600 step on white to the 300 step on dark.

**Only `error` is assertive.** `role="alert"` interrupts whatever a screen reader is saying; spending it on a success toast means the one that matters gets ignored.

**Each tone has a distinct icon shape, not just a colour.** Success and error are the classic red/green confusion pair — the tick and the cross are what make them distinguishable to the ~8% of men with a red-green deficiency. A check asserts all four icons differ.

## Brand assets

The logo and favicon come from the portfolio; it is the source of truth and the systems consume it. One command re-syncs everything:

```bash
../tools/sync-assets.sh
```

It regenerates the derived UI sizes from the master at `../assets/logo.jpg` and places a copy in `tailwind/assets/`. Pass `--from <dir>` to import a new master.

| File | Size | Weight | Use |
|---|---|---|---|
| `logo.jpg` | 2251×2251 | 197 KB | **Master only.** Never load in a page. |
| `logo-128.png` | 128×128 | 3.9 KB | Every UI use up to 64px. Retina-safe. |
| `logo-64.png` | 64×64 | 2.0 KB | Marks at 32px and below. |
| `favicon.png` | 256×256 | 9.9 KB | Tab icon. |

Two things this fixed. The explorer previously pointed at `../assets/`, which **404'd** — a static server will not traverse above its root, so the sidebar mark and the favicon were simply broken. And both systems loaded the 2251px, 197KB master to render a 32px mark; the derived sizes cut that by 98%.

Derived sizes are generated by the script rather than committed by hand, so they cannot drift from the original. Change the logo in the portfolio, re-run, done.

## Button sizes

**The scale below is the system's own.** It was set to match the site this language came from, and the values are deliberate — see the notes on radius and the off-grid steps before changing any of them.

| Size | Height | Padding | Text | Radius | Tailwind |
|---|---|---|---|---|---|
| `hz-btn-xs` | 28px | 10px | 11px | 7px | `h-7 px-2.5 text-2xs rounded-[7px]` |
| `hz-btn-s` | 34px | 13px | 12.5px | 8px | `h-[34px] px-[13px] text-[12.5px] rounded-md` |
| `hz-btn-m` | 40px | 16px | 14px | 9px | `h-10 px-4 text-base rounded-[9px]` |
| `hz-btn-l` | 48px | 22px | 15.5px | 11px | `h-12 px-[22px] text-[15.5px] rounded-lg` |

**The radius scales with the size** — 7/8/9/11px rather than one flat corner. A 48px button with a 7px corner reads sharper than a 28px one, so the corner has to grow with the box to look like the same shape. A check asserts each value and that it never shrinks as the button grows.

**Not every step is on Tailwind's 4px grid.** 34px, 13px, 12.5px and 15.5px use arbitrary values. That is faithful to the portfolio — don't tidy them onto the grid without changing the portfolio first.

28px is the floor: WCAG 2.5.8 wants a 24px minimum target, and 24 would sit exactly on it with no tolerance.

### Floating action button

The FAB has its **own** scale, not the button scale — it floats above content and has to stay reachable with a thumb:

| Class | Size | Use |
|---|---|---|
| `hz-fab` | 56×56 | Default |
| `hz-fab-mini` | 40×40 | Dense layouts |
| `hz-fab-extended` | 56px, pill | With a visible label |

It reuses `hz-btn-primary` / `hz-btn-secondary` for fill — a FAB is a button in a different shape, not a different colour system. Being icon-only, **`aria-label` is mandatory**; a check fails if any FAB lacks one.

## Documentation-only markup

A story's canvas often carries reference material — a size matrix, a tone comparison — that belongs on screen but not in the code someone copies. Wrap it in `data-doc`:

```js
render: (a) => `${liveComponent}
<div data-doc> …the reference scale… </div>`
```

The Code tab strips `[data-doc]` before generating HTML, Vue and React, so the snippet is the component and nothing else. The **Button** story uses this: the canvas shows the full size × variant × FAB matrix, the Code tab emits one button.

## Component conventions

Tailwind's own component libraries (Tailwind Plus / Catalyst, built on Headless UI) style state through **`data-*` attributes** — `data-checked`, `data-hover`, `data-selected` — because they render unstyled JavaScript components that have no semantics of their own.

**This system styles off ARIA instead**, using v4's built-in `aria-*` variants:

```html
<button role="tab" aria-selected="true"
        class="border-transparent text-content-muted
               aria-selected:border-accent aria-selected:text-accent">
```

The highlight and the screen-reader announcement come from **one attribute**, so they cannot drift — if the tab looks selected, it *is* selected to assistive tech. A `data-selected` attribute carries no accessibility meaning and would have to be kept in sync with `aria-selected` by hand. `nav-item` uses `aria-[current=page]:` the same way.

Where a component genuinely needs JS-only state with no ARIA equivalent, a `data-*` attribute is the right tool — `data-*` variants work exactly as they do in Headless UI.

**Container queries.** The `stat` story defaults to `@container` + `@md:` rather than viewport breakpoints, because a reusable component should reflow when *its own box* is narrow, not when the window is. Flip its `query` control to `viewport` and widen the component: the viewport version stays stuck at 2 columns with 800px of room available, which is the bug container queries exist to fix.

## Testing

Four layers, all runnable.

**1. In the browser — the Tests tab.** Open any component, hit *Run all checks*. Each story runs five baseline checks (contrast, accessible names, focus visibility, target size, image alt) plus its own — combobox wiring on the palette, `scope` on table headers, `aria-valuenow` matching rendered bar width on the meter. They execute against the live canvas in the current theme, so flipping to dark and re-running is a genuine second test.

**2. Class coverage.** `npm run check:classes` renders every story across every control value and asserts each class has a rule in `dist/haze.css`. This is what catches a token that silently failed to map to a v4 namespace.

**3. End-to-end — Playwright.** `tests/a11y.spec.js` walks every story in both themes and asserts zero failures.

**4. Unit — Vitest.** `tests/render.test.js` asserts registry invariants: unique ids, every control actually changes the output, no hard-coded hex, every story ships a QA checklist.

```bash
npm run verify    # palette + build + class coverage + unit
```

Each component's Tests tab also prints a **manual QA checklist** for what automation cannot judge — whether a screen reader announcement actually makes sense, whether focus lands somewhere sensible after a dialog closes.

## Gotchas worth knowing

- **`npm run build` uses `tools/build-css.mjs`, not the CLI.** The Tailwind CLI blocks on stdin and orphans processes in some shells; the PostCSS API exits cleanly (~7s cold, ~100ms incremental).
- **Never open this explorer from `file://`, and never with VS Code Live Server.** It is an ES-module app, so `file://` is blocked by the browser and the page renders blank — there is now a guard that says so instead of failing silently. Live Server is worse: it serves the folder of the VS Code *window it was started from*, so if it is already running for another project you get **that project's** site on `localhost:5500`, with no error. Use `npm run serve` (port 8788), which is rooted here by construction.
- **`npm run serve` sends `no-store`, and `npm run build` cache-busts.** ES modules and stylesheets cache *hard* — a browser that once loaded this app from a plain `python3 -m http.server` (no cache headers) can keep serving you a stale build for days, and reloading does not help. Two defences: the dev server sends `no-store`, and every build stamps `index.html` with `?v=<buildstamp>` on both the stylesheet and the module entry. `app/app.js` propagates that stamp to its own imports, so `stories.js` and `testkit.js` are busted too. **If you ever see stale components, run `npm run build` — that regenerates the stamp and forces a fresh fetch.**
- **Only complete class strings compile, and v4's extractor is stricter than v3's.** `class="pl-9${cond ? ' pr-14' : ''}"` silently dropped `pl-9` on v4 because the `$` abuts it — put a space before the interpolation. Never build a class name dynamically (`bg-${tone}-500`); use a lookup map of full names, as the stories do.
- **v4 has no `--duration-*` theme namespace.** Named durations like `duration-fast` do not exist — use `duration-150` or `duration-[280ms]`.
- **v4 wraps output in native `@layer` blocks.** Anything that walks `document.styleSheets` must recurse into `CSSLayerBlockRule` containers; `testkit.js` does.
- **Source detection skips hidden directories.** A probe file in `.something/` will never be scanned.
- **`check:classes` does not see inline `style` attributes.** It validates Tailwind class names only. A hand-written `style="background: var(--token)"` referencing a renamed token fails silently — that is how the v4 rename from `--color-*` to `--role-*` left every semantic swatch transparent without a single check going red. Stories that paint from tokens inline should assert the result is not transparent; the Color story now does.

## Adding a component

Add one entry to `app/stories.js`:

```js
const myThing = {
  id: 'my-thing',
  title: 'My Thing',
  group: 'Components',
  summary: 'One or two sentences on what it is for.',
  args: { tone: sel(['a', 'b'], 'a'), label: text('Hello') },
  render: (a) => `<div class="rounded-xl border border-edge bg-surface p-gutter">${a.label}</div>`,
  api: [['tone', 'a | b', 'a', 'What it changes.']],
  notes: ['Anything non-obvious about using it correctly.'],
  tests: {
    checklist: ['Tab to it — the focus ring is visible.'],
    checks: [{ name: '…', wcag: '…', fn(root) { /* throw to fail */ } }],
  },
};
```

Then add it to the `STORIES` array. It appears in the sidebar, gets the five baseline checks for free, and its Code tab generates HTML / Vue / React automatically. Run `npm run check:classes` afterwards.

**Behaviour.** A story that needs real interaction adds `setup(root, { args, update })`. The canvas calls it after every render and runs the function it returns before the next one, so listeners on the canvas document never pile up. `update(nextArgs, focusSelector)` writes args back through the same path as the Controls tab and puts focus where it belongs once the new markup is in, so the canvas, Controls and Code tabs never disagree. Tabs, Slide-over Panel and Command Palette use it for their keyboard behaviour, and the **Color** story uses it to mount its ramp generator (`app/color-generator.js`) under the palette.

## The vanilla CSS system

There used to be a second system in `../` — the same design language as hand-written CSS
(`tokens.css` + `system.css`) with no build step, documented by its own `guide.html`. It was folded
into this one and removed; this folder is now the whole system.

What came across:

- Its eight portfolio-only components are stories here — **Case Card**, **Post Card**, **Timeline**,
  **Detail List**, **Filter Group**, **Link Row**, **Top Bar** and **Status Bar**. The markup is new,
  re-expressed on v1.0 tokens; the design decision each one encodes is not.
- Everything else it had (buttons, badges, status dots, cards, stats, nav, meters, hero, CTA,
  command palette, slide-over) already had a counterpart here, so nothing was duplicated.
- Its palette did **not** come across. v1.0's ramps are solved for contrast, and the vanilla ramp had
  a step that measured 3.66:1 — it cannot exist in a ramp with a 4.5:1 floor.

Because the live portfolio still ships the retired values, they are kept as a record in the
**Reference** group rather than deleted:

- **Portfolio Original** — every retired token, its hex, its measured contrast, and the v1.0 role that
  replaces it. This is the map to use when the portfolio migrates.
- **Findings** — what turned up while extracting the language, filterable by whether the merge closed
  it. A finding marked "still open" is a decision about the portfolio, not about this system.

Those two stories are the only ones allowed to quote literal hex in their markup; they set
`quotesLiteralColour: true`, and `tests/render.test.js` fails the build if any story outside the
Reference group sets it.

This folder is self-contained. It neither reads from nor writes to any other project on disk.

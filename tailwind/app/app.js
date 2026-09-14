/**
 * Haze Design System — the explorer shell.
 *
 * Storybook-shaped: a searchable tree on the left, an isolated iframe canvas in
 * the middle, and Controls / Code / API / Tests underneath. The canvas is a real
 * iframe so viewport emulation is genuine and nothing from the docs chrome can
 * leak into a component's styles.
 */

/* Cache-busting: index.html loads this module as `app/app.js?v=<buildstamp>`.
   Static imports would resolve ./stories.js to an unversioned URL that a browser
   may still have cached, so propagate the stamp to every dependency — and to the
   stylesheet the canvas iframe loads. Without this, a rebuild can leave someone
   staring at last week's components and no amount of reloading helps. */
const BUILD = new URL(import.meta.url).searchParams.get('v') || '';
const bust = (path) => (BUILD ? `${path}?v=${BUILD}` : path);

const { STORIES, GROUPS, storyById, defaultArgs, BASE_CHECKS } = await import(bust('./stories.js'));
const { runChecks } = await import(bust('./testkit.js'));

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

/* Storage is a convenience, never a dependency: it throws in private mode,
   with cookies blocked, and inside sandboxed frames. Both directions are
   guarded so a failure can never take the UI down with it. */
function readStored(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    /* preference just will not persist this session */
  }
}

const state = {
  storyId: null,
  args: {},
  tab: 'canvas',
  codeLang: 'html',
  theme: readStored('hz-theme') || 'light',
  viewport: 'responsive',
  results: null,
  running: false,
};

const VIEWPORTS = {
  responsive: { label: 'Responsive', w: null },
  mobile: { label: 'Mobile · 375', w: 375 },
  tablet: { label: 'Tablet · 768', w: 768 },
  desktop: { label: 'Desktop · 1280', w: 1280 },
};

/* ============================================================
   markup helpers
   ============================================================ */

const escapeHtml = (s) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Strip the common leading indentation a template literal leaves behind. */
function dedent(str) {
  const lines = str.replace(/^\n+/, '').replace(/\s+$/, '').split('\n');
  const indents = lines.filter((l) => l.trim()).map((l) => l.match(/^ */)[0].length);
  const min = indents.length ? Math.min(...indents) : 0;
  return lines.map((l) => l.slice(min)).join('\n');
}

/** Rough HTML → JSX. Enough for copy-paste into a React file. */
function toJsx(html) {
  return dedent(html)
    .replace(/\bclass=/g, 'className=')
    .replace(/\bfor=/g, 'htmlFor=')
    .replace(/\btabindex=/g, 'tabIndex=')
    .replace(/\bstroke-width=/g, 'strokeWidth=')
    .replace(/\bstroke-linecap=/g, 'strokeLinecap=')
    .replace(/\bstroke-linejoin=/g, 'strokeLinejoin=')
    .replace(/\bstroke-dasharray=/g, 'strokeDasharray=')
    .replace(/\bautocomplete=/g, 'autoComplete=')
    .replace(/\bcolspan=/g, 'colSpan=')
    .replace(/\browspan=/g, 'rowSpan=')
    // boolean attributes need explicit JSX values
    .replace(/\s(disabled|checked|required|hidden|selected)(?=[\s>])/g, ' $1={true}')
    // style="a:b" → style={{ a: 'b' }}
    .replace(/style="([^"]*)"/g, (_, css) => {
      const obj = css.split(';').filter((d) => d.trim()).map((d) => {
        const [prop, ...rest] = d.split(':');
        const key = prop.trim().replace(/-([a-z])/g, (m, c) => c.toUpperCase());
        return `${key}: '${rest.join(':').trim()}'`;
      }).join(', ');
      return `style={{ ${obj} }}`;
    })
    // void elements must self-close
    .replace(/<(input|img|br|hr)([^>]*?)\s*\/?>/g, '<$1$2 />')
    .replace(/\s+\/ \/>/g, ' />');
}

function toVue(html, story) {
  const name = story.title.replace(/[^A-Za-z]/g, '');
  return `<!-- ${name}.vue -->
<template>
${dedent(html).split('\n').map((l) => '  ' + l).join('\n')}
</template>

<script setup>
// Props map 1:1 to the Controls panel above.
defineProps({
${Object.entries(story.args || {}).map(([k, spec]) =>
  `  ${k}: { type: ${spec.type === 'boolean' ? 'Boolean' : 'String'}, default: ${JSON.stringify(spec.default)} },`
).join('\n') || '  // this component takes no props'}
});
<\/script>`;
}

/* ============================================================
   canvas iframe
   ============================================================ */

let frame = null;
let frameReady = false;

function canvasDoc() {
  return frame?.contentDocument || null;
}

function canvasRoot() {
  return canvasDoc()?.getElementById('root') || null;
}

function buildFrame() {
  frame = document.createElement('iframe');
  frame.className = 'h-full w-full border-0 bg-bg';
  frame.setAttribute('title', 'Component preview');
  frame.srcdoc = `<!doctype html>
<html lang="en" class="${state.theme === 'dark' ? 'dark' : ''}">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<link rel="preconnect" href="https://fonts.googleapis.com" />
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin />
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Poppins:wght@400;500;600&family=JetBrains+Mono:wght@400;500&display=swap" />
<link rel="stylesheet" href="${bust('dist/haze.css')}" />
<style>
  body { padding: 2rem; }
  @media (max-width: 480px) { body { padding: 1rem; } }
</style>
</head>
<body class="bg-bg text-content"><div id="root"></div></body>
</html>`;
  frame.addEventListener('load', () => {
    frameReady = true;
    paintCanvas();
  });
  return frame;
}

function paintCanvas() {
  const root = canvasRoot();
  const story = storyById(state.storyId);
  if (!root || !story) return;
  root.innerHTML = story.render(state.args);
  // keep the iframe theme in step with the toolbar
  canvasDoc().documentElement.classList.toggle('dark', state.theme === 'dark');
}

/* ============================================================
   rendering — sidebar
   ============================================================ */

function renderSidebar(filter = '') {
  const q = filter.trim().toLowerCase();
  const matches = (s) =>
    !q || s.title.toLowerCase().includes(q) || s.id.includes(q) ||
    (s.summary || '').toLowerCase().includes(q);

  const html = GROUPS.map((group) => {
    const items = STORIES.filter((s) => s.group === group && matches(s));
    if (!items.length) return '';
    return `
      <div class="mb-4">
        <p class="px-3 pb-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted">${group}</p>
        <ul class="space-y-px">
          ${items.map((s) => `
            <li>
              <a href="#/story/${s.id}" data-nav="${s.id}"
                 class="flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-colors ${
                   s.id === state.storyId
                     ? 'bg-accent text-accent-fg font-medium'
                     : 'text-content-secondary hover:bg-surface-sunken hover:text-content'
                 }">
                <span class="h-1 w-1 rounded-full ${s.id === state.storyId ? 'bg-current' : 'bg-edge-strong'}"></span>
                ${s.title}
              </a>
            </li>`).join('')}
        </ul>
      </div>`;
  }).join('');

  $('#tree').innerHTML = html || `<p class="px-3 py-6 text-center text-xs text-content-muted">No components match “${escapeHtml(filter)}”.</p>`;
}

/* ============================================================
   rendering — controls
   ============================================================ */

function renderControls(story) {
  const entries = Object.entries(story.args || {});
  if (!entries.length) {
    return `<p class="text-xs text-content-muted">This story has no controls.</p>`;
  }
  // Container query, not viewport: the panel is ~26rem docked to the side and
  // full-width when stacked underneath. Its own box should decide the columns.
  return `<div class="grid gap-3 @sm:grid-cols-2 @3xl:grid-cols-3">
    ${entries.map(([key, spec]) => {
      const id = `ctl-${key}`;
      if (spec.type === 'boolean') {
        return `<div class="flex items-center justify-between gap-3 rounded-lg border border-edge bg-surface px-3 py-2">
          <label for="${id}" class="text-xs font-medium text-content">${key}</label>
          <input id="${id}" type="checkbox" data-arg="${key}" ${state.args[key] ? 'checked' : ''}
                 class="h-4 w-4 rounded-xs border-edge-strong accent-accent" />
        </div>`;
      }
      if (spec.type === 'select') {
        return `<div class="rounded-lg border border-edge bg-surface px-3 py-2">
          <label for="${id}" class="mb-1 block text-xs font-medium text-content">${key}</label>
          <select id="${id}" data-arg="${key}"
                  class="w-full rounded-md border border-edge bg-surface px-2 py-1 text-xs text-content">
            ${spec.options.map((o) => `<option value="${o}" ${state.args[key] === o ? 'selected' : ''}>${o}</option>`).join('')}
          </select>
        </div>`;
      }
      return `<div class="rounded-lg border border-edge bg-surface px-3 py-2">
        <label for="${id}" class="mb-1 block text-xs font-medium text-content">${key}</label>
        <input id="${id}" type="text" data-arg="${key}" value="${escapeHtml(String(state.args[key] ?? ''))}"
               class="w-full rounded-md border border-edge bg-surface px-2 py-1 text-xs text-content" />
      </div>`;
    }).join('')}
  </div>`;
}

/* ============================================================
   rendering — code / api / tests
   ============================================================ */

/* Strip reference material from a snippet.
   A story's canvas often carries scaffolding that documents the component —
   a size matrix, a tone comparison — which belongs on screen but not in the
   code someone copies. Mark those blocks `data-doc` and they are removed here,
   so the Code tab shows the component and nothing else. */
function stripDocOnly(html) {
  if (!html.includes('data-doc')) return html;
  const host = document.createElement('div');
  host.innerHTML = html;
  host.querySelectorAll('[data-doc]').forEach((el) => el.remove());
  return host.innerHTML;
}

function renderCode(story) {
  const html = stripDocOnly(story.render(state.args));
  const source = {
    html: dedent(html),
    vue: toVue(html, story),
    react: `export function ${story.title.replace(/[^A-Za-z]/g, '')}() {\n  return (\n${toJsx(html).split('\n').map((l) => '    ' + l).join('\n')}\n  );\n}`,
  }[state.codeLang];

  const langBtn = (id, label) => `<button data-lang="${id}"
    class="rounded-md px-2.5 py-1 font-mono text-[11px] transition-colors ${
      state.codeLang === id ? 'bg-accent text-accent-fg' : 'text-content-muted hover:text-content'
    }">${label}</button>`;

  return `
    <div class="mb-3 flex items-center gap-2">
      <div class="flex gap-1 rounded-lg border border-edge bg-surface p-1">
        ${langBtn('html', 'HTML')}${langBtn('vue', 'Vue')}${langBtn('react', 'React')}
      </div>
      <button id="copyCode" class="ml-auto rounded-md border border-edge px-3 py-1.5 font-mono text-[11px] text-content-secondary hover:border-accent-border hover:text-accent">Copy</button>
    </div>
    <pre class="overflow-x-auto rounded-xl bg-surface-inverse p-4 text-[12px] leading-relaxed text-content-inverse"><code>${escapeHtml(source)}</code></pre>
    <div class="mt-4 rounded-xl border border-edge bg-surface p-4">
      <p class="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-content-muted">Integrate</p>
      <pre class="overflow-x-auto text-[12px] leading-relaxed text-content-secondary"><code>${escapeHtml(
        `<!-- 1. the compiled stylesheet carries tokens + components -->
<link rel="stylesheet" href="dist/haze.css" />

<!-- 2. dark mode is a class on <html> -->
<html class="dark"> … </html>

<!-- 3. drop the markup above straight in -->`)}</code></pre>
    </div>`;
}

function renderApi(story) {
  const rows = story.api || [];
  const notes = story.notes || [];
  return `
    ${rows.length ? `<div class="overflow-x-auto rounded-xl border border-edge">
      <table class="w-full text-left text-sm">
        <caption class="sr-only">${story.title} API</caption>
        <thead class="bg-surface-sunken">
          <tr>
            <th scope="col" class="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted">Name</th>
            <th scope="col" class="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted">Type</th>
            <th scope="col" class="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted">Default</th>
            <th scope="col" class="px-4 py-2 font-mono text-[10px] uppercase tracking-[0.12em] text-content-muted">Notes</th>
          </tr>
        </thead>
        <tbody>
          ${rows.map(([n, t, d, desc]) => `<tr class="border-t border-edge">
            <th scope="row" class="px-4 py-2.5 font-mono text-xs font-normal text-accent">${escapeHtml(n)}</th>
            <td class="px-4 py-2.5 font-mono text-xs text-content-secondary">${escapeHtml(t)}</td>
            <td class="px-4 py-2.5 font-mono text-xs text-content-muted">${escapeHtml(d)}</td>
            <td class="px-4 py-2.5 text-xs text-content-secondary">${escapeHtml(desc)}</td>
          </tr>`).join('')}
        </tbody>
      </table>
    </div>` : ''}
    ${notes.length ? `<div class="mt-4 space-y-2">
      ${notes.map((n) => `<div class="flex gap-3 rounded-lg border border-edge border-l-2 border-l-accent bg-surface p-3">
        <p class="text-xs leading-relaxed text-content-secondary">${escapeHtml(n)}</p>
      </div>`).join('')}
    </div>` : ''}`;
}

function playwrightSpec(story) {
  return `// tests/${story.id}.spec.js  —  npx playwright test
import { test, expect } from '@playwright/test';

const STORY = '#/story/${story.id}';

test.describe('${story.title}', () => {
  test('passes its built-in accessibility checks', async ({ page }) => {
    await page.goto('/index.html' + STORY);
    await page.getByRole('tab', { name: 'Tests' }).click();
    await page.getByRole('button', { name: 'Run all checks' }).click();
    // the runner writes a machine-readable summary
    await expect(page.getByTestId('test-summary')).toHaveAttribute('data-failed', '0');
  });

  test('renders in dark mode without contrast loss', async ({ page }) => {
    await page.goto('/index.html' + STORY);
    await page.getByRole('button', { name: /theme/i }).click();
    await page.getByRole('tab', { name: 'Tests' }).click();
    await page.getByRole('button', { name: 'Run all checks' }).click();
    await expect(page.getByTestId('test-summary')).toHaveAttribute('data-failed', '0');
  });
});`;
}

function vitestSpec(story) {
  const argKeys = Object.keys(story.args || {});
  return `// tests/${story.id}.unit.test.js  —  npx vitest
import { describe, it, expect, beforeEach } from 'vitest';
import { storyById, defaultArgs } from '../app/stories.js';

const story = storyById('${story.id}');

describe('${story.title}', () => {
  beforeEach(() => {
    document.body.innerHTML = story.render(defaultArgs(story));
  });

  it('renders markup', () => {
    expect(document.body.innerHTML.trim().length).toBeGreaterThan(0);
  });
${argKeys.length ? `
  it('reacts to every control', () => {
    for (const key of ${JSON.stringify(argKeys)}) {
      const spec = story.args[key];
      const next = spec.type === 'boolean' ? !spec.default
        : spec.type === 'select' ? spec.options.find((o) => o !== spec.default)
        : spec.default + ' changed';
      if (next === undefined) continue;
      const html = story.render({ ...defaultArgs(story), [key]: next });
      expect(html, key + ' had no effect on the output').not.toBe(
        story.render(defaultArgs(story))
      );
    }
  });` : ''}
});`;
}

function renderTests(story) {
  const checks = [...BASE_CHECKS, ...((story.tests && story.tests.checks) || [])];
  const list = state.results;
  const passed = list ? list.filter((r) => r.status === 'pass').length : 0;
  const failed = list ? list.filter((r) => r.status !== 'pass').length : 0;

  const badge = (status) => ({
    pass: '<span class="shrink-0 rounded-full bg-state-success/15 px-2 py-0.5 font-mono text-[10px] font-medium text-state-success">PASS</span>',
    fail: '<span class="shrink-0 rounded-full bg-state-danger/15 px-2 py-0.5 font-mono text-[10px] font-medium text-state-danger">FAIL</span>',
    error: '<span class="shrink-0 rounded-full bg-state-warning/15 px-2 py-0.5 font-mono text-[10px] font-medium text-state-warning">ERROR</span>',
  }[status]);

  return `
    <div class="mb-4 flex flex-wrap items-center gap-3">
      <button id="runTests" class="hz-btn hz-btn-primary hz-btn-m" ${state.running ? 'disabled' : ''}>
        ${state.running ? 'Running…' : 'Run all checks'}
      </button>
      <span id="testSummary" data-testid="test-summary" data-failed="${list ? failed : ''}"
            class="font-mono text-xs ${!list ? 'text-content-muted' : failed ? 'text-state-danger' : 'text-state-success'}">
        ${!list ? `${checks.length} checks ready` : `${passed} passed · ${failed} failed`}
      </span>
      <span class="ml-auto font-mono text-[11px] text-content-muted">runs against the live canvas, in the current theme</span>
    </div>

    ${list ? `<ul class="mb-6 space-y-2">
      ${list.map((r) => `<li class="rounded-lg border ${r.status === 'pass' ? 'border-edge' : 'border-state-danger/40'} bg-surface p-3">
        <div class="flex items-start gap-3">
          ${badge(r.status)}
          <div class="min-w-0 flex-1">
            <p class="text-xs font-medium text-content">${escapeHtml(r.name)}</p>
            ${r.wcag && r.wcag !== '—' ? `<p class="mt-0.5 font-mono text-[10px] text-content-muted">WCAG ${escapeHtml(r.wcag)}</p>` : ''}
            <p class="mt-1 text-xs ${r.status === 'pass' ? 'text-content-muted' : 'text-state-danger'}">${escapeHtml(r.detail || '')}</p>
          </div>
          <span class="shrink-0 font-mono text-[10px] text-content-muted">${r.ms.toFixed(1)}ms</span>
        </div>
      </li>`).join('')}
    </ul>` : `<ul class="mb-6 space-y-2">
      ${checks.map((c) => `<li class="flex items-start gap-3 rounded-lg border border-edge bg-surface p-3">
        <span class="shrink-0 rounded-full bg-surface-sunken px-2 py-0.5 font-mono text-[10px] text-content-muted">IDLE</span>
        <div class="min-w-0">
          <p class="text-xs font-medium text-content">${escapeHtml(c.name)}</p>
          ${c.wcag && c.wcag !== '—' ? `<p class="mt-0.5 font-mono text-[10px] text-content-muted">WCAG ${escapeHtml(c.wcag)}</p>` : ''}
        </div>
      </li>`).join('')}
    </ul>`}

    <div class="space-y-4">
      <section>
        <h3 class="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-content-muted">Manual QA checklist</h3>
        <ul class="space-y-1.5 rounded-xl border border-edge bg-surface p-4">
          ${((story.tests && story.tests.checklist) || []).map((c, i) => `<li class="flex items-start gap-2.5">
            <input type="checkbox" id="qa-${story.id}-${i}" class="mt-0.5 h-3.5 w-3.5 rounded-xs border-edge-strong accent-accent" />
            <label for="qa-${story.id}-${i}" class="text-xs leading-relaxed text-content-secondary">${escapeHtml(c)}</label>
          </li>`).join('')}
        </ul>
      </section>

      <section>
        <h3 class="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-content-muted">End-to-end · Playwright</h3>
        <pre class="overflow-x-auto rounded-xl bg-surface-inverse p-4 text-[12px] leading-relaxed text-content-inverse"><code>${escapeHtml(playwrightSpec(story))}</code></pre>
      </section>

      <section>
        <h3 class="mb-2 font-mono text-[11px] uppercase tracking-[0.12em] text-content-muted">Unit · Vitest</h3>
        <pre class="overflow-x-auto rounded-xl bg-surface-inverse p-4 text-[12px] leading-relaxed text-content-inverse"><code>${escapeHtml(vitestSpec(story))}</code></pre>
      </section>
    </div>`;
}

/* ============================================================
   main render
   ============================================================ */

function renderPanel(story) {
  const tab = (id, label) => `<button role="tab" data-tab="${id}" aria-selected="${state.tab === id}"
    class="border-b-2 px-4 py-2.5 text-xs font-medium transition-colors ${
      state.tab === id ? 'border-accent text-accent' : 'border-transparent text-content-muted hover:text-content'
    }">${label}</button>`;

  const body = {
    canvas: renderControls(story),
    code: renderCode(story),
    api: renderApi(story),
    tests: renderTests(story),
  }[state.tab];

  // Tablist pinned; only the body scrolls, and it fills the column rather than
  // being capped at a fraction of the viewport.
  return `
    <div role="tablist" aria-label="Component details" class="flex shrink-0 gap-1 border-b border-edge px-4">
      ${tab('canvas', 'Controls')}${tab('code', 'Code')}${tab('api', 'API')}${tab('tests', 'Tests')}
    </div>
    <div class="min-h-0 flex-1 overflow-y-auto p-4">${body}</div>`;
}

function render() {
  const story = storyById(state.storyId);
  if (!story) return;

  document.documentElement.classList.toggle('dark', state.theme === 'dark');
  renderSidebar($('#search').value);

  $('#storyTitle').textContent = story.title;
  $('#storyGroup').textContent = story.group;
  $('#storySummary').textContent = story.summary || '';
  document.title = `${story.title} · Haze Design System`;

  const vp = VIEWPORTS[state.viewport];
  const holder = $('#canvasHolder');
  holder.style.maxWidth = vp.w ? `${vp.w}px` : '100%';
  $('#vpLabel').textContent = vp.label;
  $('#themeLabel').textContent = state.theme === 'dark' ? 'Dark' : 'Light';

  $('#panel').innerHTML = renderPanel(story);
  if (frameReady) paintCanvas();
}

/* ============================================================
   events
   ============================================================ */

function setStory(id, { resetArgs = true } = {}) {
  const story = storyById(id);
  if (!story) return;
  state.storyId = id;
  if (resetArgs) state.args = defaultArgs(story);
  state.results = null;
  render();
}

function routeFromHash() {
  const m = location.hash.match(/#\/story\/([\w-]+)/);
  const id = (m && storyById(m[1])) ? m[1] : STORIES[0].id;
  setStory(id);
}

function wire() {
  $('#search').addEventListener('input', (e) => renderSidebar(e.target.value));

  $('#tree').addEventListener('click', (e) => {
    const a = e.target.closest('[data-nav]');
    if (a) setTimeout(() => renderSidebar($('#search').value), 0);
  });

  window.addEventListener('hashchange', routeFromHash);

  $('#themeToggle').addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark';
    writeStored('hz-theme', state.theme);
    state.results = null;
    render();
  });

  $('#vpSelect').addEventListener('change', (e) => {
    state.viewport = e.target.value;
    render();
  });

  // panel is re-rendered wholesale, so delegate everything from its container
  $('#panel').addEventListener('click', (e) => {
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn) {
      state.tab = tabBtn.dataset.tab;
      return render();
    }
    const langBtn = e.target.closest('[data-lang]');
    if (langBtn) {
      state.codeLang = langBtn.dataset.lang;
      return render();
    }
    if (e.target.closest('#copyCode')) return copyCode(e.target.closest('#copyCode'));
    if (e.target.closest('#runTests')) return runStoryTests();
  });

  $('#panel').addEventListener('input', (e) => {
    const el = e.target.closest('[data-arg]');
    if (!el) return;
    const key = el.dataset.arg;
    state.args[key] = el.type === 'checkbox' ? el.checked : el.value;
    state.results = null;
    paintCanvas();
    // only the code tab mirrors args; avoid re-rendering while typing in controls
    if (state.tab === 'code') $('#panel').querySelector('pre code').textContent = '';
  });

  $('#panel').addEventListener('change', (e) => {
    if (e.target.closest('[data-arg]') && e.target.tagName === 'SELECT') render();
  });

  document.addEventListener('keydown', (e) => {
    if (e.key === '/' && document.activeElement !== $('#search')) {
      e.preventDefault();
      $('#search').focus();
    }
  });
}

function copyCode(btn) {
  const code = $('#panel').querySelector('pre code');
  if (!code) return;
  const text = code.textContent;
  const done = (ok) => {
    btn.textContent = ok ? 'Copied' : 'Press ⌘C';
    setTimeout(() => { btn.textContent = 'Copy'; }, 1500);
  };
  const legacy = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.cssText = 'position:fixed;top:0;opacity:0';
    document.body.appendChild(ta);
    ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch { ok = false; }
    ta.remove();
    return ok;
  };
  if (navigator.clipboard && window.isSecureContext) {
    navigator.clipboard.writeText(text).then(() => done(true), () => done(legacy()));
  } else {
    done(legacy());
  }
}

function runStoryTests() {
  const story = storyById(state.storyId);
  const root = canvasRoot();
  if (!story || !root) return;
  state.running = true;
  render();
  // setTimeout, not requestAnimationFrame: rAF is throttled to zero in a
  // background or non-compositing tab, which would make the runner appear to
  // hang under CI and in hidden windows.
  setTimeout(() => {
    const checks = [...BASE_CHECKS, ...((story.tests && story.tests.checks) || [])];
    try {
      state.results = runChecks(checks, canvasRoot() || root);
    } finally {
      state.running = false;
      render();
    }
  }, 0);
}

/* ============================================================
   boot
   ============================================================ */

$('#canvasHolder').appendChild(buildFrame());
wire();
routeFromHash();

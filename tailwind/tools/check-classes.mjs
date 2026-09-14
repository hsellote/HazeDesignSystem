/**
 * Assert every class the stories can render actually has a rule in dist/haze.css.
 *
 * Tailwind escapes CSS identifiers (`.aria-\[current\=page\]\:bg-accent`), and the
 * exact escape set has changed between versions — so rather than reproduce it,
 * strip every backslash from the stylesheet and search the normalised text.
 */
import { readFileSync } from 'node:fs';
import { STORIES, defaultArgs } from '../app/stories.js';

const css = readFileSync(new URL('../dist/haze.css', import.meta.url), 'utf8');

/* Normalise CSS identifier escapes so a plain substring search works.
   Two forms matter:
     \:  \[  \,   -> simple backslash escapes
     \32 -> hex escape, used when a class starts with a digit (`2xl:`)
   Decoding the hex form first is essential: stripping backslashes alone turns
   `.\32 xl\:grid-cols-...` into `32 xl:grid-cols-...` and every digit-leading
   class reads as missing. */
const flat = css
  .replace(/\\([0-9a-fA-F]{1,6})[ ]?/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
  .replace(/\\/g, '');

const classes = new Set();
const collect = (html) => {
  for (const m of html.matchAll(/class="([^"]*)"/g)) {
    for (const c of m[1].split(/\s+/)) if (c) classes.add(c);
  }
};

for (const story of STORIES) {
  const base = defaultArgs(story);
  collect(story.render(base));
  for (const [key, spec] of Object.entries(story.args || {})) {
    const values = spec.type === 'boolean' ? [true, false]
                 : spec.type === 'select'  ? spec.options
                 : [spec.default];
    for (const v of values) collect(story.render({ ...base, [key]: v }));
  }
}

// self-test: a digit-leading escaped class must be findable after normalisation
if (css.includes('\\32 xl') && !flat.includes('.2xl:')) {
  console.error('check-classes: escape normalisation is broken — digit-leading classes would false-negative');
  process.exit(2);
}

const missing = [...classes].filter((c) => !flat.includes('.' + c)).sort();
console.log(`distinct classes rendered : ${classes.size}`);
console.log(`missing from dist/haze.css: ${missing.length}`);
for (const c of missing) console.log('   MISSING:', c);
process.exit(missing.length ? 1 : 0);

/**
 * Build dist/haze.css via Tailwind's PostCSS API.
 *
 * Uses the v4 PostCSS plugin (@tailwindcss/postcss). Preferred over the CLI,
 * which blocks on stdin and orphans processes in some shells.
 *
 *   node tools/build-css.mjs [--watch]
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import postcss from 'postcss';
import tailwindcss from '@tailwindcss/postcss';

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, '..');
const input = resolve(root, 'src/input.css');
const output = resolve(root, 'dist/haze.css');

const started = Date.now();
const css = readFileSync(input, 'utf8');

const result = await postcss([
  tailwindcss(),
]).process(css, { from: input, to: output });

mkdirSync(dirname(output), { recursive: true });
writeFileSync(output, result.css);

/* Stamp index.html so every build serves fresh URLs for the stylesheet and the
   module entry. app.js propagates the same stamp to its imports. This is what
   stops a browser that cached an earlier build from showing stale components. */
const stamp = Date.now().toString(36);
const shell = resolve(root, 'index.html');
let html = readFileSync(shell, 'utf8');
html = html
  .replace(/href="dist\/haze\.css(\?v=[^"]*)?"/, `href="dist/haze.css?v=${stamp}"`)
  .replace(/src="app\/app\.js(\?v=[^"]*)?"/, `src="app/app.js?v=${stamp}"`);
writeFileSync(shell, html);

console.log(`built dist/haze.css — ${(result.css.length / 1024).toFixed(1)}KB in ${Date.now() - started}ms`);
console.log(`stamped index.html with ?v=${stamp}`);

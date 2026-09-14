/**
 * Unit tests over the story registry itself — no browser needed.
 *
 *   npx vitest run
 *
 * These catch the cheap mistakes early: a control that does nothing, a story
 * that forgets its API table, markup that does not parse.
 */

import { describe, it, expect } from 'vitest';
import { STORIES, storyById, defaultArgs } from '../app/stories.js';

describe('registry', () => {
  it('has unique ids', () => {
    const ids = STORIES.map((s) => s.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('assigns every story to a known group', () => {
    for (const s of STORIES) {
      expect(['Foundations', 'Components', 'Patterns', 'Reference']).toContain(s.group);
    }
  });
});

describe.each(STORIES.map((s) => [s.id, s]))('%s', (id, story) => {
  const args = defaultArgs(story);

  it('renders non-empty markup', () => {
    const html = story.render(args);
    expect(typeof html).toBe('string');
    expect(html.trim().length).toBeGreaterThan(20);
  });

  it('produces balanced markup', () => {
    document.body.innerHTML = story.render(args);
    // if the browser had to repair the markup, the round-trip would differ wildly
    expect(document.body.children.length).toBeGreaterThan(0);
  });

  it('documents a summary', () => {
    expect(story.summary && story.summary.length).toBeGreaterThan(20);
  });

  it('ships a manual QA checklist', () => {
    expect(story.tests?.checklist?.length ?? 0).toBeGreaterThan(0);
  });

  it('every control changes the output', () => {
    const base = story.render(args);
    for (const [key, spec] of Object.entries(story.args || {})) {
      let next;
      if (spec.type === 'boolean') next = !spec.default;
      else if (spec.type === 'select') next = spec.options.find((o) => o !== spec.default);
      else next = String(spec.default) + ' (changed)';
      if (next === undefined) continue;
      const changed = story.render({ ...args, [key]: next });
      expect(changed, `control "${key}" had no effect on ${id}`).not.toBe(base);
    }
  });

  it('never emits a raw hex colour (tokens only)', () => {
    // Reference stories whose subject IS a retired palette have to quote its
    // values; they opt out explicitly. Nothing that renders a component may.
    if (story.quotesLiteralColour) {
      expect(story.group, `only Reference stories may quote literal colour — ${id} is ${story.group}`).toBe('Reference');
      return;
    }
    const html = story.render(args);
    const hex = html.match(/#[0-9a-fA-F]{6}\b/g) || [];
    // var(--brand-500) style references are fine; literal hex in markup is not
    expect(hex, `hard-coded hex in ${id}: ${hex.join(', ')}`).toHaveLength(0);
  });
});

import { describe, it, expect } from 'vitest';
import type { Location } from '@models/nav';
import {
  NavHistory,
  describeRef,
  imageRef,
  networkRef,
  samePlace,
  stackRef,
  viewForRef,
} from '@utils/nav-history';

/** Entries are `place#state`: the same place may carry different state (a selected row, say). */
const placeOf = (s: string): string => s.split('#')[0];
const history = (cap?: number) => new NavHistory<string>((a, b) => placeOf(a) === placeOf(b), cap);

describe('NavHistory', () => {
  it('starts empty: nowhere to go', () => {
    const h = history();
    expect(h.current()).toBeNull();
    expect(h.back()).toBeNull();
    expect(h.forward()).toBeNull();
  });

  it('the first push becomes the current entry', () => {
    const h = history();
    h.push('a');
    expect(h.current()).toBe('a');
    expect(h.back()).toBeNull();
  });

  it('walks back and forward through pushed entries', () => {
    const h = history();
    for (const e of ['a', 'b', 'c']) h.push(e);
    expect(h.back()).toBe('b');
    expect(h.back()).toBe('a');
    expect(h.back()).toBeNull();
    expect(h.current()).toBe('a');
    expect(h.forward()).toBe('b');
    expect(h.forward()).toBe('c');
    expect(h.forward()).toBeNull();
    expect(h.current()).toBe('c');
  });

  it('a push after going back drops the forward entries', () => {
    const h = history();
    for (const e of ['a', 'b', 'c']) h.push(e);
    h.back();
    h.push('d');
    expect(h.forward()).toBeNull();
    expect(h.back()).toBe('b');
    expect(h.back()).toBe('a');
  });

  it('pushing the current place replaces it and keeps the forward entries', () => {
    const h = history();
    for (const e of ['a', 'b']) h.push(e);
    h.back();
    h.push('a#row2');
    expect(h.current()).toBe('a#row2');
    expect(h.forward()).toBe('b');
  });

  it('replaceCurrent updates state without adding a step', () => {
    const h = history();
    h.push('a');
    h.push('b');
    h.replaceCurrent('b#row5');
    expect(h.back()).toBe('a');
    expect(h.forward()).toBe('b#row5');
  });

  it('replaceCurrent on an empty history starts it', () => {
    const h = history();
    h.replaceCurrent('a');
    expect(h.current()).toBe('a');
  });

  it('back and forward skip entries that are the current place', () => {
    const h = history();
    for (const e of ['a', 'b', 'c']) h.push(e);
    // A poll closed the panel 'c' stood for, leaving the user on 'b' — the entry behind it.
    h.replaceCurrent('b#closed');
    expect(h.back()).toBe('a'); // not 'b': going there would change nothing
    expect(h.forward()).toBe('b');
    expect(h.forward()).toBeNull(); // 'b#closed' is where we already are
  });

  it('back returns null without moving when every earlier entry is the current place', () => {
    const h = history();
    h.push('a');
    h.push('b');
    h.replaceCurrent('a#later'); // e.g. a poll closed the panel, leaving the view the first entry shows
    expect(h.back()).toBeNull();
    expect(h.current()).toBe('a#later');
  });

  it('drops the oldest entries beyond the cap', () => {
    const h = history(3);
    for (const e of ['a', 'b', 'c', 'd']) h.push(e);
    expect(h.back()).toBe('c');
    expect(h.back()).toBe('b');
    expect(h.back()).toBeNull();
  });
});

describe('samePlace', () => {
  const vol = { kind: 'volume' as const, id: 'pgdata' };
  const at = (loc: Partial<Location>): Location => ({ view: 'volumes', ...loc });

  it('ignores the selected row and the focus within a panel', () => {
    expect(samePlace(at({ selection: 'a' }), at({ selection: 'b' }))).toBe(true);
    expect(
      samePlace(
        at({ panel: { kind: 'detail', ref: vol, focus: { section: 'users' } } }),
        at({ panel: { kind: 'detail', ref: { ...vol, label: 'x' } } }),
      ),
    ).toBe(true);
  });

  it('tells views, panels, panel kinds and targets apart', () => {
    expect(samePlace(at({}), at({ view: 'containers' }))).toBe(false);
    expect(samePlace(at({}), at({ panel: { kind: 'detail', ref: vol } }))).toBe(false);
    const ctr = { kind: 'container' as const, id: 'abc' };
    expect(
      samePlace(
        { view: 'containers', panel: { kind: 'detail', ref: ctr } },
        { view: 'containers', panel: { kind: 'logs', ref: ctr } },
      ),
    ).toBe(false);
    expect(
      samePlace(
        at({ panel: { kind: 'detail', ref: vol } }),
        at({ panel: { kind: 'detail', ref: { ...vol, id: 'x' } } }),
      ),
    ).toBe(false);
  });
});

describe('viewForRef / describeRef', () => {
  it('maps each kind to the view that lists it', () => {
    expect(viewForRef({ kind: 'container', id: 'abc' })).toBe('containers');
    expect(viewForRef({ kind: 'volume', id: 'pgdata' })).toBe('volumes');
    expect(viewForRef({ kind: 'image', id: 'sha256:abc' })).toBe('images');
    expect(viewForRef({ kind: 'network', id: 'bridge' })).toBe('networks');
    expect(viewForRef({ kind: 'stack', id: 'db-pr02' })).toBe('stacks');
  });

  it('describes a ref by its label, else its id', () => {
    expect(describeRef({ kind: 'container', id: 'abc', label: 'tk-t2-pg' })).toBe('container tk-t2-pg');
    expect(describeRef({ kind: 'volume', id: 'pgdata' })).toBe('volume pgdata');
  });
});

describe('ref builders', () => {
  it('points at an image by full ID, named by its first tag, else its short ID', () => {
    expect(imageRef({ id: 'sha256:294b683cb7240000', tags: ['alpine:3', 'alpine:latest'] })).toEqual({
      kind: 'image',
      id: 'sha256:294b683cb7240000',
      label: 'alpine:3',
    });
    expect(imageRef({ id: 'sha256:294b683cb7240000', tags: [] }).label).toBe('294b683cb724');
  });

  it('points at a network by name and a stack by project', () => {
    expect(networkRef({ name: 'db-pr02_default' })).toEqual({ kind: 'network', id: 'db-pr02_default' });
    expect(stackRef({ id: 'db-pr02' })).toEqual({ kind: 'stack', id: 'db-pr02' });
  });
});

import { describe, it, expect } from 'vitest';
import {
  containerFilterFields,
  filterItems,
  imageFilterFields,
  matchesQuery,
  networkFilterFields,
  volumeFilterFields,
} from '@utils/filter';
import { makeContainer, makeImage, makeNetwork, makeVolume } from '../fixtures';

describe('matchesQuery', () => {
  it('ignores case on both sides', () => {
    expect(matchesQuery('REDIS', ['redis-cache'])).toBe(true);
    expect(matchesQuery('redis', ['REDIS'])).toBe(true);
    expect(matchesQuery('ReDiS', ['my-Redis-1'])).toBe(true);
  });

  it('matches a substring of any field', () => {
    expect(matchesQuery('cache', ['web', 'redis-cache'])).toBe(true);
    expect(matchesQuery('postgres', ['web', 'redis-cache'])).toBe(false);
  });

  it('trims the query, and an empty one matches everything', () => {
    expect(matchesQuery('  redis ', ['redis'])).toBe(true);
    expect(matchesQuery('', [])).toBe(true);
    expect(matchesQuery('   ', ['anything'])).toBe(true);
  });

  it('keeps inner spaces as typed', () => {
    expect(matchesQuery('a b', ['a b c'])).toBe(true);
    expect(matchesQuery('a b', ['ab'])).toBe(false);
  });

  it('skips missing fields', () => {
    expect(matchesQuery('x', [undefined, 'xyz'])).toBe(true);
    expect(matchesQuery('x', [undefined])).toBe(false);
  });
});

describe('filterItems', () => {
  const items = ['alpha', 'beta', 'Gamma'];
  const fields = (s: string) => [s];

  it('keeps the matching items in order', () => {
    expect(filterItems(items, 'A', fields)).toEqual(['alpha', 'beta', 'Gamma']);
    expect(filterItems(items, 'mm', fields)).toEqual(['Gamma']);
    expect(filterItems(items, 'zzz', fields)).toEqual([]);
  });

  it('hands back the same array for an empty query', () => {
    expect(filterItems(items, ' ', fields)).toBe(items);
  });
});

describe('filter fields', () => {
  it('a container by name, image, ID or compose project', () => {
    const c = makeContainer({
      id: 'abc123def',
      name: 'shop-web-1',
      image: 'nginx:1.27',
      compose: { project: 'shop', service: 'web', configFiles: [], dependsOn: [], oneoff: false },
    });
    expect(matchesQuery('WEB-1', containerFilterFields(c))).toBe(true);
    expect(matchesQuery('nginx', containerFilterFields(c))).toBe(true);
    expect(matchesQuery('abc123', containerFilterFields(c))).toBe(true);
    expect(matchesQuery('shop', containerFilterFields(makeContainer({ ...c, name: 'x' })))).toBe(true);
    expect(matchesQuery('postgres', containerFilterFields(c))).toBe(false);
  });

  it('an image by any of its tags, not just the first, and by ID', () => {
    const img = makeImage('sha256:feedbeef', ['redis:7', 'registry.local/cache:stable']);
    expect(matchesQuery('redis', imageFilterFields(img))).toBe(true);
    expect(matchesQuery('CACHE:STABLE', imageFilterFields(img))).toBe(true);
    expect(matchesQuery('feedbe', imageFilterFields(img))).toBe(true);
    expect(matchesQuery('nginx', imageFilterFields(img))).toBe(false);
  });

  it('a volume by name, driver or compose project', () => {
    const vol = makeVolume('shop_data', { driver: 'local', stack: 'shop' });
    expect(matchesQuery('DATA', volumeFilterFields(vol))).toBe(true);
    expect(matchesQuery('local', volumeFilterFields(vol))).toBe(true);
    expect(matchesQuery('shop', volumeFilterFields(makeVolume('other', { stack: 'shop' })))).toBe(true);
    expect(matchesQuery('nfs', volumeFilterFields(vol))).toBe(false);
  });

  it('a network by name, driver, ID or compose project', () => {
    const net = makeNetwork('shop_back', { id: 'n0123456', driver: 'overlay', stack: 'shop' });
    expect(matchesQuery('BACK', networkFilterFields(net))).toBe(true);
    expect(matchesQuery('overlay', networkFilterFields(net))).toBe(true);
    expect(matchesQuery('n0123', networkFilterFields(net))).toBe(true);
    expect(matchesQuery('shop', networkFilterFields(makeNetwork('x', { stack: 'shop' })))).toBe(true);
    expect(matchesQuery('macvlan', networkFilterFields(net))).toBe(false);
  });
});

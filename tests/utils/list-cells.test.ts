import { describe, it, expect } from 'vitest';
import type { ContainerUser } from '@models/docker';
import { t } from '@theme';
import { stripTags } from '@utils/format';
import { formatFirst, formatUsedBy } from '@utils/list-cells';

const plain = (s: string): string => stripTags(s);

describe('formatUsedBy', () => {
  const user = (name: string, id = `${name}-id`): ContainerUser => ({
    id,
    name,
    status: 'running',
    exitCode: 0,
  });

  it('shows a dash when nothing uses it', () => {
    expect(plain(formatUsedBy([], 20))).toBe('—');
  });

  it('shows the first user with its status dot', () => {
    expect(plain(formatUsedBy([user('db-pr02')], 20))).toBe('● db-pr02');
  });

  it('counts the other containers, not their rows (a container mounting a volume twice)', () => {
    const users = [user('web'), user('web'), user('worker'), user('cron')];
    expect(plain(formatUsedBy(users, 30))).toBe('● web +2');
  });

  it('fits the name so the cell stays within width - 1', () => {
    const cell = plain(formatUsedBy([user('a-very-long-container-name'), user('b')], 14));
    expect(cell).toBe('● a-very-… +1');
    expect(cell.length).toBeLessThanOrEqual(13);
  });
});

describe('formatFirst', () => {
  it('shows a dash for an empty list', () => {
    expect(plain(formatFirst([], 20, t.cyan))).toBe('—');
  });

  it('shows the only item as is', () => {
    expect(plain(formatFirst(['db-pr02_default'], 20, t.cyan))).toBe('db-pr02_default');
  });

  it('counts the rest after the first', () => {
    expect(plain(formatFirst(['a', 'b', 'c'], 20, t.cyan))).toBe('a +2');
  });

  it('cuts the first item, never the count, to stay within width - 1', () => {
    const cell = plain(formatFirst(['0.0.0.0:5432->5432/tcp', '8080/tcp'], 14, t.pink));
    expect(cell).toBe('0.0.0.0:5… +1');
    expect(cell.length).toBeLessThanOrEqual(13);
  });

  it('escapes markup in the item', () => {
    const cell = formatFirst(['{bold}x'], 20, t.cyan);
    expect(cell).not.toContain('{bold}');
  });
});

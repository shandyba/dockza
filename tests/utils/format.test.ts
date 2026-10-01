import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  humanUptime,
  humanSizeMB,
  truncate,
  truncateMiddle,
  padEnd,
  relativeTime,
  stripTags,
  visualLength,
  escapeTags,
  displaySafe,
  oneLine,
  textWidth,
  fitWidth,
  wrapLine,
  type CharWidth,
} from '@utils/format';

describe('humanUptime', () => {
  const NOW = new Date('2026-05-14T12:00:00Z').getTime();

  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(NOW);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('renders seconds for sub-minute uptimes', () => {
    expect(humanUptime(new Date(NOW - 23_000))).toBe('23s');
  });

  it('renders minutes + seconds for sub-hour uptimes', () => {
    expect(humanUptime(new Date(NOW - (5 * 60 + 12) * 1000))).toBe('5m 12s');
  });

  it('renders hours + minutes for sub-day uptimes', () => {
    expect(humanUptime(new Date(NOW - (3 * 3600 + 7 * 60) * 1000))).toBe('3h 7m');
  });

  it('renders days + hours for >24h uptimes', () => {
    expect(humanUptime(new Date(NOW - (2 * 86400 + 5 * 3600) * 1000))).toBe('2d 5h');
  });

  it('clamps negative durations to 0s', () => {
    expect(humanUptime(new Date(NOW + 5000))).toBe('0s');
  });
});

describe('humanSizeMB', () => {
  it('renders MiB for sub-GiB values', () => {
    expect(humanSizeMB(512)).toBe('512 MiB');
  });

  it('rounds MiB values', () => {
    expect(humanSizeMB(123.4)).toBe('123 MiB');
    expect(humanSizeMB(123.6)).toBe('124 MiB');
  });

  it('renders GiB for values >= 1024', () => {
    expect(humanSizeMB(1024)).toBe('1.0 GiB');
    expect(humanSizeMB(2048)).toBe('2.0 GiB');
    expect(humanSizeMB(3584)).toBe('3.5 GiB');
  });

  it('renders 0 cleanly', () => {
    expect(humanSizeMB(0)).toBe('0 MiB');
  });
});

describe('truncate', () => {
  it('returns the string unchanged when shorter than the limit', () => {
    expect(truncate('hi', 10)).toBe('hi');
  });

  it('returns the string unchanged when exactly at the limit', () => {
    expect(truncate('exact', 5)).toBe('exact');
  });

  it('truncates with ellipsis when longer than the limit', () => {
    expect(truncate('hello world', 8)).toBe('hello w…');
  });

  it('handles a limit of 1 (single ellipsis)', () => {
    expect(truncate('abc', 1)).toBe('…');
  });
});

describe('padEnd', () => {
  it('pads a plain string with spaces', () => {
    expect(padEnd('hi', 5)).toBe('hi   ');
  });

  it('returns the string unchanged when already at length', () => {
    expect(padEnd('hello', 5)).toBe('hello');
  });

  it('returns the string unchanged when longer than target', () => {
    expect(padEnd('toolong', 3)).toBe('toolong');
  });

  it('measures string length after stripping blessed color tags', () => {
    expect(padEnd('{red-fg}hi{/}', 5)).toBe('{red-fg}hi{/}   ');
  });
});

describe('relativeTime', () => {
  it('returns a dayjs-style relative string', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-05-14T12:00:00Z'));
    const oneHourAgo = new Date('2026-05-14T11:00:00Z');
    expect(relativeTime(oneHourAgo)).toMatch(/hour|ago/);
    vi.useRealTimers();
  });
});

describe('truncateMiddle', () => {
  it('returns the string unchanged when within the limit', () => {
    expect(truncateMiddle('hello', 10)).toBe('hello');
    expect(truncateMiddle('exact', 5)).toBe('exact');
  });

  it('keeps head and tail and inserts an ellipsis in the middle', () => {
    expect(truncateMiddle('unix:///var/run/docker.sock', 16)).toBe('unix:///…er.sock');
  });

  it('handles very short limits gracefully', () => {
    expect(truncateMiddle('abcdef', 1)).toBe('…');
    expect(truncateMiddle('abcdef', 0)).toBe('');
  });

  it('respects a custom ellipsis', () => {
    expect(truncateMiddle('abcdefghij', 7, '...')).toBe('ab...ij');
  });
});

describe('stripTags / visualLength', () => {
  it('strips blessed colour tags', () => {
    expect(stripTags('{#5eead4-fg}hello{/}')).toBe('hello');
  });

  it('measures the visible length after stripping tags', () => {
    expect(visualLength('{#fff-fg}abc{/}')).toBe(3);
    expect(visualLength('plain')).toBe(5);
  });
});

describe('escapeTags', () => {
  it('turns braces into blessed escape tags', () => {
    expect(escapeTags('{bold}x{/}')).toBe('{open}bold{close}x{open}/{close}');
  });

  it('leaves text without braces alone', () => {
    expect(escapeTags('PATH=/usr/bin')).toBe('PATH=/usr/bin');
  });
});

/** Treats CJK ideographs as two columns, like blessed under `fullUnicode`. */
const wide: CharWidth = (cp) => (cp >= 0x4e00 && cp <= 0x9fff ? 2 : 1);

describe('displaySafe', () => {
  it('shows C0 control characters in caret notation', () => {
    expect(displaySafe('a\x1b[31mb')).toBe('a^[[31mb');
    expect(displaySafe('tab\there')).toBe('tab^Ihere');
    expect(displaySafe('cr\r')).toBe('cr^M');
    expect(displaySafe('\x00')).toBe('^@');
  });

  it('shows DEL and C1 controls', () => {
    expect(displaySafe('\x7f')).toBe('^?');
    expect(displaySafe('\x9b')).toBe('\\x9b');
  });

  it('keeps newlines and printable text, including non-ASCII', () => {
    expect(displaySafe('a\nb')).toBe('a\nb');
    expect(displaySafe('Київ 東京 🚀')).toBe('Київ 東京 🚀');
  });
});

describe('oneLine', () => {
  it('replaces newlines with ⏎ after making control characters visible', () => {
    expect(oneLine('a\nb\x1bc')).toBe('a⏎b^[c');
  });
});

describe('textWidth / fitWidth', () => {
  it('measures code points, not UTF-16 units, by default', () => {
    expect(textWidth('🚀🚀')).toBe(2);
  });

  it('counts wide glyphs with an injected width function', () => {
    expect(textWidth('東京x', wide)).toBe(5);
  });

  it('leaves text that fits untouched', () => {
    expect(fitWidth('abc', 3)).toEqual({ text: 'abc', truncated: false });
  });

  it('cuts with an ellipsis so the result fits exactly', () => {
    expect(fitWidth('abcdef', 4)).toEqual({ text: 'abc…', truncated: true });
  });

  it('never lets a wide glyph push the result past the width', () => {
    const r = fitWidth('東京東京', 4, wide);
    expect(r.text).toBe('東…');
    expect(textWidth(r.text, wide)).toBeLessThanOrEqual(4);
  });

  it('does not split surrogate pairs', () => {
    expect(fitWidth('🚀🚀🚀', 2).text).toBe('🚀…');
  });
});

describe('wrapLine', () => {
  it('returns a single empty piece for empty input', () => {
    expect(wrapLine('', 10)).toEqual(['']);
  });

  it('splits at exactly the width', () => {
    expect(wrapLine('abcdef', 3)).toEqual(['abc', 'def']);
    expect(wrapLine('abcdefg', 3)).toEqual(['abc', 'def', 'g']);
  });

  it('uses firstWidth for the first piece only', () => {
    expect(wrapLine('abcdefgh', 3, undefined, 5)).toEqual(['abcde', 'fgh']);
  });

  it('treats a width below 1 as 1', () => {
    expect(wrapLine('ab', 0)).toEqual(['a', 'b']);
  });

  it('keeps surrogate pairs whole', () => {
    expect(wrapLine('🚀🚀🚀', 2)).toEqual(['🚀🚀', '🚀']);
  });

  it('moves a wide glyph to the next piece instead of overflowing', () => {
    const pieces = wrapLine('a東京', 2, wide);
    expect(pieces).toEqual(['a', '東', '京']);
    for (const p of pieces) expect(textWidth(p, wide)).toBeLessThanOrEqual(2);
  });

  it('wraps a maximum-length (128 KiB) value without losing or overflowing anything', () => {
    const value = 'x'.repeat(131072);
    const pieces = wrapLine(value, 77);
    expect(pieces.join('')).toBe(value);
    expect(pieces.every((p) => p.length <= 77)).toBe(true);
    expect(pieces).toHaveLength(Math.ceil(131072 / 77));
  });
});

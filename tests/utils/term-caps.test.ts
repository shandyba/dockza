import { describe, it, expect } from 'vitest';
import { detectColors } from '@utils/term-caps';

describe('detectColors', () => {
  it('returns truecolor when COLORTERM=truecolor', () => {
    expect(detectColors({ COLORTERM: 'truecolor', TERM: 'xterm' })).toBe('truecolor');
  });

  it('returns truecolor when COLORTERM=24bit', () => {
    expect(detectColors({ COLORTERM: '24bit', TERM: 'xterm' })).toBe('truecolor');
  });

  it('returns truecolor when TERM contains truecolor', () => {
    expect(detectColors({ TERM: 'xterm-truecolor' })).toBe('truecolor');
  });

  it('returns 256 when TERM contains 256color', () => {
    expect(detectColors({ TERM: 'xterm-256color' })).toBe('256');
  });

  it('treats xterm-kitty as 256-color capable', () => {
    expect(detectColors({ TERM: 'xterm-kitty' })).toBe('256');
  });

  it('returns low when neither hint is present', () => {
    expect(detectColors({ TERM: 'vt100' })).toBe('low');
    expect(detectColors({})).toBe('low');
  });
});

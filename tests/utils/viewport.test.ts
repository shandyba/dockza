import { describe, it, expect } from 'vitest';
import { revealRange } from '@utils/viewport';

describe('revealRange', () => {
  it('does not move when the range is already visible', () => {
    expect(revealRange(10, 20, 12, 15)).toBe(10);
    expect(revealRange(10, 20, 10, 29)).toBe(10);
  });

  it('scrolls up to a range above the window', () => {
    expect(revealRange(10, 20, 4, 6)).toBe(4);
  });

  it('scrolls down just far enough for a range below the window', () => {
    expect(revealRange(10, 20, 30, 32)).toBe(13);
  });

  it('aligns a block taller than the window to its first row', () => {
    expect(revealRange(0, 20, 50, 200)).toBe(50);
    expect(revealRange(100, 20, 50, 200)).toBe(50);
  });

  it('never returns a negative offset and tolerates a zero-height window', () => {
    expect(revealRange(0, 0, 0, 0)).toBe(0);
    expect(revealRange(5, 0, 3, 3)).toBe(3);
  });
});

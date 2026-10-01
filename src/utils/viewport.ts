/**
 * Scroll offset that brings rows `start..end` into a `viewport`-row window currently at `top`,
 * moving as little as possible. A block taller than the window is aligned to its first row.
 */
export function revealRange(top: number, viewport: number, start: number, end: number): number {
  const rows = Math.max(1, viewport);
  let next = top;
  if (end - start + 1 >= rows || start < top) next = start;
  else if (end >= top + rows) next = end - rows + 1;
  return Math.max(0, next);
}

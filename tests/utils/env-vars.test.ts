import { describe, it, expect } from 'vitest';
import { formatEnvAll, parseEnv } from '@utils/env-vars';

describe('parseEnv', () => {
  it('splits at the first =', () => {
    expect(parseEnv(['TZ=Europe/Kyiv'])).toEqual([
      { name: 'TZ', value: 'Europe/Kyiv', raw: 'TZ=Europe/Kyiv', hasValue: true },
    ]);
  });

  it('keeps later = signs in the value', () => {
    expect(parseEnv(['OPTS=a=1,b=2'])[0]).toMatchObject({ name: 'OPTS', value: 'a=1,b=2' });
  });

  it('distinguishes an empty value from no value at all', () => {
    expect(parseEnv(['EMPTY='])[0]).toMatchObject({ name: 'EMPTY', value: '', hasValue: true });
    expect(parseEnv(['BARE'])[0]).toMatchObject({ name: 'BARE', value: '', hasValue: false, raw: 'BARE' });
  });

  it('keeps multi-line values intact', () => {
    expect(parseEnv(['CERT=line1\nline2'])[0].value).toBe('line1\nline2');
  });

  it('preserves docker order', () => {
    expect(parseEnv(['B=2', 'A=1', 'C=3']).map((v) => v.name)).toEqual(['B', 'A', 'C']);
  });
});

describe('formatEnvAll', () => {
  it('joins entries as NAME=value lines without a trailing newline', () => {
    expect(formatEnvAll(parseEnv(['A=1', 'B=two words', 'BARE']))).toBe('A=1\nB=two words\nBARE');
  });

  it('is empty for no variables', () => {
    expect(formatEnvAll([])).toBe('');
  });
});

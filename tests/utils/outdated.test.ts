import { describe, it, expect } from 'vitest';
import { markOutdated, normalizeImageName } from '@utils/outdated';
import { makeContainer, makeImage } from '../fixtures';

describe('normalizeImageName', () => {
  it("drops Docker Hub's registry and library prefixes", () => {
    expect(normalizeImageName('docker.io/library/postgres:18')).toBe('postgres:18');
    expect(normalizeImageName('docker.io/axllent/mailpit:v1.31.3')).toBe('axllent/mailpit:v1.31.3');
    expect(normalizeImageName('library/postgres:18')).toBe('postgres:18');
    expect(normalizeImageName('postgres:18')).toBe('postgres:18');
  });

  it('makes an implicit latest explicit', () => {
    expect(normalizeImageName('postgres')).toBe('postgres:latest');
    expect(normalizeImageName('docker.io/library/alpine')).toBe('alpine:latest');
  });

  it("keeps a registry's port apart from the tag", () => {
    expect(normalizeImageName('localhost:5000/team/app')).toBe('localhost:5000/team/app:latest');
    expect(normalizeImageName('localhost:5000/team/app:dev')).toBe('localhost:5000/team/app:dev');
    expect(normalizeImageName('registry.example.com/library/x:1')).toBe('registry.example.com/library/x:1');
  });

  it('is null for a digest reference or an image ID: those never move', () => {
    expect(normalizeImageName('postgres@sha256:4ef4dbc939d6')).toBeNull();
    expect(normalizeImageName('postgres:18@sha256:4ef4dbc939d6')).toBeNull();
    expect(normalizeImageName('sha256:4ef4dbc939d61f00')).toBeNull();
    expect(normalizeImageName('')).toBeNull();
  });
});

describe('markOutdated', () => {
  const current = makeImage('sha256:new', ['postgres:18', 'postgres:latest']);
  const old = makeImage('sha256:old', []);

  it('marks a container whose tag now names a newer image', () => {
    const [c] = markOutdated(
      [makeContainer({ imageName: 'docker.io/library/postgres:18', imageId: 'sha256:old' })],
      [current, old],
    );
    expect(c.outdated).toEqual({ tag: 'postgres:18', currentImageId: 'sha256:new' });
  });

  it('follows an implicit latest', () => {
    const [c] = markOutdated([makeContainer({ imageName: 'postgres', imageId: 'sha256:old' })], [current]);
    expect(c.outdated).toEqual({ tag: 'postgres:latest', currentImageId: 'sha256:new' });
  });

  it('leaves a container on the current image, a pinned digest, or a tag nothing carries alone', () => {
    const containers = [
      makeContainer({ id: 'a', imageName: 'postgres:18', imageId: 'sha256:new' }),
      makeContainer({ id: 'b', imageName: 'postgres@sha256:abc', imageId: 'sha256:old' }),
      makeContainer({ id: 'c', imageName: 'postgres:17', imageId: 'sha256:old' }),
    ];
    for (const c of markOutdated(containers, [current, old])) expect(c.outdated).toBeUndefined();
  });

  it('clears a mark that no longer holds, without touching the containers it was given', () => {
    const marked = makeContainer({
      imageName: 'postgres:18',
      imageId: 'sha256:new',
      outdated: { tag: 'postgres:18', currentImageId: 'sha256:newer' },
    });
    const [c] = markOutdated([marked], [current]);
    expect(c.outdated).toBeUndefined();
    expect(marked.outdated).toBeDefined();
  });
});

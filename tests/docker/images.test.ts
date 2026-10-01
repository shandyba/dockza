import { describe, it, expect } from 'vitest';
import type Dockerode from 'dockerode';
import { toImageInfo, toImageInspect } from '@docker/images';

function rawImage(overrides: Partial<Dockerode.ImageInfo> = {}): Dockerode.ImageInfo {
  return {
    Id: 'sha256:294b683cb724',
    ParentId: '',
    RepoTags: ['alpine:3', 'alpine:latest'],
    Created: 1_700_000_000,
    Size: 8 * 1024 * 1024,
    VirtualSize: 0,
    SharedSize: 0,
    Labels: {},
    Containers: -1,
    ...overrides,
  } as Dockerode.ImageInfo;
}

describe('toImageInfo', () => {
  it('keeps every tag, and splits the first into repository and tag', () => {
    const info = toImageInfo(rawImage());
    expect(info.tags).toEqual(['alpine:3', 'alpine:latest']);
    expect(info.repository).toBe('alpine');
    expect(info.tag).toBe('3');
  });

  it('splits at the last colon, so a registry port stays in the repository', () => {
    const info = toImageInfo(rawImage({ RepoTags: ['localhost:5000/team/app:dev'] }));
    expect(info.repository).toBe('localhost:5000/team/app');
    expect(info.tag).toBe('dev');
  });

  it('splits a digest reference (the containerd store lists one as a tag) at the @', () => {
    const info = toImageInfo(rawImage({ RepoTags: ['julianb90/tachometer@sha256:311aac5bed5b'] }));
    expect(info.repository).toBe('julianb90/tachometer');
    expect(info.tag).toBe('sha256:311aac5bed5b');
  });

  it('reads a dangling image as untagged', () => {
    for (const RepoTags of [[], undefined, ['<none>:<none>']]) {
      const info = toImageInfo(rawImage({ RepoTags }));
      expect(info.tags).toEqual([]);
      expect(info.repository).toBe('<none>');
      expect(info.tag).toBe('<none>');
    }
  });

  it('converts size and created', () => {
    const info = toImageInfo(rawImage());
    expect(info.sizeMB).toBe(8);
    expect(info.created.getTime()).toBe(1_700_000_000_000);
  });

  it('starts with no users: App joins them in from the container listing', () => {
    const info = toImageInfo(rawImage({ Containers: 2 }));
    expect(info.users).toEqual([]);
    expect(info.inUse).toBe(false);
    expect(info.supersededBy).toEqual([]);
  });
});

describe('toImageInspect', () => {
  it("lists the paths the image's VOLUME instructions declare", () => {
    const raw = { Config: { Volumes: { '/var/lib/postgresql': {}, '/data': {} } } } as any;
    expect(toImageInspect(raw)).toEqual({ volumes: ['/data', '/var/lib/postgresql'] });
  });

  it('declares none when Config.Volumes is null', () => {
    expect(toImageInspect({ Config: { Volumes: null } } as any)).toEqual({ volumes: [] });
  });
});

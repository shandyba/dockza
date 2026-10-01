import { describe, it, expect } from 'vitest';
import type { MountInfo } from '@models/docker';
import { imagesToInspect, withProvenance } from '@utils/provenance';
import { makeContainer, makeImage, makeVolume } from '../fixtures';

const ANON = 'efca87f31e981ccee0e4898d937d0562ef8203c5694d5c141cfe9897c42fc16f';
const mount = (name: string, destination: string): MountInfo => ({
  type: 'volume',
  name,
  source: `/var/lib/docker/volumes/${name}/_data`,
  destination,
  mode: '',
  rw: true,
});

const db = makeContainer({
  id: 'c-db',
  name: 'dzlink-db-1',
  imageId: 'sha256:old',
  imageName: 'dzlink/base:1',
  mounts: [mount(ANON, '/var/cache/app'), mount('dzlink_data', '/data')],
});
const borrower = makeContainer({
  id: 'c-b',
  name: 'dzlink-borrower',
  imageId: 'sha256:alpine',
  mounts: [mount(ANON, '/var/cache/app')],
});
const user = (c: typeof db, destination: string) => ({
  id: c.id,
  name: c.name,
  status: c.status,
  exitCode: c.exitCode,
  destination,
  rw: true,
});
const anon = makeVolume(ANON, {
  anonymous: true,
  inUse: true,
  users: [user(db, '/var/cache/app'), user(borrower, '/var/cache/app')],
});
const images = [makeImage('sha256:old', ['dzlink/base:stable']), makeImage('sha256:alpine', ['alpine:3'])];
const declared = new Map([
  ['sha256:old', ['/var/cache/app/']],
  ['sha256:alpine', []],
]);

describe('withProvenance', () => {
  it("names the image whose VOLUME a user mounts it at, by that image's first tag", () => {
    const [v] = withProvenance([anon], [db, borrower], declared, images);
    expect(v.provenance).toEqual([
      { imageId: 'sha256:old', image: 'dzlink/base:stable', path: '/var/cache/app' },
    ]);
  });

  it('falls back to the name the container was created from when the image is not listed', () => {
    const [v] = withProvenance([anon], [db], declared, []);
    expect(v.provenance?.[0].image).toBe('dzlink/base:1');
  });

  it('says nothing while the image has not been inspected yet', () => {
    expect(withProvenance([anon], [db], new Map(), images)[0].provenance).toBeUndefined();
  });

  it('says nothing for a named volume, an unused one, or one mounted where no image declares it', () => {
    const named = makeVolume('dzlink_data', { users: [user(db, '/data')], inUse: true });
    const unused = makeVolume('b'.repeat(64), { anonymous: true });
    const elsewhere = makeVolume(ANON, { anonymous: true, inUse: true, users: [user(db, '/somewhere')] });
    for (const v of withProvenance([named, unused, elsewhere], [db], declared, images)) {
      expect(v.provenance).toBeUndefined();
    }
  });
});

describe('imagesToInspect', () => {
  it('picks the images of containers mounting an anonymous volume, once each', () => {
    const named = makeVolume('dzlink_data');
    const other = makeContainer({
      id: 'x',
      imageId: 'sha256:other',
      mounts: [mount('dzlink_data', '/data')],
    });
    expect(imagesToInspect([anon, named], [db, borrower, other])).toEqual(['sha256:old', 'sha256:alpine']);
  });
});

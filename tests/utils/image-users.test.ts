import { describe, it, expect } from 'vitest';
import { withImageUsers } from '@utils/image-users';
import { makeContainer, makeImage } from '../fixtures';

const pg = makeImage('sha256:pg', ['postgres:18']);
const old = makeImage('sha256:old', []);

describe('withImageUsers', () => {
  it('joins the containers running each image, by exact image ID', () => {
    const [used, unused] = withImageUsers(
      [pg, old],
      [makeContainer({ id: 'c1', name: 'db', imageId: 'sha256:pg', status: 'exited' })],
    );
    expect(used.users).toEqual([{ id: 'c1', name: 'db', status: 'exited', exitCode: 0 }]);
    expect(used.inUse).toBe(true);
    expect(unused.users).toEqual([]);
    expect(unused.inUse).toBe(false);
  });

  it('puts running users first, then sorts by name', () => {
    const [img] = withImageUsers(
      [pg],
      [
        makeContainer({ id: 'a', name: 'a-stopped', imageId: 'sha256:pg', status: 'exited' }),
        makeContainer({ id: 'z', name: 'z-running', imageId: 'sha256:pg' }),
        makeContainer({ id: 'b', name: 'b-running', imageId: 'sha256:pg' }),
      ],
    );
    expect(img.users.map((u) => u.name)).toEqual(['b-running', 'z-running', 'a-stopped']);
  });

  it('collects the tags its users follow that now name a newer image', () => {
    const [img] = withImageUsers(
      [old],
      [
        makeContainer({
          id: 'a',
          imageId: 'sha256:old',
          outdated: { tag: 'postgres:18', currentImageId: 'x' },
        }),
        makeContainer({
          id: 'b',
          imageId: 'sha256:old',
          outdated: { tag: 'postgres:18', currentImageId: 'x' },
        }),
        makeContainer({ id: 'c', imageId: 'sha256:old' }),
      ],
    );
    expect(img.supersededBy).toEqual(['postgres:18']);
  });

  it('does not modify the images it was given', () => {
    const images = [pg];
    withImageUsers(images, [makeContainer({ imageId: 'sha256:pg' })]);
    expect(images[0].users).toEqual([]);
    expect(images[0].inUse).toBe(false);
  });
});

import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as containersApi from '@docker/containers';
import * as networksApi from '@docker/networks';
import * as volumesApi from '@docker/volumes';
import { downStack, stopStack } from '@docker/stacks';

vi.mock('@docker/containers');
vi.mock('@docker/networks');
vi.mock('@docker/volumes');

const api = { id: 'c-api', name: 'api' };
const db = { id: 'c-db', name: 'db' };
const worker = { id: 'c-worker', name: 'worker' };

beforeEach(() => vi.resetAllMocks());

describe('stopStack', () => {
  it('stops a wave at a time', async () => {
    const order: string[] = [];
    vi.mocked(containersApi.stopContainer).mockImplementation(async (id) => {
      order.push(id);
    });
    await stopStack('shop', [[api, worker], [db]]);
    expect(order.indexOf('c-db')).toBe(2);
  });

  it('keeps going past a failure and names everything that failed', async () => {
    vi.mocked(containersApi.stopContainer).mockImplementation(async (id) => {
      if (id !== 'c-db') throw new Error(`Failed to stop container ${id}: boom`);
    });
    await expect(stopStack('shop', [[api, worker], [db]])).rejects.toThrow(
      "Stack shop: couldn't stop api, worker — Failed to stop container c-api: boom",
    );
    expect(containersApi.stopContainer).toHaveBeenCalledWith('c-db');
  });
});

describe('downStack', () => {
  const targets = {
    stop: [[api], [db]],
    containers: [api, db],
    networks: [{ id: 'n1', name: 'shop_default' }],
    volumes: ['shop_data'],
  };

  it('keeps volumes without -v', async () => {
    await downStack('shop', targets);
    expect(containersApi.removeContainer).toHaveBeenCalledWith('c-api', { volumes: false });
    expect(networksApi.removeNetwork).toHaveBeenCalledWith('n1');
    expect(volumesApi.removeVolume).not.toHaveBeenCalled();
  });

  it('with -v deletes anonymous volumes with the containers, then the named ones', async () => {
    await downStack('shop', targets, { volumes: true });
    expect(containersApi.removeContainer).toHaveBeenCalledWith('c-db', { volumes: true });
    expect(volumesApi.removeVolume).toHaveBeenCalledWith('shop_data');
  });

  it('still removes the rest when one container will not go, naming it once', async () => {
    vi.mocked(containersApi.stopContainer).mockRejectedValue(new Error('stuck'));
    vi.mocked(containersApi.removeContainer).mockImplementation(async (id) => {
      if (id === 'c-api') throw new Error('in use');
    });
    await expect(downStack('shop', targets)).rejects.toThrow("Stack shop: couldn't remove api, db — stuck");
    expect(containersApi.removeContainer).toHaveBeenCalledWith('c-db', { volumes: false });
    expect(networksApi.removeNetwork).toHaveBeenCalled();
  });
});

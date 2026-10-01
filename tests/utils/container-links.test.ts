import { describe, it, expect } from 'vitest';
import type { ComposeInfo, ContainerInfo } from '@models/docker';
import { withLinks } from '@utils/container-links';
import { makeContainer } from '../fixtures';

const compose = (
  service: string,
  dependsOn: string[] = [],
  extra: Partial<ComposeInfo> = {},
): ComposeInfo => ({
  project: 'dzlink',
  service,
  configFiles: [],
  dependsOn,
  oneoff: false,
  ...extra,
});

const linksOf = (containers: ContainerInfo[], id: string) =>
  withLinks(containers)
    .find((c) => c.id === id)
    ?.links?.map(
      (l) =>
        `${l.relation} ${l.target}${l.container ? '' : ' (unresolved)'}${l.service ? ` [${l.service}]` : ''}`,
    );

describe('withLinks', () => {
  const db = makeContainer({ id: 'c-db', name: 'dzlink-db-1', compose: compose('db') });
  const cache = makeContainer({ id: 'c-cache', name: 'dzlink-cache-1', compose: compose('cache') });
  const api = makeContainer({ id: 'c-api', name: 'dzlink-api-1', compose: compose('api', ['db', 'cache']) });

  it('resolves depends_on to the containers running those services, and back', () => {
    const all = [db, cache, api];
    expect(linksOf(all, 'c-api')).toEqual([
      'depends-on dzlink-cache-1 [cache]',
      'depends-on dzlink-db-1 [db]',
    ]);
    expect(linksOf(all, 'c-db')).toEqual(['needed-by dzlink-api-1 [db]']);
  });

  it('keeps a depends_on whose service has no container left, unresolved', () => {
    expect(linksOf([db, api], 'c-api')).toEqual([
      'depends-on cache (unresolved) [cache]',
      'depends-on dzlink-db-1 [db]',
    ]);
  });

  it('only looks in the same project, and never at one-off containers', () => {
    const elsewhere = makeContainer({
      id: 'x',
      name: 'other-db-1',
      compose: compose('db', [], { project: 'other' }),
    });
    const oneoff = makeContainer({
      id: 'r',
      name: 'dzlink-db-run-1',
      compose: compose('db', [], { oneoff: true }),
    });
    expect(linksOf([elsewhere, oneoff, api], 'c-api')).toEqual([
      'depends-on cache (unresolved) [cache]',
      'depends-on db (unresolved) [db]',
    ]);
  });

  it('a shared network stack: by full ID, short ID or name, both ways', () => {
    const host = makeContainer({ id: '4e59a18564cf348d', name: 'dzlink-db-1' });
    for (const ref of ['4e59a18564cf348d', '4e59a18564cf', 'dzlink-db-1']) {
      const side = makeContainer({ id: 's', name: 'dzlink-side', networkMode: { container: ref } });
      expect(linksOf([host, side], 's')).toEqual(['network-of dzlink-db-1']);
      expect(linksOf([host, side], '4e59a18564cf348d')).toEqual(['shares-network dzlink-side']);
    }
  });

  it('borrowed volumes, both ways; a lender that is gone stays named', () => {
    const borrower = makeContainer({
      id: 'b',
      name: 'dzlink-borrower',
      volumesFrom: ['dzlink-db-1', 'gone'],
    });
    expect(linksOf([db, borrower], 'b')).toEqual([
      'volumes-from dzlink-db-1',
      'volumes-from gone (unresolved)',
    ]);
    expect(linksOf([db, borrower], 'c-db')).toEqual(['lends-volumes dzlink-borrower']);
  });

  it('orders relations the same way everywhere, and gives everyone a list', () => {
    const side = makeContainer({ id: 's', name: 'side', networkMode: { container: 'c-db' } });
    const borrower = makeContainer({ id: 'b', name: 'borrower', volumesFrom: ['dzlink-db-1'] });
    expect(linksOf([borrower, side, api, db], 'c-db')).toEqual([
      'needed-by dzlink-api-1 [db]',
      'shares-network side',
      'lends-volumes borrower',
    ]);
    expect(withLinks([makeContainer()])[0].links).toEqual([]);
  });

  it('does not modify the containers it was given', () => {
    const containers = [db, api];
    withLinks(containers);
    expect(db.links).toBeUndefined();
  });
});

import { describe, it, expect, afterEach } from 'vitest';
import type blessed from 'neo-blessed';
import type { ContainerInfo } from '@models/docker';
import { groupIntoStacks } from '@utils/stacks';
import { ContainerList } from '@ui/containers/container-list';
import { StackTree } from '@ui/stacks/stack-tree';
import { endpoint, makeContainer } from '../fixtures';
import { makeScreen } from './headless';

/**
 * Widget tests, against the bar in CONTRIBUTING.md: what's under test is blessed's own wrapping. A
 * row as wide as its list item, with a space near its end, is word-wrapped onto a second line the
 * one-row item never shows — so the last column's `+N` silently disappeared.
 */

const ports = [
  { ip: '127.0.0.1', publicPort: 18080, privatePort: 80, type: 'tcp' },
  { ip: '0.0.0.0', publicPort: 18081, privatePort: 81, type: 'tcp' },
];
const c: ContainerInfo = makeContainer({
  name: 'dzlink-db-1',
  ports,
  networks: [endpoint('dzlink_back'), endpoint('dzlink_front')],
  labels: { 'com.docker.compose.project': 'dzlink' },
});

/** What the screen shows on row `y`. */
const row = (screen: blessed.Widgets.Screen, y: number): string =>
  screen.lines[y].map((cell: [unknown, string]) => cell[1]).join('');

describe('list rows keep their +N on screen', () => {
  let screen: blessed.Widgets.Screen;

  afterEach(() => {
    screen.destroy();
  });

  it.each([100, 122, 150])('Containers list, NET and PORTS, %i columns', (width) => {
    screen = makeScreen(160, 20);
    const list = new ContainerList(screen, { top: 0, left: 0, width, height: 10 });
    list.setData([c]);
    screen.render();
    expect(row(screen, 2)).toMatch(/dzli\S*… \+1 /);
    expect(row(screen, 2)).toMatch(/127\.0\.0\.1:\S*… \+1/);
  });

  it.each([100, 122, 150])('Stacks tree, PORTS, %i columns', (width) => {
    screen = makeScreen(160, 20);
    const tree = new StackTree(screen, { top: 0, left: 0, width, height: 10 });
    tree.setData(groupIntoStacks([c]), new Map());
    screen.render();
    expect(row(screen, 3)).toMatch(/127\.0\.0\.1:\S*… \+1/);
  });
});

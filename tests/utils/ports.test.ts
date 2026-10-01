import { describe, it, expect } from 'vitest';
import type { PortInfo } from '@models/docker';
import { formatPort, portSpec, portUrl, toPorts } from '@utils/ports';

const published = (publicPort: number, privatePort: number, ip = '0.0.0.0', type = 'tcp'): PortInfo => ({
  ip,
  publicPort,
  privatePort,
  type,
});

describe('toPorts', () => {
  it('keeps one of the IPv4 / IPv6 twins Docker reports for a wildcard binding: the IPv4 one', () => {
    const ports = toPorts([
      { IP: '::', PublicPort: 5432, PrivatePort: 5432, Type: 'tcp' },
      { IP: '0.0.0.0', PublicPort: 5432, PrivatePort: 5432, Type: 'tcp' },
    ]);
    expect(ports).toEqual([published(5432, 5432)]);
  });

  it('keeps bindings on different addresses, ports or protocols apart', () => {
    const ports = toPorts([
      { IP: '127.0.0.1', PublicPort: 8025, PrivatePort: 8025, Type: 'tcp' },
      { IP: '127.0.0.1', PublicPort: 1025, PrivatePort: 1025, Type: 'tcp' },
      { IP: '0.0.0.0', PublicPort: 53, PrivatePort: 53, Type: 'udp' },
      { IP: '0.0.0.0', PublicPort: 53, PrivatePort: 53, Type: 'tcp' },
    ]);
    expect(ports.map(formatPort)).toEqual([
      '0.0.0.0:53->53/tcp',
      '0.0.0.0:53->53/udp',
      '127.0.0.1:1025->1025/tcp',
      '127.0.0.1:8025->8025/tcp',
    ]);
  });

  it('reads an unpublished port as just the container side', () => {
    expect(toPorts([{ PrivatePort: 3000, Type: 'tcp' }])).toEqual([{ privatePort: 3000, type: 'tcp' }]);
  });

  it('sorts, so polls do not reshuffle the rows', () => {
    const a = toPorts([
      { PrivatePort: 9000, Type: 'tcp' },
      { PrivatePort: 80, Type: 'tcp' },
    ]);
    expect(a.map((p) => p.privatePort)).toEqual([80, 9000]);
  });

  it('treats a null payload as no ports', () => {
    expect(toPorts(null)).toEqual([]);
  });
});

describe('formatPort', () => {
  it('formats a published port as docker ps does', () => {
    expect(formatPort(published(8080, 80))).toBe('0.0.0.0:8080->80/tcp');
  });

  it('formats an unpublished port as its container side', () => {
    expect(formatPort({ privatePort: 3000, type: 'tcp' })).toBe('3000/tcp');
  });
});

describe('portUrl', () => {
  it('reaches a wildcard binding through localhost', () => {
    expect(portUrl(published(8080, 80))).toBe('http://localhost:8080');
    expect(portUrl(published(8080, 80, '::'))).toBe('http://localhost:8080');
    expect(portUrl(published(8080, 80, ''))).toBe('http://localhost:8080');
  });

  it('keeps a specific address, bracketing IPv6', () => {
    expect(portUrl(published(5432, 5432, '127.0.0.1'))).toBe('http://127.0.0.1:5432');
    expect(portUrl(published(5432, 5432, '::1'))).toBe('http://[::1]:5432');
  });

  it('names a non-TCP protocol as the scheme', () => {
    expect(portUrl(published(53, 53, '0.0.0.0', 'udp'))).toBe('udp://localhost:53');
  });

  it('is null for a port that is not published', () => {
    expect(portUrl({ privatePort: 3000, type: 'tcp' })).toBeNull();
  });
});

describe('portSpec', () => {
  it('writes the binding as docker run -p takes it', () => {
    expect(portSpec(published(5432, 5432, '127.0.0.1'))).toBe('127.0.0.1:5432:5432/tcp');
    expect(portSpec(published(5432, 5432, '::1'))).toBe('[::1]:5432:5432/tcp');
  });

  it('leaves a wildcard address out', () => {
    expect(portSpec(published(8080, 80))).toBe('8080:80/tcp');
  });

  it('is null for a port that is not published', () => {
    expect(portSpec({ privatePort: 3000, type: 'tcp' })).toBeNull();
  });
});

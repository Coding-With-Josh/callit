/**
 * Tests for the hardened source-of-truth verifier (SSRF surface).
 *
 * Focus: fail-closed reachability — public https verifies; file:/ftp:/data:,
 * credentials, localhost, IP literals, private DNS targets, redirects into
 * blocked targets, timeouts, non-2xx and redirect loops all fail; and the
 * result can never contain response content.
 */
import { describe, it, expect } from 'vitest';
import { createSourceVerifier } from './source-verifier';

type Addr = { address: string; family: number };

const PUBLIC_ADDRS: readonly Addr[] = [{ address: '93.184.216.34', family: 4 }];

function verifier(overrides: {
  fetchImpl?: typeof fetch;
  resolveHost?: (host: string) => Promise<readonly Addr[]>;
} = {}) {
  return createSourceVerifier({
    fetchImpl:
      overrides.fetchImpl ??
      (async () => new Response('ok', { status: 200 })),
    resolveHost: overrides.resolveHost ?? (async () => PUBLIC_ADDRS),
    timeoutMs: 300,
  });
}

describe('source verifier', () => {
  it('verifies a reachable public https URL', async () => {
    await expect(verifier()('https://example.com/source')).resolves.toEqual({
      ok: true,
    });
  });

  it('rejects non-http schemes, credentials, and malformed URLs', async () => {
    const v = verifier();
    expect((await v('file:///etc/passwd')).ok).toBe(false);
    expect((await v('ftp://example.com/x')).ok).toBe(false);
    expect((await v('data:text/plain,hi')).ok).toBe(false);
    expect((await v('https://user:pass@example.com/x')).ok).toBe(false);
    expect((await v('not a url')).ok).toBe(false);
  });

  it('rejects localhost and IP-literal hosts outright', async () => {
    const v = verifier();
    expect((await v('http://localhost/status')).ok).toBe(false);
    expect((await v('http://127.0.0.1/status')).ok).toBe(false);
    expect((await v('http://93.184.216.34/status')).ok).toBe(false);
    expect((await v('http://[::1]/status')).ok).toBe(false);
  });

  it('rejects hostnames that resolve into private address space', async () => {
    const v = verifier({
      resolveHost: async () => [{ address: '10.0.0.5', family: 4 }],
    });
    const result = await v('https://internal.example.com/x');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('private');
  });

  it('rejects link-local and loopback resolutions', async () => {
    const v4 = verifier({
      resolveHost: async () => [{ address: '169.254.169.254', family: 4 }],
    });
    expect((await v4('https://metadata.example.com/')).ok).toBe(false);

    const v6 = verifier({
      resolveHost: async () => [{ address: '::1', family: 6 }],
    });
    expect((await v6('https://loopback.example.com/')).ok).toBe(false);
  });

  it('treats a DNS failure and an empty DNS answer as unverified', async () => {
    const failing = verifier({
      resolveHost: async () => {
        throw new Error('ENOTFOUND');
      },
    });
    const failed = await failing('https://missing.example.com/');
    expect(failed.ok).toBe(false);
    expect(failed.reason).toContain('resolve');

    const empty = verifier({ resolveHost: async () => [] });
    expect((await empty('https://empty.example.com/')).ok).toBe(false);
  });

  it('treats a timeout as unverified (fail closed, never a pass)', async () => {
    const v = verifier({
      fetchImpl: (async (
        _input: RequestInfo | URL,
        init?: RequestInit,
      ): Promise<Response> =>
        new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () =>
            reject(new DOMException('aborted', 'AbortError')),
          );
        })) as typeof fetch,
    });
    const result = await v('https://example.com/slow');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('timed out');
  });

  it('treats non-2xx statuses as unverified', async () => {
    const v = verifier({
      fetchImpl: (async () => new Response('nope', { status: 404 })) as typeof fetch,
    });
    const result = await v('https://example.com/missing');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('404');
  });

  it('never follows a redirect into a blocked target', async () => {
    const calls: string[] = [];
    const v = verifier({
      fetchImpl: (async (input: RequestInfo | URL): Promise<Response> => {
        calls.push(String(input));
        return new Response(null, {
          status: 302,
          headers: { location: 'http://127.0.0.1/secret' },
        });
      }) as typeof fetch,
    });
    const result = await v('https://example.com/start');
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(1); // the blocked hop is never fetched
  });

  it('follows a redirect to a public target and verifies', async () => {
    const v = verifier({
      fetchImpl: (async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        return url.includes('/redirect')
          ? new Response(null, {
              status: 302,
              headers: { location: 'https://example.com/final' },
            })
          : new Response('ok', { status: 200 });
      }) as typeof fetch,
    });
    await expect(v('https://example.com/redirect')).resolves.toEqual({ ok: true });
  });

  it('fails after the redirect limit', async () => {
    const v = verifier({
      fetchImpl: (async () =>
        new Response(null, {
          status: 302,
          headers: { location: 'https://example.com/again' },
        })) as typeof fetch,
    });
    const result = await v('https://example.com/start');
    expect(result.ok).toBe(false);
    expect(result.reason).toContain('redirect');
  });

  it('only ever returns ok/reason — never response content', async () => {
    const v = verifier({
      fetchImpl: (async () =>
        new Response('<h1>secret token: abc123</h1>', { status: 200 })) as typeof fetch,
    });
    const result = await v('https://example.com/');
    expect(result.ok).toBe(true);
    expect(Object.keys(result).sort()).toEqual(['ok']);
  });
});
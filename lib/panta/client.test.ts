import { describe, it, expect, vi } from 'vitest';
import { z } from 'zod';
import {
  createPantaClient,
  pantaClientFromEnv,
  wireBaseUnitsToUsdc,
  wireIsoToUnixSeconds,
} from './client';

const okSchema = z.object({ value: z.string() });

/** A minimal fake fetch capturing the URL/init, returning a canned Response. */
function fakeFetch(response: Response): {
  impl: typeof fetch;
  calls: Array<{ url: string; init: RequestInit | undefined }>;
} {
  const calls: Array<{ url: string; init: RequestInit | undefined }> = [];
  const impl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    calls.push({ url: String(input), init });
    return response;
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const jsonResponse = (body: unknown, status = 200, headers?: Record<string, string>) =>
  new Response(typeof body === 'string' ? body : JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });

const client = (impl: typeof fetch) =>
  createPantaClient({
    apiKey: 'pk_test_secret',
    baseUrl: 'https://live-api.panta.market/api/v1',
    fetchImpl: impl,
    timeoutMs: 50,
  });

describe('panta client — happy path', () => {
  it('normalizes the trailing slash, sends the key, validates the body', async () => {
    const { impl, calls } = fakeFetch(jsonResponse({ value: 'hi' }));
    const result = await client(impl).request({
      method: 'GET',
      path: '/markets',
      schema: okSchema,
    });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.value.value).toBe('hi');
    expect(calls[0]?.url).toBe('https://live-api.panta.market/api/v1/markets/');
    const init = calls[0]?.init;
    expect(init?.redirect).toBe('error');
    expect((init?.headers as Record<string, string>)['x-api-key']).toBe(
      'pk_test_secret',
    );
  });

  it('serializes query params, dropping undefined', async () => {
    const { impl, calls } = fakeFetch(jsonResponse({ value: 'hi' }));
    await client(impl).request({
      method: 'GET',
      path: '/markets/',
      query: { category: 'crypto', limit: 10, cursor: undefined },
      schema: okSchema,
    });
    expect(calls[0]?.url).toBe(
      'https://live-api.panta.market/api/v1/markets/?category=crypto&limit=10',
    );
  });
});

describe('panta client — fail closed', () => {
  it('rejects a non-2xx with a parsed error envelope', async () => {
    const { impl } = fakeFetch(
      jsonResponse({ code: 'QUOTE_EXPIRED', message: 'expired' }, 400),
    );
    const result = await client(impl).request({
      method: 'POST',
      path: '/primaryorderquote/',
      body: {},
      schema: okSchema,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'http') {
      expect(result.error.status).toBe(400);
      expect(result.error.error.kind).toBe('known');
    }
  });

  it('carries Retry-After on a 429', async () => {
    const { impl } = fakeFetch(
      jsonResponse({ code: 'RATE_LIMITED', message: 'slow down' }, 429, {
        'retry-after': '30',
      }),
    );
    const result = await client(impl).request({
      method: 'GET',
      path: '/markets/',
      schema: okSchema,
    });
    if (!result.ok && result.error.kind === 'http') {
      expect(result.error.error.retryAfterSeconds).toBe(30);
    } else {
      throw new Error('expected an http error');
    }
  });

  it('synthesizes an unknown HTTP_<status> error and never echoes the raw body', async () => {
    const { impl } = fakeFetch(
      new Response('<html>pk_test_secret leaked?</html>', { status: 502 }),
    );
    const result = await client(impl).request({
      method: 'GET',
      path: '/markets/',
      schema: okSchema,
    });
    expect(result.ok).toBe(false);
    if (!result.ok && result.error.kind === 'http') {
      expect(result.error.error.kind).toBe('unknown');
      if (result.error.error.kind === 'unknown') {
        expect(result.error.error.rawCode).toBe('HTTP_502');
      }
      expect(JSON.stringify(result.error.error)).not.toContain('leaked');
    }
  });

  it('fails closed when a 2xx body does not match the schema', async () => {
    const { impl } = fakeFetch(jsonResponse({ wrong: true }));
    const result = await client(impl).request({
      method: 'GET',
      path: '/markets/',
      schema: okSchema,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('malformed');
  });

  it('times out a hanging request', async () => {
    const impl = (async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () =>
          reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        );
      });
    }) as unknown as typeof fetch;
    const result = await client(impl).request({
      method: 'GET',
      path: '/markets/',
      schema: okSchema,
      timeoutMs: 20,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('timeout');
  });
});

describe('panta client — Phase 3 guards', () => {
  it('refuses a protocol-relative path instead of sending the key off-origin', async () => {
    const { impl, calls } = fakeFetch(jsonResponse({ value: 'hi' }));
    const result = await client(impl).request({
      method: 'GET',
      path: '//evil.example.com/steal',
      schema: okSchema,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('config');
    expect(calls).toHaveLength(0);
  });

  it('refuses an absolute-URL path', async () => {
    const { impl, calls } = fakeFetch(jsonResponse({ value: 'hi' }));
    const result = await client(impl).request({
      method: 'GET',
      path: 'https://evil.example.com/',
      schema: okSchema,
    });
    expect(result.ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('refuses a userId containing a header-injection CR/LF', async () => {
    const { impl, calls } = fakeFetch(jsonResponse({ value: 'hi' }));
    const result = await client(impl).request({
      method: 'GET',
      path: '/markets/',
      userId: 'attacker\r\nx-api-key: stolen',
      schema: okSchema,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('config');
    expect(calls).toHaveLength(0);
  });
});

describe('panta client — env + conversions', () => {
  it('returns a config error when the key is missing', () => {
    const result = pantaClientFromEnv({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe('config');
  });

  it('converts wire base units to decimal USDC', () => {
    expect(wireBaseUnitsToUsdc('50000000')).toBe('50');
    expect(wireBaseUnitsToUsdc('2500000')).toBe('2.5');
  });

  it('converts a microsecond ISO timestamp to unix seconds', () => {
    expect(wireIsoToUnixSeconds('2026-09-04T16:30:00.000000Z')).toBe(1788539400);
  });
});

// Quiet the unused import lint for vi if the fake ever needs spies.
void vi;

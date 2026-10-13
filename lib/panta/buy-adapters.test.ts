/**
 * Tests for the buy adapters — specifically the bounded quote re-roll.
 *
 * The retry is a MONEY-path behaviour, so what it must not do matters as much as
 * what it does: re-roll only the transient "Panta could not price this market on
 * this request" answer, send the SAME body every time, stay bounded, and leave
 * every other failure (a graduated market, an amount error, a bad field, a dead
 * upstream) on the first answer.
 *
 * Verified live (2026-10-13) against `/primaryorderquote/`: the same market, side
 * and amount answered 200 nine times in ten and a bare
 * `{"code":"INVALID_MARKET_PARAMS"}` (no message, no `fields`) once.
 */
import { describe, expect, it } from 'vitest';
import { createPantaClient, PantaCallError } from './client';
import { QUOTE_ATTEMPTS, requestBuyQuote } from './buy-adapters';
import { usdcDecimalSchema } from '@/types/money';
import type { BuyAdaptersConfig } from './buy-adapters';
import type { PantaTransportError } from './client';

const PAYER = '3Jp9C1tKrLdD9r2RQZoTNLKgrT5v9ZxCTAiF9HXhDD3F';
const MARKET = 'mkt-live-1';

/** Wire response from POST /primaryorderquote/. Amounts are base-unit strings. */
const QUOTE_BODY = {
  quoteId: 'quote-1',
  marketId: MARKET,
  side: 'yes',
  amountUsdc: '5000000',
  shares: '7.9365',
  avgPrice: '0.63',
  feeUsdc: '50000',
  expiresAt: '2026-10-12T00:00:00.000Z',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const BARE_UNPRICEABLE = () => json({ code: 'INVALID_MARKET_PARAMS' }, 400);

/**
 * A client whose quote answers follow a scripted sequence, recording every body
 * it was asked to send. The last answer repeats once the script runs out, and
 * the call count is exposed so a test can assert how many attempts were made.
 */
function scriptedClient(answers: readonly Response[]) {
  const bodies: unknown[] = [];
  let attempts = 0;
  const fetchImpl: typeof fetch = async (_url, init) => {
    bodies.push(typeof init?.body === 'string' ? JSON.parse(init.body) : null);
    const answer = answers[Math.min(attempts, answers.length - 1)]!;
    attempts++;
    return answer.clone();
  };
  const client = createPantaClient({
    apiKey: 'test-key',
    baseUrl: 'https://live-api.panta.market/api/v1',
    fetchImpl,
  });
  return { client, bodies, calls: () => attempts };
}

function cfg(client: BuyAdaptersConfig['client']): BuyAdaptersConfig {
  return { client, wallet: PAYER };
}

const args = {
  marketId: MARKET,
  side: 'yes' as const,
  amountUsdc: usdcDecimalSchema.parse('25'),
};

/** Run the quote and return either the value or the thrown transport error. */
async function outcome(
  client: BuyAdaptersConfig['client'],
): Promise<{ ok: true; value: unknown } | { ok: false; transport: PantaTransportError | null }> {
  const value = await requestBuyQuote(cfg(client), { ...args }).then(
    (quote) => ({ ok: true as const, value: quote }),
    (e: unknown) => ({
      ok: false as const,
      transport: e instanceof PantaCallError ? e.transport : null,
    }),
  );
  return value;
}

function codeOf(transport: PantaTransportError | null): string | null {
  if (!transport || transport.kind !== 'http') return null;
  return transport.error.kind === 'known'
    ? transport.error.code
    : transport.error.rawCode;
}

describe('requestBuyQuote — the transient price-read re-roll', () => {
  it('re-rolls a bare INVALID_MARKET_PARAMS and returns the quote', async () => {
    // THE user-visible bug: this bare code is Panta failing to read the market's
    // on-chain price for one request, not a verdict about the order.
    const { client, calls } = scriptedClient([
      BARE_UNPRICEABLE(),
      BARE_UNPRICEABLE(),
      json(QUOTE_BODY),
    ]);

    const result = await outcome(client);

    expect(result.ok).toBe(true);
    expect(calls()).toBe(3);
  });

  it('sends the identical body on every attempt', async () => {
    // Phase 3 (parameter substitution via a retry): a re-roll must never
    // re-derive an operand. The wallet is the adapter's `config.wallet` — not a
    // caller-supplied string — and the side stays the domain lowercase form.
    const { client, bodies } = scriptedClient([
      BARE_UNPRICEABLE(),
      json(QUOTE_BODY),
    ]);

    await outcome(client);

    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toEqual(bodies[1]);
    expect(bodies[0]).toEqual({
      wallet: PAYER,
      marketId: MARKET,
      side: 'yes',
      amountUsdc: '25',
    });
  });

  it('does not re-roll a graduated market', async () => {
    const { client, calls } = scriptedClient([
      json({ code: 'MARKET_NOT_IN_PRIMARY' }, 400),
      json(QUOTE_BODY),
    ]);

    const result = await outcome(client);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(codeOf(result.transport)).toBe('MARKET_NOT_IN_PRIMARY');
    // One attempt: the market is not primary and no number of retries changes it.
    expect(calls()).toBe(1);
  });

  it('does not re-roll an amount error or a field error', async () => {
    // The ONLY quote failure the client's amount copy is true for.
    const amount = scriptedClient([json({ code: 'AMOUNT_TOO_SMALL' }, 400), json(QUOTE_BODY)]);
    const amountResult = await outcome(amount.client);
    expect(amountResult.ok).toBe(false);
    expect(amount.calls()).toBe(1);

    // A body that names the offending field IS the caller's problem.
    const field = scriptedClient([
      json(
        { code: 'INVALID_MARKET_PARAMS', message: 'amountUsdc: invalid', fields: { amountUsdc: ['invalid'] } },
        400,
      ),
      json(QUOTE_BODY),
    ]);
    const fieldResult = await outcome(field.client);
    expect(fieldResult.ok).toBe(false);
    expect(field.calls()).toBe(1);
  });

  it('does not re-roll a dead upstream', async () => {
    // A network failure is not the price-read lottery, and re-rolling it would
    // only add latency before the same answer.
    let attempts = 0;
    const fetchImpl: typeof fetch = async () => {
      attempts++;
      throw new TypeError('fetch failed');
    };
    const client = createPantaClient({
      apiKey: 'test-key',
      baseUrl: 'https://live-api.panta.market/api/v1',
      fetchImpl,
    });

    const result = await outcome(client);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.transport?.kind).toBe('network');
    expect(attempts).toBe(1);
  });

  it('stays bounded and reports the last failure', async () => {
    // Every attempt fails: the loop must stop at QUOTE_ATTEMPTS (a bounded,
    // jittered delay each time) and surface the real upstream code rather than
    // inventing one.
    const { client, calls } = scriptedClient([BARE_UNPRICEABLE()]);

    const result = await outcome(client);

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(calls()).toBe(QUOTE_ATTEMPTS);
    expect(codeOf(result.transport)).toBe('INVALID_MARKET_PARAMS');
  });
});

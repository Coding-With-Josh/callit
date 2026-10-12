import { describe, it, expect } from 'vitest';
import {
  createBuildBodySchema,
  createQuoteBodySchema,
  sourceVerifyBodySchema,
} from './create-requests';

// These pin the create-route perimeter (Phase 3/4). A future edit that loosens
// one of them (adds a `wallet` field, drops the schedule ordering, allows a
// data: URL) reopens a hole that the route itself cannot see.
//
// The draft the wizard holds, INCLUDING the domain markers, is what the client
// actually posts — so the fixtures below carry them, and the schema must strip
// them rather than reject the request.

const draft = {
  question: 'Will ETH be above $5,000 on 2027-01-01?',
  resolutionRule:
    'Resolves to YES if the CoinGecko daily close UTC on 2027-01-01 is above $5,000.',
  sourcesOfTruth: ['https://www.coingecko.com'],
  category: 'crypto',
  startTime: 1893456000,
  endTime: 1896127200,
  resolutionTime: 1896130800,
  marketType: 'standard' as const,
  eventInProgress: false,
};

/** What the wizard actually posts: the resolvable draft with its markers. */
const postedDraft = {
  ...draft,
  injection: { suspicious: false, reasons: [] },
  validated: true,
  resolvable: true,
  resolvability: { resolvable: true, reasons: [], suggestions: [] },
};

const imageUrl = 'https://cdn.example.com/cover.png';

describe('createQuoteBodySchema (quote route perimeter)', () => {
  it('accepts the wizard payload and strips the domain markers', () => {
    const parsed = createQuoteBodySchema.parse({ draft: postedDraft, imageUrl });
    expect(parsed.draft).toEqual(draft);
    // Phase 3: markers are never trusted server-side, so they cannot ride along.
    expect(parsed.draft).not.toHaveProperty('injection');
    expect(parsed.draft).not.toHaveProperty('validated');
    expect(parsed.draft).not.toHaveProperty('resolvable');
  });

  it('rejects a body that tries to supply its own wallet', () => {
    // Phase 3 (wallet substitution): the fee payer is bound from the session.
    // A body carrying one is refused outright rather than silently ignored.
    const result = createQuoteBodySchema.safeParse({
      draft,
      imageUrl,
      wallet: 'Attacker1111111111111111111111111111111',
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown top-level key', () => {
    expect(
      createQuoteBodySchema.safeParse({ draft, imageUrl, oracle: 'x' }).success,
    ).toBe(false);
  });

  it('rejects an inverted or unordered schedule', () => {
    // Phase 3 (state injection): no inverted schedule reaches Panta.
    expect(
      createQuoteBodySchema.safeParse({
        draft: { ...draft, startTime: draft.endTime },
        imageUrl,
      }).success,
    ).toBe(false);
    expect(
      createQuoteBodySchema.safeParse({
        draft: { ...draft, resolutionTime: draft.endTime - 1 },
        imageUrl,
      }).success,
    ).toBe(false);
  });

  it('rejects a non-integer hour count in the schedule', () => {
    expect(
      createQuoteBodySchema.safeParse({
        draft: { ...draft, endTime: 1896127200.5 },
        imageUrl,
      }).success,
    ).toBe(false);
  });

  it('rejects a data: image URL (our templated cover cannot go on the wire)', () => {
    expect(
      createQuoteBodySchema.safeParse({
        draft,
        imageUrl: 'data:image/svg+xml;base64,PHN2Zy8+',
      }).success,
    ).toBe(false);
  });

  it('rejects an over-long image URL', () => {
    expect(
      createQuoteBodySchema.safeParse({
        draft,
        imageUrl: `https://cdn.example.com/${'a'.repeat(2048)}`,
      }).success,
    ).toBe(false);
  });

  it('rejects a category outside the closed slug allowlist', () => {
    expect(
      createQuoteBodySchema.safeParse({
        draft: { ...draft, category: 'Crypto' },
        imageUrl,
      }).success,
    ).toBe(false);
  });

  it('rejects an empty source list and more than 20 sources', () => {
    expect(
      createQuoteBodySchema.safeParse({
        draft: { ...draft, sourcesOfTruth: [] },
        imageUrl,
      }).success,
    ).toBe(false);
    expect(
      createQuoteBodySchema.safeParse({
        draft: {
          ...draft,
          sourcesOfTruth: Array.from({ length: 21 }, (_, i) => `https://s${i}.example.com`),
        },
        imageUrl,
      }).success,
    ).toBe(false);
  });

  it('rejects a claim longer than the wire limit', () => {
    expect(
      createQuoteBodySchema.safeParse({
        draft: { ...draft, question: 'a'.repeat(513) },
        imageUrl,
      }).success,
    ).toBe(false);
  });
});

describe('createBuildBodySchema (build route perimeter)', () => {
  it('accepts a create session id', () => {
    expect(createBuildBodySchema.parse({ createId: 'cr_abc123' })).toEqual({
      createId: 'cr_abc123',
    });
  });

  it('rejects a body that tries to supply its own wallet', () => {
    // The wallet sent upstream is ALWAYS the session's — never the caller's.
    expect(
      createBuildBodySchema.safeParse({
        createId: 'cr_abc123',
        wallet: 'Attacker1111111111111111111111111111111',
      }).success,
    ).toBe(false);
  });

  it('rejects a missing or over-long createId', () => {
    expect(createBuildBodySchema.safeParse({}).success).toBe(false);
    expect(
      createBuildBodySchema.safeParse({ createId: 'a'.repeat(129) }).success,
    ).toBe(false);
  });
});

describe('sourceVerifyBodySchema (SSRF route perimeter)', () => {
  it('accepts a bounded url string', () => {
    expect(sourceVerifyBodySchema.parse({ url: 'https://example.com' })).toEqual({
      url: 'https://example.com',
    });
  });

  it('rejects an empty or over-long url', () => {
    expect(sourceVerifyBodySchema.safeParse({ url: '' }).success).toBe(false);
    expect(
      sourceVerifyBodySchema.safeParse({ url: `https://x.example/${'a'.repeat(2048)}` })
        .success,
    ).toBe(false);
  });

  it('rejects unknown keys so the verifier can never be fed extra operands', () => {
    expect(
      sourceVerifyBodySchema.safeParse({
        url: 'https://example.com',
        redirects: 99,
      }).success,
    ).toBe(false);
  });
});

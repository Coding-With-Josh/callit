'use client';

/**
 * use-create-adapters — the LIVE `CreateAdapters` for the create wizard.
 *
 * Owns: swapping the wizard's in-process fixture stub for the real surface —
 * our own proxy routes (create quote, create build, source verify, categories),
 * the session wallet's signer, and the wall clock.
 * Must not import: any server-only module (this file ships to the browser).
 *
 * Phase 1 (complete mediation): every call goes to an app route that
 * re-authenticates the session and re-derives the wallet server-side. Nothing
 * the wizard holds here can redirect the fee payer, and no stage of the pipeline
 * trusts a client-side value — the steps re-check the transition table.
 *
 * Phase 2 (no internals leak / dependency down): a route failure is reduced to a
 * fixed message from lib/create/client; no response body is read into the UI.
 * The category read degrades to the DOMAIN's own closed allowlist rather than
 * blocking creation, and a source-verification outage is a FAILED check.
 *
 * Phase 3 (stale build): build and sign are separate calls, and `buildStep`
 * re-checks Panta's blockhash window before the wallet is ever prompted.
 */
import { useMemo } from 'react';
import { useSolanaSigner } from '@/components/auth/use-solana-signer';
import { authedJson } from '@/components/auth/authed-json';
import { describeAuthedFailure } from '@/lib/auth/session-mint';
import {
  describeCreateClientError,
  describeSourceCheckError,
  parseCreateBuild,
  parseCreateQuote,
  parseSourceVerdict,
} from '@/lib/create/client';
import type { CreateAdapters } from '@/lib/create-market';
import { describeSignRequestError } from '@/lib/solana/sign-messages';
import {
  MARKET_CATEGORY_SLUGS,
  standardStartFloor,
  txSignature,
  unixSeconds,
  type UnixSeconds,
} from '@/types';

const DAY_SECONDS = 86_400;

/**
 * The public image URL sent with the create quote while no image host is wired.
 *
 * The wire contract requires a public http(s) URL and rejects data URLs, so the
 * templated card the wizard renders (lib/create-image) cannot be sent as-is. This
 * app never registers a market, so the placeholder only ever lives on a
 * throwaway create session — it never becomes a live market's artwork. Replace
 * with the real upload handshake when image hosting lands.
 */
export const LIVE_COVER_PLACEHOLDER_URL = 'https://picsum.photos/1024';

/**
 * The source of truth the local draft step emits. `.invalid` is reserved
 * (RFC 2606) and never resolves, so the verified-source gate CANNOT pass by
 * accident: the user must supply the real source before a quote is opened. A
 * reachable-looking placeholder (example.com) would silently "verify" and let an
 * unverifiable market through.
 */
const UNVERIFIED_DRAFT_SOURCE = 'https://source.invalid/resolution';

/** The live category route's envelope (`{ categories, disclaimer, ... }`). */
function categoriesFrom(data: unknown): readonly string[] | null {
  if (typeof data !== 'object' || data === null) return null;
  const value = (data as { categories?: unknown }).categories;
  if (!Array.isArray(value)) return null;
  const list = value.filter((item): item is string => typeof item === 'string');
  return list.length > 0 ? list : null;
}

function nowSeconds(): UnixSeconds {
  return unixSeconds(Math.floor(Date.now() / 1000));
}

export function useCreateAdapters(): CreateAdapters {
  const { sign } = useSolanaSigner();

  // Memoised so `adapters` is a stable identity across renders: the wizard reads
  // `adapters.now()` while rendering and keys its effects off this object, so a
  // fresh object every render would re-run them (and re-floor the date inputs).
  return useMemo<CreateAdapters>(
    () => ({
      provenance: 'live',
      now: nowSeconds,

      /**
       * The draft step. The server-side LLM route does not exist yet, so the
       * draft is a local deterministic seed — but it is CLOCK-AWARE (never a
       * fixed past date, which would make a real quote impossible) and its source
       * is deliberately unverifiable, so the gate below is the real one.
       * Everything it returns is treated as untrusted by `parseRawDraft`.
       */
      generateDraft: async (claim) => {
        const now = nowSeconds();
        return {
          question: claim,
          resolutionRule: `Resolves to YES if "${claim}" is confirmed by a public source of truth by the resolution deadline; otherwise NO.`,
          sourcesOfTruth: [UNVERIFIED_DRAFT_SOURCE],
          category: 'crypto',
          // Seed at the floor PLUS headroom, never at the bare floor: a start
          // sitting exactly on the boundary is already invalid by the time the
          // validator runs a moment later (the elapsed-clock bug this replaced).
          startTime: standardStartFloor(now),
          endTime: now + 30 * DAY_SECONDS,
          resolutionTime: now + 31 * DAY_SECONDS,
          marketType: 'standard',
          eventInProgress: false,
        };
      },

      /**
       * Phase 2 (degraded read): the Panta category list is a paid shared-budget
       * read. If it fails we fall back to the DOMAIN's own closed allowlist —
       * the same list `validateDraft` checks against and the wire schema accepts,
       * so this is a safe static default, not invented catalog data.
       */
      fetchCategories: async () => {
        const res = await authedJson('/api/panta/categories');
        if (res.ok) {
          const list = categoriesFrom(res.data);
          if (list) return list;
        }
        return [...MARKET_CATEGORY_SLUGS];
      },

      /**
       * The image step. See LIVE_COVER_PLACEHOLDER_URL: honour a real upload URL
       * if the draft ever carries one, otherwise send the documented placeholder.
       * The card the user reviews is rendered locally and never leaves the page.
       */
      uploadImage: async (draft) => {
        const provided = (draft.imageUrl ?? '').trim();
        return /^https?:\/\//.test(provided)
          ? provided
          : LIVE_COVER_PLACEHOLDER_URL;
      },

      /**
       * Phase 3 (SSRF + fail-closed gate): the check runs server-side. As of
       * 2026-10-12 this route does NOT require a session, so the gate no longer
       * depends on the wallet session mint (whose Privy token refresh is
       * rate-limited and was failing). An unreachable host, a timeout, or a
       * failed route all come back `ok: false` — there is no path here that
       * returns a pass on failure.
       *
       * A failed ROUTE is not a verdict about the URL, so it is reported per
       * status rather than masked as one catch-all sentence — that masking is
       * what hid a missing route behind "could not be checked right now".
       */
      verifySource: async (url) => {
        const res = await authedJson('/api/sources/verify', {
          method: 'POST',
          body: { url },
        });
        // The failure body is never read (Phase 2) — only the status number.
        if (!res.ok) {
          // An ANONYMOUS-route 401 should not happen any more, but a session
          // failure here is not "you are signed out": report the mint's own
          // reason. This is the case that showed "Connect your wallet to check
          // sources" while the wallet pill displayed a connected wallet.
          return {
            ok: false,
            reason: describeAuthedFailure(
              res.status,
              res.sessionFailure,
              describeSourceCheckError,
            ),
          };
        }
        return parseSourceVerdict(res.data);
      },

      requestQuote: async (draft, imageUrl) => {
        const res = await authedJson('/api/panta/create/quote', {
          method: 'POST',
          body: { draft, imageUrl },
        });
        // A session failure must name itself, not read as "sign in" — that is
        // the copy that told a signed-in user to sign in.
        if (!res.ok) {
          throw new Error(
            describeAuthedFailure(
              res.status,
              res.sessionFailure,
              describeCreateClientError,
            ),
          );
        }
        return parseCreateQuote(res.data);
      },

      buildCreate: async (quote) => {
        const res = await authedJson('/api/panta/create/build', {
          method: 'POST',
          body: { createId: quote.createId },
        });
        if (!res.ok) {
          throw new Error(
            describeAuthedFailure(
              res.status,
              res.sessionFailure,
              describeCreateClientError,
            ),
          );
        }
        return parseCreateBuild(res.data);
      },

      /**
       * The only place a wallet prompt happens. The signer gate refuses an
       * expired/mismatched/extra-signer transaction BEFORE the prompt, and its
       * failures are mapped to fixed copy — the wallet's own message is never
       * surfaced (Phase 2).
       */
      signCreate: async (build) => {
        const out = await sign(build.transaction);
        if (!out.ok) throw new Error(describeSignRequestError(out.error));
        try {
          return txSignature(out.value.signature);
        } catch {
          throw new Error('Your wallet returned a signature we could not read.');
        }
      },

      /**
       * Registration is deliberately NOT wired: it is the only step that moves
       * real funds, and no route for it exists. Fail closed if it is ever
       * reached instead of silently pretending a market was created.
       */
      register: async () => {
        throw new Error('Registering a market is not available yet.');
      },
    }),
    [sign],
  );
}

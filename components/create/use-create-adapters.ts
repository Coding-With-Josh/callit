'use client';

/**
 * use-create-adapters — the LIVE `CreateAdapters` for the create wizard.
 *
 * Owns: swapping the wizard's in-process fixture stub for the real surface —
 * our own proxy routes (create quote, create build, create register, source
 * verify, categories), the session wallet's signer, and the wall clock.
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
  describeRegisterClientError,
  describeSourceCheckError,
  parseCreateBuild,
  parseCreateQuote,
  parseCreateRegister,
  parseSourceVerdict,
} from '@/lib/create/client';
import type { CreateAdapters } from '@/lib/create-market';
import { describeSignRequestError } from '@/lib/solana/sign-messages';
import {
  MARKET_CATEGORY_SLUGS,
  refloorStaleStart,
  standardStartFloor,
  txSignature,
  unixSeconds,
  type UnixSeconds,
} from '@/types';

const DAY_SECONDS = 86_400;

/**
 * Register retry schedule (bounded). Panta's register REPORTS a transaction that
 * has already been broadcast, and it indexes from the chain, so a report sent
 * immediately after the send can legitimately answer "not visible yet" until
 * Panta catches up. Five attempts over ~8s, then the user is told the truth
 * (submitted, not yet registered) rather than being invited to submit again.
 */
const REGISTER_RETRY_DELAYS_MS = [750, 1_500, 3_000, 3_000] as const;

const sleep = (ms: number): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The public image URL sent with the create quote while no image host is wired.
 *
 * The wire contract requires a public http(s) URL and rejects data URLs, so the
 * templated card the wizard renders (lib/create-image) cannot be sent as-is.
 *
 * WARNING (this changed when register was wired): the placeholder is no longer
 * confined to a throwaway create session. Registration submits the transaction
 * for real, so this URL becomes the ARTWORK OF A LIVE MARKET and is effectively
 * permanent. It must be replaced with the real upload handshake (lib/create-image
 * + the P5b Cloudinary step) before creation is offered to real users. The
 * wizard warns on the create button for exactly this reason.
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
  const { sign, signAndSend } = useSolanaSigner();

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
        /**
         * Re-floor the start time at CONSUMPTION time, not just at validation.
         *
         * `now` is read here (and by Panta) long after the draft step floored it:
         * the wizard's steps, a wallet prompt, and a human reading the review
         * all sit between Continue and this call. The slack above Panta's own
         * `minimumStartDelay` (3600s) is only STANDARD_LEAD_MARGIN_SECONDS
         * (300s), so a draft that was valid at Continue is refused minutes later
         * with "startTime must be at least 3600s ahead of now" — reported to the
         * user as "that draft isn't valid", when the start time is the app's
         * choice, not theirs.
         *
         * The SAME rule the validator uses (types/time refloorStaleStart), so
         * the value quoted matches the value validated; it only ever moves the
         * start LATER, preserving a later choice and never rescuing a past day.
         */
        const usesBreaking =
          draft.marketType === 'breaking' && draft.eventInProgress === true;
        const freshDraft: typeof draft = {
          ...draft,
          startTime: refloorStaleStart(draft.startTime, nowSeconds(), usesBreaking),
        };
        const res = await authedJson('/api/panta/create/quote', {
          method: 'POST',
          body: { draft: freshDraft, imageUrl },
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
       * The sign-only hook. Kept so the `signed` stage stays expressible, but NO
       * step in this app registers from it: Panta's register needs the
       * transaction visible on-chain, and a signature alone is not on-chain.
       * The wallet prompt happens in `broadcastCreate` below.
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
       * built -> broadcast. THE submission: the wallet signs Panta's transaction
       * and hands it to the network in one prompt, and the signature that comes
       * back names a transaction that is now (or is being) on-chain.
       *
       * Why this step has to exist: register does not submit anything — it
       * REPORTS a transaction Panta must already be able to see. Without a
       * broadcast, every register returned `TX_NOT_FOUND`, because Panta was
       * being handed a signature for a transaction that never left the browser.
       *
       * Phase 3 (double spend): the signer gate refuses an undecodable,
       * multi-signer, or wrong-wallet transaction before the prompt, and the only
       * thing returned is the signature — the signed bytes are never held here,
       * so there is no path that signs without sending.
       */
      broadcastCreate: async (build) => {
        const out = await signAndSend(build.transaction);
        if (!out.ok) throw new Error(describeSignRequestError(out.error));
        try {
          return txSignature(out.value.signature);
        } catch {
          throw new Error('Your wallet returned a signature we could not read.');
        }
      },

      /**
       * broadcast -> registered. NOT the money step — the money moved when the
       * wallet submitted. This step REPORTS the submitted transaction so Panta
       * creates the market record for it.
       *
       * Three properties are deliberate:
       *  - It runs only after a confirmed broadcast. Registering from the
       *    sign-only stage is illegal in the transition table, because Panta
       *    cannot register a transaction it cannot see on-chain (the bug this
       *    pipeline was just fixed for).
       *  - It RETRIES the same signature a bounded number of times on 503. Panta
       *    indexes from the chain, so a register sent immediately after the send
       *    legitimately answers `TX_NOT_FOUND` — mapped to 503, a "not visible
       *    yet" state, NOT "nothing happened" — until it catches up. A retry
       *    re-sends the same report, so it can neither spend nor create twice;
       *    and Panta refuses an already-consumed create session outright.
       *  - It is NOT retried on 409 (the session is finished — a market may
       *    already exist, and retrying cannot tell the user anything new) or on
       *    400 (the body was refused).
       *
       * Phase 2 (no internals leak / no fabricated success): the response is
       * parsed through a strict schema, never displayed, and a failure is fixed
       * copy keyed by our own status. `parseCreateRegister` refuses a response
       * with no usable market id rather than letting the UI announce a market.
       */
      register: async (quote, signature) => {
        const submit = () =>
          authedJson('/api/panta/create/register', {
            method: 'POST',
            body: { createId: quote.createId, signature },
          });
        let res = await submit();
        for (const delay of REGISTER_RETRY_DELAYS_MS) {
          if (res.ok || res.status !== 503) break;
          await sleep(delay);
          res = await submit();
        }
        if (!res.ok) {
          // A register failure has its own vocabulary: the create copy would
          // tell the user to go and edit a draft that is already signed.
          throw new Error(
            describeAuthedFailure(
              res.status,
              res.sessionFailure,
              describeRegisterClientError,
            ),
          );
        }
        return parseCreateRegister(res.data);
      },
    }),
    [sign, signAndSend],
  );
}

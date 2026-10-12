/**
 * lib/share/urls — building the share surface for a market: plain link, X web
 * intent, Telegram share, and the Solana Action (Blink) link.
 *
 * Framework-free and client-safe so the ShareMenu island (and any future share
 * surface) builds URLs here and the encoding/validation rules are unit-tested
 * once. Must not import React, Next, or server-only modules.
 *
 * Trust model (Phase 1/3 of the ShareMenu build):
 *  - `title` is upstream market copy (untrusted). Every intent URL is built
 *    with encodeURIComponent on BOTH text and url, then prefix-asserted to its
 *    fixed intent host before UI may open it (guards parameter injection: a
 *    crafted `&url=` inside the title cannot repoint the share target).
 *  - `marketId` is re-validated at point of use (mirrors MARKET_ID_PATTERN in
 *    lib/panta/read-adapters.ts; drift-checked in urls.test.ts).
 */
import { absoluteUrl } from "@/lib/seo/site";

/** Market id scope for share URLs. Mirrors MARKET_ID_PATTERN (read-adapters). */
export const SHARE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/;

/** The only hosts this module may produce intent links for. */
const X_INTENT_HOST = "https://twitter.com/intent/tweet";
const TELEGRAM_SHARE_HOST = "https://t.me/share/url";

/**
 * Panta's consumer app origin — the ONLY host a link-out may point at.
 *
 * Verified live (2026-10-12): `https://panta.market/market/{marketId}` is the
 * per-market route (it renders the real market title for a valid id), while
 * `/markets/`, `/event/`, `/events/`, `/prediction/`, `/trade/` and `/m/` all
 * hard-404. `panta.market` itself is a Next.js app; `balr.market` (the name in
 * Panta's own catalog docs) is an unbuilt parking page and is NOT this.
 */
export const PANTA_ORIGIN = "https://panta.market";

/** The fixed prefix a per-market Panta link is built from. */
const PANTA_MARKET_PREFIX = `${PANTA_ORIGIN}/market/`;


/** Cap for the snippet placed into X/Telegram share text. */
export const SHARE_TEXT_MAX = 120;

/** C0/C1 control chars (newline, tab, …) stripped from untrusted upstream copy. */
const CONTROL_CHARS = /[\u0000-\u001f\u007f]+/g;
const WHITESPACE_RUN = /\s+/g;

export function isShareableMarketId(marketId: string): boolean {
  return SHARE_ID_PATTERN.test(marketId);
}

/**
 * Sanitized, bounded snippet for intent text. `title` is untrusted upstream
 * copy: control chars are stripped (Phase 3: newline/param smuggling), runs of
 * whitespace collapsed, and the result truncated at a code-point boundary.
 */
export function shareText(title: string): string {
  const cleaned = title
    .replace(CONTROL_CHARS, " ")
    .replace(WHITESPACE_RUN, " ")
    .trim();
  const base = cleaned.length === 0 ? "A callit prediction market" : cleaned;
  const points = Array.from(base);
  if (points.length <= SHARE_TEXT_MAX) return base;
  return `${points.slice(0, SHARE_TEXT_MAX - 1).join("").trimEnd()}…`;
}

/** Absolute canonical market-page URL, or null when the id is out of scope. */
export function marketUrl(marketId: string): string | null {
  if (!isShareableMarketId(marketId)) return null;
  return absoluteUrl(`/markets/${marketId}`);
}

/** Absolute Solana Action (Blink) URL, or null when the id is out of scope. */
export function blinkUrl(marketId: string): string | null {
  if (!isShareableMarketId(marketId)) return null;
  return absoluteUrl(`/blink/${marketId}`);
}

/**
 * The market's page on Panta, or null when the id is out of scope.
 *
 * Phase 3 (href injection / open redirect): the id is the SAME scope the share
 * gates use — `^[A-Za-z0-9_-]{1,128}$` — which rejects `.`, `/` and `:`. That is
 * what makes `..`, `//evil.com` and `javascript:` structurally impossible here
 * rather than merely unlikely: the scheme and host are fixed by the constant
 * prefix, and the only variable part cannot contain a path or scheme delimiter.
 *
 * Callers must treat null as "use PANTA_ORIGIN", never as "build something else".
 */
export function pantaMarketUrl(marketId: string): string | null {
  if (!isShareableMarketId(marketId)) return null;
  try {
    const href = `${PANTA_MARKET_PREFIX}${encodeURIComponent(marketId)}`;
    // Prefix assert, mirroring the intent builders: never return a string that
    // is not pinned to the Panta origin, even if a future edit drifts.
    return href.startsWith(PANTA_MARKET_PREFIX) ? href : null;
  } catch {
    // encodeURIComponent throws on lone surrogates.
    return null;
  }
}

/**
 * X web-intent URL (share text + market link), or null when it cannot be built
 * safely. Fail-closed: encodeURIComponent throws on lone surrogates; we never
 * emit a malformed intent, we drop the item (Phase 2: fail-safe default).
 */
export function xIntentUrl(marketId: string, title: string): string | null {
  const url = marketUrl(marketId);
  if (url === null) return null;
  try {
    const href = `${X_INTENT_HOST}?text=${encodeURIComponent(
      shareText(title)
    )}&url=${encodeURIComponent(url)}`;
    // Prefix assert: never open anything that is not the fixed intent host,
    // even if a future edit introduces interpolation drift (Phase 3 red-team).
    return href.startsWith(X_INTENT_HOST) ? href : null;
  } catch {
    return null;
  }
}

/** Telegram share URL (link + text), or null when it cannot be built safely. */
export function telegramShareUrl(marketId: string, title: string): string | null {
  const url = marketUrl(marketId);
  if (url === null) return null;
  try {
    const href = `${TELEGRAM_SHARE_HOST}?url=${encodeURIComponent(
      url
    )}&text=${encodeURIComponent(shareText(title))}`;
    return href.startsWith(TELEGRAM_SHARE_HOST) ? href : null;
  } catch {
    return null;
  }
}
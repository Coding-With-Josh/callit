/**
 * create-image — the market preview card (1200x630 house art) as an SVG data URI.
 *
 * One shared builder, two surfaces:
 *   - Draft (create wizard): the slots render the template placeholders verbatim
 *     (`callit · [phase] · $[price]`), so the user previews the card's FORMAT,
 *     never a fabricated market. See `templatedCoverDataUri`. Note: if the real
 *     (non-fixture) create flow ever uploads this draft preview as the market's
 *     permanent image, the placeholder literals would be baked in — accepted by
 *     design, not a bug.
 *   - Live market (market detail): the same builder is fed the market's real
 *     phase label and yes-price via `previewCardSlotsForMarket`.
 *
 * The card is rendered as an `<img>` (a real image: not selectable text). The
 * create quote requires a public http(s) imageUrl (data URLs are rejected by
 * the wire schema), so the real flow uploads the templated bytes via the
 * adapter; the in-app previews use the data URI directly.
 *
 * Fonts: the headline is Tusker Grotesk. An SVG loaded through `<img>` is an
 * isolated document — it cannot see the page's CSS or its webfonts — so the
 * Tusker bytes are embedded in the SVG itself as a data-URI `@font-face`
 * (see `loadCoverFontCss` client-side and `loadCoverFontCssServer` server-side).
 * Without that embedding the text silently falls back to `system-ui`.
 *
 * Security: every interpolated slot (headline, phase, price) is untrusted-by-
 * contract text, so all three are XML-escaped at the SVG boundary before
 * interpolation (Phase 3: SVG/markup injection). The decorative layers come
 * from generated constants (`./preview-card-art`), never from user input.
 */
import { formatPriceUsdc } from "@/lib/format";
import { effectivePhase, type Market, type MarketPhase } from "@/types";
import {
  PREVIEW_CARD_BUBBLE_SVG,
  PREVIEW_CARD_BUBBLE_TRANSLATE,
  PREVIEW_CARD_SMILEY_SVG,
  PREVIEW_CARD_SMILEY_TRANSLATE,
} from "./preview-card-art";

/** Escape the five XML metacharacters. `&` first so entities aren't doubled. */
function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/** Greedy word-wrap for the cover headline (up to `maxLines` lines). */
function wrap(text: string, maxChars: number, maxLines: number): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  if (words.length === 0) return ["New market"];
  const lines: string[] = [];
  let current = "";
  let overflow = false;
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length > maxChars && current) {
      lines.push(current);
      current = word;
      if (lines.length === maxLines) {
        overflow = true;
        break;
      }
    } else {
      current = candidate;
    }
  }
  if (!overflow && current && lines.length < maxLines) lines.push(current);
  if (lines.length === 0) lines.push(words[0] ?? "New market");
  if (overflow && lines.length > 0) {
    const last = lines[lines.length - 1] ?? "";
    lines[lines.length - 1] = `${last.slice(0, maxChars - 1)}…`;
  }
  return lines.slice(0, maxLines);
}

/**
 * Family name used *inside* the SVG. It must be declared by the embedded
 * `@font-face` (see `loadCoverFontCss`) because the SVG cannot reach the page's
 * `--font-tusker-9800`. The `system-ui` fallback keeps the cover rendering (in
 * the system face) if the embed is missing or the fetch fails.
 */
const COVER_FAMILY = "CoverTusker";
const COVER_FONT = `${COVER_FAMILY}, system-ui, sans-serif`;
const COVER_FONT_URL = "/fonts/tusker-9800-super.ttf";

/**
 * The `@font-face` rule that embeds the Tusker bytes as a base64 data URI so
 * they survive inside an `<img>`-loaded SVG. Shared by the client loader
 * (fetch + btoa) and the server loader (node:fs read). `base64` contains only
 * the font bytes — never user input.
 */
export function coverFontFaceCss(base64: string): string {
  return (
    `@font-face{font-family:${COVER_FAMILY};` +
    `src:url(data:font/ttf;base64,${base64}) format('truetype');` +
    `font-weight:100 900;font-display:block;}`
  );
}

/** Draft-mode footer placeholders, shown verbatim so the preview reads exactly
 * like the template card (`callit · [phase] · $[price]`). */
export const PREVIEW_CARD_PHASE_PLACEHOLDER = "[phase]";
export const PREVIEW_CARD_PRICE_PLACEHOLDER = "$[price]";

/** The three dynamic slots of the card. All are display strings; the builder
 * XML-escapes each before it touches the SVG (Phase 3: injection). */
export interface PreviewCardSlots {
  /** The market claim — user-authored in the draft flow, read from the wire
   * market otherwise. */
  readonly headline: string;
  /** Footer phase slot: "live" for a live market, or the template placeholder. */
  readonly phase: string;
  /** Footer price slot: "$0.03" for a live market, or the template placeholder. */
  readonly price: string;
}

/**
 * Phase labels used ON THE CARD. These deliberately follow the design's own
 * register (the example card reads "callit · live · $0.03") rather than the
 * browse/market-page chips ("Open"); keep the two maps separate on purpose.
 */
const CARD_PHASE_LABELS: Record<MarketPhase, string> = {
  primary: "live",
  secondary: "graduated",
  resolved: "resolved",
  cancelled: "cancelled",
};

/**
 * Live-market slots: real phase label and yes-price. A market with no fillable
 * price renders an honest "$—" rather than a fabricated number. The price is
 * read from the same `Market.yesPrice` the TradeDeck displays — never a stale
 * or invented value (Phase 2: degraded fallback).
 *
 * The label reads `effectivePhase`, not the raw wire phase: Panta's phase string
 * flips between "resolved" and "secondary" for the same settled market between
 * reads, which would bake a different word ("graduated" vs "resolved") into the
 * shared card image on each read (Phase 3: copy drift on the shared artifact).
 */
export function previewCardSlotsForMarket(market: Market): PreviewCardSlots {
  return {
    headline: market.title,
    phase: CARD_PHASE_LABELS[effectivePhase(market)],
    price: market.yesPrice === null ? "$—" : formatPriceUsdc(market.yesPrice),
  };
}

/**
 * Build the 1200x630 market preview card as SVG markup.
 *
 * Paint order mirrors the design source (public/preview-card/): cream ground,
 * the two decorative doodles, the rounded ink frame, then the dynamic text.
 * The doodles are generated constants from the Figma exports, placed at their
 * design-time coordinates via the `_TRANSLATE` constants.
 *
 * `fontFaceCss` is injected verbatim into a `<defs><style>` — caller-supplied
 * and built from our own font asset, never from user input.
 */
function buildPreviewCardSvg(
  slots: PreviewCardSlots,
  fontFaceCss: string,
): string {
  // Tusker is ~2x wider than the system stack, so the wrap stays narrow (17
  // chars): at 68px this reproduces the design's own 3-line breaks (e.g.
  // "Will Bitcoin / close above / $150,000 by 2026?") and keeps the headline
  // inside the ink frame (text starts at x=88, frame inner edge at x=1158).
  const lines = wrap(slots.headline.trim(), 17, 3);
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="88" dy="${index === 0 ? 0 : 83}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  const headline =
    `font-family:${COVER_FONT};font-size:68px;font-weight:700;letter-spacing:-1px`;
  const footnote = `font-family:${COVER_FONT};font-size:32px;font-weight:600`;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img">` +
    (fontFaceCss ? `<defs><style>${fontFaceCss}</style></defs>` : "") +
    `<rect width="1200" height="630" fill="#FFF2DD"/>` +
    `<g transform="translate(${PREVIEW_CARD_SMILEY_TRANSLATE.x} ${PREVIEW_CARD_SMILEY_TRANSLATE.y})" fill="none">${PREVIEW_CARD_SMILEY_SVG}</g>` +
    `<g transform="translate(${PREVIEW_CARD_BUBBLE_TRANSLATE.x} ${PREVIEW_CARD_BUBBLE_TRANSLATE.y})" fill="none">${PREVIEW_CARD_BUBBLE_SVG}</g>` +
    `<rect x="42" y="42" width="1116" height="546" rx="30" fill="none" stroke="#2D1C00" stroke-opacity="0.15" stroke-width="4"/>` +
    `<text x="88" y="240" fill="#2D1C00" style="${headline}">${tspans}</text>` +
    `<text x="88" y="541" fill="#2D1C00" fill-opacity="0.5" style="${footnote}">callit · ${escapeXml(slots.phase)} · ${escapeXml(slots.price)}</text>` +
    `</svg>`
  );
}

/**
 * Self-contained preview card as a data URI, for an `<img src>`. Pass the
 * `@font-face` CSS from `loadCoverFontCss()`/`loadCoverFontCssServer()` to
 * render in Tusker; omit it (or pass "") and the SVG renders in the system
 * fallback instead. Deterministic: the same slots always yield the same art.
 */
export function previewCardDataUri(
  slots: PreviewCardSlots,
  fontFaceCss = "",
): string {
  return `data:image/svg+xml,${encodeURIComponent(buildPreviewCardSvg(slots, fontFaceCss))}`;
}

/**
 * Draft-mode convenience wrapper: the question with the template's placeholder
 * slots, so the create-wizard preview shows the card FORMAT — never a
 * fabricated phase or price. Existing callers keep working unchanged.
 */
export function templatedCoverDataUri(
  question: string,
  fontFaceCss = "",
): string {
  return previewCardDataUri(
    {
      headline: question,
      phase: PREVIEW_CARD_PHASE_PLACEHOLDER,
      price: PREVIEW_CARD_PRICE_PLACEHOLDER,
    },
    fontFaceCss,
  );
}

let fontCssPromise: Promise<string> | null = null;

/**
 * Fetch the Tusker face once and return an `@font-face` rule that embeds it as a
 * base64 data URI, so it survives inside an `<img>`-loaded SVG. Cached for the
 * page lifetime.
 *
 * FAIL-SAFE: any failure (offline, 404, encoding error) resolves to `""`, which
 * means "no @font-face" — the cover still renders in the system fallback rather
 * than breaking or throwing into render.
 *
 * Client-only (uses `fetch`/`btoa`).
 */
export function loadCoverFontCss(): Promise<string> {
  if (!fontCssPromise) {
    fontCssPromise = fetch(COVER_FONT_URL)
      .then((res) => {
        if (!res.ok) throw new Error(`cover font: ${res.status}`);
        return res.arrayBuffer();
      })
      .then((buf) => {
        const bytes = new Uint8Array(buf);
        let binary = "";
        for (let i = 0; i < bytes.length; i += 1) {
          binary += String.fromCharCode(bytes[i] ?? 0);
        }
        const base64 = btoa(binary);
        return coverFontFaceCss(base64);
      })
      .catch(() => "");
  }
  return fontCssPromise;
}

"use client";

import { useEffect, useRef, useState } from "react";
import { Check, Link2, Send, Share2, Zap } from "lucide-react";
import {
  blinkUrl,
  isShareableMarketId,
  marketUrl,
  telegramShareUrl,
  xIntentUrl,
} from "@/lib/share/urls";

type CopyTarget = "market" | "blink";

/**
 * Share surface for a market page. Client island: owns menu state and the
 * clipboard write; all URL construction lives in lib/share/urls (unit-tested).
 *
 * Trust (Phase 1/3): `marketId` is re-validated at point of use here AND the
 * URLs arrive pre-built and pre-sanitized from the tested module — this
 * component never interpolates `marketId` or `title` into a URL itself. The
 * only strings ever written to the clipboard are our own constructed http(s)
 * URLs (never upstream `title` copy — copy-confusion guard).
 *
 * Split component keeps the React hooks rule: the outer gate returns early
 * with zero hooks, the inner island calls its hooks unconditionally.
 */
export const ShareMenu = ({ marketId, title }: { marketId: string; title: string }) => {
  // Fail closed: an out-of-scope id hides the control entirely (the server page
  // already gates by MARKET_ID_PATTERN; this is defense in depth).
  if (!isShareableMarketId(marketId)) return null;
  return <ShareMenuInner marketId={marketId} title={title} />;
};

const ShareMenuInner = ({ marketId, title }: { marketId: string; title: string }) => {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState<CopyTarget | null>(null);
  const [copyError, setCopyError] = useState<string | null>(null);
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  const mUrl = marketUrl(marketId);
  const bUrl = blinkUrl(marketId);
  const xHref = xIntentUrl(marketId, title);
  const tgHref = telegramShareUrl(marketId, title);

  // Close on outside pointerdown and Esc. No focus trap: menu items stay
  // native buttons/anchors, so tab order and Enter/Space keep working.
  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: PointerEvent) => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
      }
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  const copy = async (kind: CopyTarget, url: string) => {
    setCopyError(null);
    setFailedUrl(null);
    try {
      if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) {
        throw new Error("clipboard unavailable");
      }
      await navigator.clipboard.writeText(url);
      setCopied(kind);
      window.setTimeout(() => {
        setCopied((current) => (current === kind ? null : current));
      }, 2000);
    } catch {
      // Phase 2 fail-safe default: never imply success. Reveal the exact URL
      // as selectable text so the share still happens manually.
      setCopied(null);
      setCopyError("Clipboard unavailable — select the link to copy it.");
      setFailedUrl(url);
    }
  };

  const itemClass =
    "flex w-full items-center gap-2.5 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium tracking-tight text-[#2D1C00]/80 transition-colors hover:bg-[#2D1C00]/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D1C00]/20";

  return (
    <div ref={rootRef} className="relative ml-auto">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Share this market"
        className="flex items-center justify-center gap-2 rounded-full bg-[#2D1C00]/10 px-3.5 py-1.5 text-xs font-semibold tracking-tight text-[#2D1C00] transition-colors hover:bg-[#2D1C00]/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#2D1C00]/20"
      >
        <Share2 className="size-3.5" strokeWidth={2.5} />
        Share
      </button>

      {open && (
        <div
          role="menu"
          aria-label="Share options"
          className="absolute right-0 top-full z-50 mt-2 w-72 rounded-xl bg-[#FFF2DD] p-1.5 shadow-lg ring-1 ring-[#2D1C00]/10"
        >
          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => void copy("market", mUrl ?? "")}
          >
            {copied === "market" ? (
              <Check className="size-4" />
            ) : (
              <Link2 className="size-4" />
            )}
            {copied === "market" ? "Copied market link" : "Copy market link"}
          </button>

          {/* Intent hosts are fixed and prefix-asserted in lib/share/urls; open
              in a new tab so the market page is never navigated away from. */}
          {xHref !== null && (
            <a
              role="menuitem"
              href={xHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className={itemClass}
            >
              <span className="flex size-4 items-center justify-center text-[11px] font-bold leading-none">
                X
              </span>
              Share on X
            </a>
          )}

          {tgHref !== null && (
            <a
              role="menuitem"
              href={tgHref}
              target="_blank"
              rel="noopener noreferrer"
              onClick={() => setOpen(false)}
              className={itemClass}
            >
              <Send className="size-4" />
              Share on Telegram
            </a>
          )}

          <div className="my-1 h-px bg-[#2D1C00]/10" />

          <button
            type="button"
            role="menuitem"
            className={itemClass}
            onClick={() => void copy("blink", bUrl ?? "")}
          >
            {copied === "blink" ? (
              <Check className="size-4" />
            ) : (
              <Zap className="size-4" />
            )}
            {copied === "blink" ? "Copied Blink link" : "Copy Blink link"}
          </button>

          {/* Honest caveat: the Blink works in Blink-capable clients today;
              in-feed rendering on X is gated on Dialect registry approval. */}
          <p className="px-2.5 pb-1.5 pt-0.5 text-[11px] leading-snug tracking-tight text-[#2D1C00]/50">
            Works in Phantom, Backpack and other blink-enabled apps now. On X,
            in-feed action buttons need the domain in Dialect&apos;s registry —
            the link still renders as a page until then.
          </p>

          {copyError !== null && failedUrl !== null && (
            <div className="mt-1 border-t border-[#2D1C00]/10 px-2.5 pb-2 pt-2">
              <p className="text-[11px] font-medium tracking-tight text-[#B91C1C]">
                {copyError}
              </p>
              <input
                readOnly
                value={failedUrl}
                onFocus={(event) => event.currentTarget.select()}
                className="mt-1.5 w-full rounded-md bg-[#2D1C00]/5 px-2 py-1.5 font-mono text-[11px] tracking-tight text-[#2D1C00] outline-none ring-1 ring-[#2D1C00]/10"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};
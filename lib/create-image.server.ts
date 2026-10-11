/**
 * create-image.server — server-only font embedding for the market preview card.
 *
 * The market detail page is a server component; it cannot use the client
 * loader's fetch/btoa, so this reads the same Tusker asset off disk and builds
 * the identical `@font-face`.
 *
 * Server-only by construction: this module pulls in `node:fs`, and `next build`
 * fails if a client component ever imports it (fail-closed at compile time —
 * Phase 3: client/server bundle confusion). Do not import this from client
 * components.
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import { coverFontFaceCss } from "./create-image";

const FONT_FILE = path.join(
  process.cwd(),
  "public/fonts",
  "tusker-9800-super.ttf",
);

let fontCssPromise: Promise<string> | null = null;

/**
 * FAIL-SAFE: any failure (missing file, read error) resolves to `""`, meaning
 * "no @font-face" — the card still renders in the system fallback rather than
 * throwing into render (Phase 2: degraded fallback). Resolves once per process.
 */
export function loadCoverFontCssServer(): Promise<string> {
  if (!fontCssPromise) {
    fontCssPromise = readFile(FONT_FILE)
      .then((buf) => coverFontFaceCss(buf.toString("base64")))
      .catch(() => "");
  }
  return fontCssPromise;
}
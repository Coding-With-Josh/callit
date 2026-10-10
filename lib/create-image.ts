/**
 * create-image — templated cover art for a new market.
 *
 * Pure: builds a self-contained SVG data URI from the question text. It is only
 * ever used as an in-page THUMBNAIL. The create quote requires a public
 * http(s) imageUrl (data URLs are rejected by the wire schema), so the real
 * flow uploads the templated bytes via the adapter and hands the returned
 * public URL to the quote.
 *
 * Security: the question is untrusted text interpolated into SVG markup, so it
 * is XML-escaped before interpolation (Phase 3: SVG/markup injection).
 */

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
 * Build a 1200x630 cover SVG (cream/ink, Callit house style) as a data URI.
 * Deterministic: the same question always yields the same art.
 */
export function templatedCoverDataUri(question: string): string {
  const lines = wrap(question.trim(), 26, 3);
  const tspans = lines
    .map(
      (line, index) =>
        `<tspan x="80" dy="${index === 0 ? 0 : 84}">${escapeXml(line)}</tspan>`,
    )
    .join("");
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630" role="img">` +
    `<rect width="1200" height="630" fill="#FFF2DD"/>` +
    `<rect x="40" y="40" width="1120" height="550" rx="32" fill="none" stroke="#2D1C00" stroke-opacity="0.15" stroke-width="4"/>` +
    `<text x="80" y="250" fill="#2D1C00" font-family="system-ui, -apple-system, sans-serif" font-size="68" font-weight="700" letter-spacing="-1">${tspans}</text>` +
    `<text x="80" y="544" fill="#2D1C00" fill-opacity="0.5" font-family="system-ui, sans-serif" font-size="32" font-weight="600">callit · preview cover</text>` +
    `</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}
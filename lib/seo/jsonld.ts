/**
 * seo/jsonld — safe serialization for schema.org JSON-LD.
 *
 * Owns: turning a JSON-LD object into the exact string that goes inside a
 * `<script type="application/ld+json">` tag.
 * Must not import: React.
 *
 * Phase 3 (structured-data injection): `JSON.stringify` alone is not enough —
 * a `</script>` sequence anywhere in a value would close the tag early. Every
 * `<` is escaped to `\u003c`, which is inert inside JSON, so a title coming
 * from an upstream market can never break out of the script element.
 */
export function jsonLd(data: unknown): string {
  return JSON.stringify(data).replace(/</g, '\\u003c');
}

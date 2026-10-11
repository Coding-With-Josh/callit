/**
 * panta/source-verifier — hardened reachability check for a user-supplied
 * source of truth.
 *
 * Server-side only (the create adapters are never sent to the browser, and the
 * DNS import below would break a client bundle). This is an SSRF surface: a
 * hostile draft may point a fetcher at an internal network. Controls applied
 * BEFORE any fetch:
 *   - scheme allow-list (http/https only): `file:`, `ftp:`, `data:`, ... die
 *     here
 *   - embedded credentials in the URL are refused (`https://user:pass@…`)
 *   - IP literals are rejected outright — public sources use hostnames
 *   - `localhost` / `.localhost` are refused
 *   - the hostname is DNS-resolved and EVERY address must be public; private,
 *     loopback, link-local, CGNAT, multicast and reserved ranges fail closed
 *   - redirects are followed manually (MAX_VERIFY_REDIRECTS hops), and each
 *     hop re-runs the same validation + DNS checks — a redirect into a blocked
 *     target is refused before any fetch
 * The response body is never read: status alone decides, and only `ok`/
 * `reason` ever leave this module, so response contents can never leak back to
 * a caller or a user.
 *
 * Residual (documented, not closed): DNS resolution and the fetch are separate
 * steps, so a hostname that re-resolves differently between them (DNS
 * rebinding) is not fully pinned. The IP-literal ban and per-hop re-checks
 * still hold. The future create route should additionally rate-limit
 * verification and bound the number of sources per draft.
 */
import { lookup } from 'node:dns/promises';
import { err, ok, type Result } from '@/types';

/** How long one source check may take before it fails closed. */
export const DEFAULT_VERIFY_TIMEOUT_MS = 8_000;
/** Redirects are followed manually; an extra hop beyond this fails the check. */
export const MAX_VERIFY_REDIRECTS = 3;

export interface SourceVerifierOptions {
  readonly fetchImpl?: typeof fetch;
  /** Resolve a hostname to addresses. Injectable so tests never touch DNS. */
  readonly resolveHost?: (
    host: string,
  ) => Promise<readonly { address: string; family: number }[]>;
  readonly timeoutMs?: number;
  readonly maxRedirects?: number;
}

/** Safe user-facing verdict. Structurally identical to SourceVerification. */
export interface SourceVerdict {
  readonly ok: boolean;
  readonly reason?: string;
}

type Address = { address: string; family: number };

function isIpLiteral(hostname: string): boolean {
  // IPv4 dotted quad, or anything IPv6-shaped (URL.hostname brackets v6).
  return /^\d{1,3}(\.\d{1,3}){3}$/.test(hostname) || hostname.includes(':');
}

/** Phase 3 (SSRF): RFC 1918, loopback, link-local, CGNAT, benchmarking, multicast/reserved. */
function isPrivateIpv4(ip: string): boolean {
  const octets = ip.split('.').map((part) => Number(part));
  if (
    octets.length !== 4 ||
    octets.some((octet) => Number.isNaN(octet) || octet < 0 || octet > 255)
  ) {
    return true; // malformed → treat as unsafe (fail closed)
  }
  const [a, b] = octets;
  return (
    a === 0 || // "this network"
    a === 10 || // RFC 1918
    a === 127 || // loopback
    (a === 100 && b >= 64 && b <= 127) || // CGNAT
    (a === 169 && b === 254) || // link-local
    (a === 172 && b >= 16 && b <= 31) || // RFC 1918
    (a === 192 && b === 168) || // RFC 1918
    (a === 198 && (b === 18 || b === 19)) || // benchmarking
    a >= 224 // multicast + reserved
  );
}

/** Pragmatic IPv6 check: unspecified, loopback, ULA, link-local, v4-mapped. */
function isPrivateIpv6(ip: string): boolean {
  const value = ip.toLowerCase();
  if (value === '::' || value === '::1' || value === '::ffff:127.0.0.1') {
    return true;
  }
  if (value.startsWith('fc') || value.startsWith('fd')) return true; // ULA fc00::/7
  if (
    value.startsWith('fe8') ||
    value.startsWith('fe9') ||
    value.startsWith('fea') ||
    value.startsWith('feb')
  ) {
    return true; // link-local fe80::/10
  }
  const mapped = value.match(/::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapped) return isPrivateIpv4(mapped[1] ?? '');
  return false;
}

/**
 * Parse + safety-check a target URL. `ok` only for http(s) URLs whose host
 * could plausibly be public. Used on the original URL and EVERY redirect hop.
 */
function validateTarget(rawUrl: string): Result<URL, string> {
  const trimmed = rawUrl.trim();
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    return err('not a valid URL');
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return err('source must be a public http(s) URL');
  }
  if (parsed.username !== '' || parsed.password !== '') {
    return err('source URLs must not embed credentials');
  }
  const host = parsed.hostname.toLowerCase();
  if (host.length === 0 || !host.includes('.')) {
    return err('source host must be a public domain');
  }
  if (host === 'localhost' || host.endsWith('.localhost')) {
    return err('source must not be a local hostname');
  }
  if (isIpLiteral(host)) {
    return err('IP-address sources are not allowed');
  }
  return ok(parsed);
}

/** Phase 3 (SSRF): reject hostnames that resolve into non-public space. */
async function hostIsBlocked(
  url: URL,
  resolveHost: (host: string) => Promise<readonly Address[]>,
): Promise<string | null> {
  let addresses: readonly Address[];
  try {
    addresses = await resolveHost(url.hostname);
  } catch {
    return 'could not resolve source host';
  }
  if (addresses.length === 0) {
    return 'source host resolves to no address';
  }
  const blocked = addresses.some((entry) => {
    const isV6 = entry.family === 6 || entry.address.includes(':');
    return isV6 ? isPrivateIpv6(entry.address) : isPrivateIpv4(entry.address);
  });
  return blocked ? 'source resolves to a private network address' : null;
}

type FetchOutcome =
  | { readonly kind: 'verified' }
  | { readonly kind: 'redirect'; readonly location: string | null }
  | { readonly kind: 'failed'; readonly reason: string };

/** One GET with a timeout. The response body is NEVER read. */
async function fetchOnce(
  url: URL,
  fetchImpl: typeof fetch,
  timeoutMs: number,
): Promise<FetchOutcome> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      method: 'GET',
      redirect: 'manual',
      signal: controller.signal,
      cache: 'no-store',
      headers: { accept: '*/*' },
    });
    // Status is all we need — cancel immediately so a hostile body is never
    // downloaded and can never be echoed back to anyone.
    if (response.body) {
      void response.body.cancel().catch(() => undefined);
    }
    if (response.status >= 200 && response.status < 300) {
      return { kind: 'verified' };
    }
    if (response.status >= 300 && response.status < 400) {
      return { kind: 'redirect', location: response.headers.get('location') };
    }
    return { kind: 'failed', reason: `source responded with HTTP ${response.status}` };
  } catch {
    if (controller.signal.aborted) {
      return { kind: 'failed', reason: 'source check timed out' };
    }
    return { kind: 'failed', reason: 'source could not be reached' };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Build the verifier. Every failure mode returns a safe `SourceVerdict`; this
 * function never throws.
 */
export function createSourceVerifier(
  options: SourceVerifierOptions = {},
): (url: string) => Promise<SourceVerdict> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const resolveHost =
    options.resolveHost ??
    (async (host: string): Promise<readonly Address[]> => {
      const addresses = await lookup(host, { all: true });
      return addresses.map((entry) => ({
        address: entry.address,
        family: entry.family,
      }));
    });
  const timeoutMs = options.timeoutMs ?? DEFAULT_VERIFY_TIMEOUT_MS;
  const maxRedirects = options.maxRedirects ?? MAX_VERIFY_REDIRECTS;

  return async (url: string): Promise<SourceVerdict> => {
    let current = validateTarget(url);
    if (!current.ok) return { ok: false, reason: current.error };

    for (let hop = 0; hop <= maxRedirects; hop += 1) {
      const blocked = await hostIsBlocked(current.value, resolveHost);
      if (blocked !== null) return { ok: false, reason: blocked };

      const outcome = await fetchOnce(current.value, fetchImpl, timeoutMs);
      if (outcome.kind === 'verified') return { ok: true };
      if (outcome.kind === 'failed') return { ok: false, reason: outcome.reason };

      // Redirect: resolve the target against the current URL, then re-run the
      // full safety checks before the next fetch (Phase 3: redirect SSRF).
      if (outcome.location === null) {
        return { ok: false, reason: 'source redirected without a location' };
      }
      const nextTarget = validateTarget(
        new URL(outcome.location, current.value).toString(),
      );
      if (!nextTarget.ok) return { ok: false, reason: nextTarget.error };
      current = nextTarget;
    }

    return { ok: false, reason: 'source redirected too many times' };
  };
}
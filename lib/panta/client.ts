/**
 * panta/client — the single HTTP transport for the Panta API.
 *
 * Owns: URL building (origin-safe, trailing-slash-normalized), auth headers
 * (X-Api-Key from server env only), the request timeout, the error-envelope
 * parse, response-schema validation, and the two transport-boundary unit
 * conversions (base-unit string -> UsdcDecimal, ISO -> UnixSeconds).
 * Must not import: React, Next, or any UI module. Server-only in practice —
 * `PANTA_API_KEY` is read only inside `pantaClientFromEnv`.
 *
 * Design rules:
 * - Fail closed: every path returns a `Result`; `ok` only when the response
 *   fully matches its schema. Nothing throws through.
 * - No auto-retry here. `errors.ts` classification is advisory; retry policy is
 *   the caller's, so a permanent error can never be retried in a loop.
 * - The API key is never logged, returned, or forwarded across a redirect.
 *
 * Residual (documented, not closed): response bodies are not size-capped. A
 * route-level body limit is the mitigation and lives in the app layer.
 */
import { z } from 'zod';
import {
  baseUnitsFromJson,
  baseUnitsJsonSchema,
  baseUnitsToUsdcDecimal,
  err,
  ok,
  parsePantaError,
  pantaErrorBodySchema,
  unixSeconds,
  type PantaError,
  type Result,
  type UnixSeconds,
  type UsdcDecimal,
} from '@/types';

/** Default base URL from the docs; overridable via PANTA_API_BASE_URL. */
export const DEFAULT_PANTA_BASE_URL = 'https://live-api.panta.market/api/v1';

/** Requests give up after this long unless overridden. */
export const DEFAULT_PANTA_TIMEOUT_MS = 12_000;

/** A typed transport failure. Adapter failures never throw out of this module. */
export type PantaTransportError =
  | { readonly kind: 'config'; readonly message: string }
  | { readonly kind: 'network'; readonly message: string }
  | { readonly kind: 'timeout'; readonly timeoutMs: number }
  | { readonly kind: 'http'; readonly status: number; readonly error: PantaError }
  | { readonly kind: 'malformed'; readonly status?: number; readonly message: string };

/** Construction options. Injectable fetch keeps the transport testable offline. */
export interface PantaClientConfig {
  readonly apiKey: string;
  readonly baseUrl: string;
  readonly fetchImpl?: typeof fetch;
  readonly timeoutMs?: number;
  /** Default X-User-Id attribution tag when a request does not set one. */
  readonly defaultUserId?: string;
}

/** One call to the Panta API. `schema` validates the 2xx body. */
export interface PantaRequest<TSchema extends z.ZodType> {
  readonly method: 'GET' | 'POST';
  /** Origin-relative pathname, e.g. "/markets/". Trailing slash is added. */
  readonly path: string;
  readonly query?: Readonly<
    Record<string, string | number | boolean | undefined>
  >;
  readonly body?: unknown;
  readonly schema: TSchema;
  readonly userId?: string;
  readonly timeoutMs?: number;
  readonly signal?: AbortSignal;
}

export interface PantaClient {
  readonly request: <TSchema extends z.ZodType>(
    req: PantaRequest<TSchema>,
  ) => Promise<Result<z.output<TSchema>, PantaTransportError>>;
}

// ─── Phase 3 guards ──────────────────────────────────────────────────────────

/**
 * Phase 3 (SSRF / key exfiltration): a path may only be a single-slash
 * origin-relative pathname. No scheme, no `//` protocol-relative form, no
 * backslashes, no whitespace. The origin assertion in buildUrl is a second layer.
 */
const SAFE_PATH = /^\/(?!\/)[A-Za-z0-9\-._~/%]*$/;

/** Phase 3 (path traversal): forbid `.`/`..` segments from escaping the base path. */
const DOT_SEGMENT = /(?:^|\/)\.{1,2}(?:\/|$)/;

/** Phase 3 (header injection): reject CR/LF and other control characters. */
const SAFE_HEADER_VALUE = /^[^\u0000-\u001f\u007f]+$/;

/** Sentinel for "body could not be read/parsed as JSON". */
const UNREADABLE = Symbol('unreadable');

function httpStatusMessage(status: number): string {
  if (status === 401 || status === 403) return 'the Panta API rejected our credentials';
  if (status === 404) return 'the requested Panta resource was not found';
  if (status === 409) return 'the request conflicted with existing state';
  if (status === 413) return 'the request body exceeded the Panta size limit';
  if (status === 429) return 'too many requests to the Panta API';
  if (status >= 500) return 'Panta reported an internal error';
  return 'the Panta API rejected the request';
}

/** Parse Retry-After (seconds). Returns undefined when absent or not a number. */
function parseRetryAfter(header: string | null): number | undefined {
  if (header === null) return undefined;
  const seconds = Number(header.trim());
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : undefined;
}

async function readJsonSafe(
  response: Response,
): Promise<unknown | typeof UNREADABLE> {
  try {
    return await response.json();
  } catch {
    return UNREADABLE;
  }
}

function buildUrl(
  baseUrl: string,
  path: string,
  query: PantaRequest<z.ZodType>['query'],
): Result<URL, PantaTransportError> {
  let base: URL;
  try {
    base = new URL(baseUrl);
  } catch {
    return err({ kind: 'config', message: 'PANTA_API_BASE_URL is not a valid URL' });
  }
  if (!SAFE_PATH.test(path) || DOT_SEGMENT.test(path)) {
    // Phase 3 (SSRF): refuse anything that is not a plain relative path.
    return err({ kind: 'config', message: `unsafe Panta path: ${path}` });
  }
  const normalized = path.endsWith('/') ? path : `${path}/`;
  // Join onto the base PATHNAME, not just the origin: `new URL('/x', base)`
  // would discard the base's own path (e.g. "/api/v1"), sending every call to
  // the wrong endpoint.
  const basePath = base.pathname.replace(/\/+$/, '');
  const url = new URL(`${basePath}${normalized}`, base.origin);
  if (url.origin !== base.origin) {
    // Phase 3 (SSRF): never attach the API key to a foreign origin.
    return err({
      kind: 'config',
      message: 'refusing to send the API key to a foreign origin',
    });
  }
  if (query) {
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }
  }
  return ok(url);
}

export function createPantaClient(config: PantaClientConfig): PantaClient {
  const fetchImpl = config.fetchImpl ?? fetch;
  const defaultTimeoutMs = config.timeoutMs ?? DEFAULT_PANTA_TIMEOUT_MS;

  return {
    request: async <TSchema extends z.ZodType>(
      req: PantaRequest<TSchema>,
    ): Promise<Result<z.output<TSchema>, PantaTransportError>> => {
      const urlResult = buildUrl(config.baseUrl, req.path, req.query);
      if (!urlResult.ok) return err(urlResult.error);
      const url = urlResult.value;

      const userId = req.userId ?? config.defaultUserId;
      if (userId !== undefined && !SAFE_HEADER_VALUE.test(userId)) {
        // Phase 3 (header injection): never let a userId inject a header.
        return err({
          kind: 'config',
          message: 'userId contains characters that are unsafe in a header',
        });
      }

      const timeoutMs = req.timeoutMs ?? defaultTimeoutMs;
      const controller = new AbortController();
      let timedOut = false;
      const timer = setTimeout(() => {
        timedOut = true;
        controller.abort();
      }, timeoutMs);
      const callerSignal = req.signal;
      const onCallerAbort = () => controller.abort();
      if (callerSignal) {
        if (callerSignal.aborted) controller.abort();
        else callerSignal.addEventListener('abort', onCallerAbort, { once: true });
      }

      const headers: Record<string, string> = {
        accept: 'application/json',
        'x-api-key': config.apiKey,
      };
      if (userId !== undefined) headers['x-user-id'] = userId;
      if (req.body !== undefined) headers['content-type'] = 'application/json';

      let response: Response;
      try {
        response = await fetchImpl(url, {
          method: req.method,
          headers,
          body: req.body !== undefined ? JSON.stringify(req.body) : undefined,
          signal: controller.signal,
          // Phase 3 (key exfiltration): never follow a redirect with the key.
          redirect: 'error',
          cache: 'no-store',
        });
      } catch {
        if (timedOut) return err({ kind: 'timeout', timeoutMs });
        // Never surface the underlying error: it can carry request internals.
        return err({ kind: 'network', message: 'network request to Panta failed' });
      } finally {
        clearTimeout(timer);
        callerSignal?.removeEventListener('abort', onCallerAbort);
      }

      const status = response.status;
      const retryAfter = parseRetryAfter(response.headers.get('retry-after'));

      if (!response.ok) {
        const body = await readJsonSafe(response);
        const envelope =
          body === UNREADABLE ? null : pantaErrorBodySchema.safeParse(body);
        const error =
          envelope !== null && envelope.success
            ? parsePantaError(envelope.data, status, retryAfter)
            : parsePantaError(
                { code: `HTTP_${status}`, message: httpStatusMessage(status) },
                status,
                retryAfter,
              );
        return err({ kind: 'http', status, error });
      }

      const body = await readJsonSafe(response);
      if (body === UNREADABLE) {
        return err({
          kind: 'malformed',
          status,
          message: 'Panta returned a non-JSON response',
        });
      }
      const parsed = req.schema.safeParse(body);
      if (!parsed.success) {
        // Fail closed: a body we do not fully understand never reaches the domain.
        return err({
          kind: 'malformed',
          status,
          message: 'Panta response did not match the expected schema',
        });
      }
      return ok(parsed.data);
    },
  };
}

/**
 * Build a client from the server environment. Returns a `config` error when the
 * key is absent rather than throwing, so callers can fail closed at the route.
 */
export function pantaClientFromEnv(
  env: Record<string, string | undefined> = process.env,
): Result<PantaClient, PantaTransportError> {
  const apiKey = env.PANTA_API_KEY;
  if (apiKey === undefined || apiKey.trim().length === 0) {
    return err({ kind: 'config', message: 'PANTA_API_KEY is not set' });
  }
  const baseUrl =
    env.PANTA_API_BASE_URL !== undefined && env.PANTA_API_BASE_URL.length > 0
      ? env.PANTA_API_BASE_URL
      : DEFAULT_PANTA_BASE_URL;
  return ok(createPantaClient({ apiKey, baseUrl }));
}

// ─── Transport-boundary unit conversions ─────────────────────────────────────
// These are the ONLY place wire units become domain units. Doing it here (and
// nowhere else) is what keeps a base-unit/decimal or ISO/unix mix-up from
// reaching the domain (Phase 3: unit confusion).

/** Wire base-unit integer string -> domain decimal USDC. */
export function wireBaseUnitsToUsdc(value: string): UsdcDecimal {
  return baseUnitsToUsdcDecimal(baseUnitsFromJson(baseUnitsJsonSchema.parse(value)));
}

/** Wire ISO-8601 timestamp -> domain UnixSeconds (floored to whole seconds). */
export function wireIsoToUnixSeconds(value: string): UnixSeconds {
  return unixSeconds(Math.floor(Date.parse(value) / 1000));
}

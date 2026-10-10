/**
 * attribution — the {app, surface, campaign} tag and its Panta userId codec.
 *
 * Owns: the Attribution type, the single serializer to a Panta userId string,
 * the single parser back, and the userId length/charset constants.
 * Must not import: domain modules or any framework. Depends on `app-registry`
 * (for AppId/SurfaceId) and `ids`/`result`.
 *
 * The exact Panta userId length/charset limits are UNVERIFIED; both are defined
 * once here so they are easy to change.
 */
import { userIdTagSchema, type UserIdTag } from './ids';
import { err, ok, type Result } from './result';
import { APP_REGISTRY, SURFACES, type AppId, type SurfaceId } from './app-registry';

/** UNVERIFIED: maximum Panta userId length. */
export const USER_ID_MAX_LENGTH = 64;

/** Our userId charset, including the ':' separator. */
export const USER_ID_CHARSET = /^[A-Za-z0-9:_-]+$/;

/** Attribution format version, so the format can evolve safely. */
export const ATTRIBUTION_VERSION = 'v1';

/** A structured attribution tag. */
export interface Attribution {
  readonly app: AppId;
  readonly surface: SurfaceId;
  readonly campaign?: string;
}

/** Why an attribution tag could not be serialized or parsed. */
export interface AttributionError {
  readonly kind: 'too-long' | 'bad-charset' | 'malformed' | 'unknown-app' | 'unknown-surface';
  readonly detail: string;
}

const KNOWN_APPS: ReadonlySet<string> = new Set(Object.keys(APP_REGISTRY));
const KNOWN_SURFACES: ReadonlySet<string> = new Set(SURFACES);

/** Serialize an Attribution to a Panta userId string. */
export function serializeAttribution(
  attribution: Attribution,
): Result<UserIdTag, AttributionError> {
  const segments = [
    'callit',
    ATTRIBUTION_VERSION,
    attribution.app,
    attribution.surface,
  ];
  if (attribution.campaign !== undefined) {
    segments.push(attribution.campaign);
  }
  const id = segments.join(':');
  if (id.length > USER_ID_MAX_LENGTH) {
    return err({ kind: 'too-long', detail: `userId exceeds ${USER_ID_MAX_LENGTH} chars` });
  }
  if (!USER_ID_CHARSET.test(id)) {
    return err({ kind: 'bad-charset', detail: 'userId contains disallowed characters' });
  }
  return ok(userIdTagSchema.parse(id));
}

/** Parse a Panta userId string back into a structured Attribution. */
export function parseAttribution(
  userId: string,
): Result<Attribution, AttributionError> {
  const parts = userId.split(':');
  if (parts.length !== 4 && parts.length !== 5) {
    return err({ kind: 'malformed', detail: 'expected callit:<version>:<app>:<surface>[:<campaign>]' });
  }
  const [prefix, version, appPart, surfacePart, campaignPart] = parts;
  if (prefix !== 'callit' || version !== ATTRIBUTION_VERSION) {
    return err({ kind: 'malformed', detail: 'unrecognised attribution prefix/version' });
  }
  if (appPart === undefined || !KNOWN_APPS.has(appPart)) {
    return err({ kind: 'unknown-app', detail: `unknown app "${appPart ?? ''}"` });
  }
  if (surfacePart === undefined || !KNOWN_SURFACES.has(surfacePart)) {
    return err({ kind: 'unknown-surface', detail: `unknown surface "${surfacePart ?? ''}"` });
  }
  const app = appPart as AppId;
  const surface = surfacePart as SurfaceId;
  return campaignPart === undefined
    ? ok({ app, surface })
    : ok({ app, surface, campaign: campaignPart });
}

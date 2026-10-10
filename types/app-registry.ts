/**
 * app-registry — configuration schemas for apps and surfaces (no runtime).
 *
 * Owns: the allowlist of named operations, the app registration schema, the
 * APP_REGISTRY constant, the surface list, and the AppId/SurfaceId unions
 * derived from them.
 * Must not import: domain modules. Only `compliance` (for the badge literal).
 *
 * Extensibility: adding an app means adding one entry to APP_REGISTRY; adding a
 * surface means adding one string to SURFACES. Neither touches the core domain
 * types or the Panta wire module.
 */
import { z } from 'zod';
import { PANTA_BADGE } from './compliance';

/**
 * The named operations a surface is allowed to perform. This is an allowlist of
 * operations, never arbitrary paths — there is deliberately no open proxy.
 */
export const OPERATION_NAMES = [
  'categories:read',
  'markets:read',
  'market:read',
  'create:image-upload',
  'create:quote',
  'create:build',
  'create:register',
  'buy:quote',
  'buy:build',
  'buy:submit',
  'buy:verify',
  'trades:report',
  'positions:read',
  'claim:build',
  'claim:creator-fees:build',
  'metrics:read',
] as const;
export type OperationName = (typeof OPERATION_NAMES)[number];

/** Per-app budgets, expressed inside Panta's shared 120/60/30/20 limits. */
export const rateBudgetSchema = z.object({
  reads: z.number().int().nonnegative(),
  positions: z.number().int().nonnegative(),
  quotes: z.number().int().nonnegative(),
  builds: z.number().int().nonnegative(),
});
export type RateBudget = z.infer<typeof rateBudgetSchema>;

/** How an app's volume is classified for reporting. */
export const volumeClassSchema = z.enum(['test', 'user']);
export type AppVolumeClass = z.infer<typeof volumeClassSchema>;

/** Configuration for one app/surface integration. */
export const appRegistrationSchema = z.object({
  id: z.string(),
  displayName: z.string(),
  allowedOrigins: z.array(z.string()),
  allowedOperations: z.array(z.enum(OPERATION_NAMES)),
  attributionTag: z.string(),
  rateBudget: rateBudgetSchema,
  requiredBadgeText: z.literal(PANTA_BADGE),
  /** A reference to a per-app key (never the key value). */
  apiKeyRef: z.string().optional(),
  volumeClass: volumeClassSchema,
});
export type AppRegistration = z.infer<typeof appRegistrationSchema>;

/**
 * Known surfaces. Only this list may appear in attribution.
 * (Distinct from AppId: one app may have several surfaces.)
 */
export const SURFACES = [
  'web',
  'share-card',
  'blink',
  'telegram-share',
  'x-post',
  'embed',
  'api',
] as const;
export type SurfaceId = (typeof SURFACES)[number];

/**
 * The registry. Adding an app is a config change here and nothing else. Each
 * app's budget must fit inside the shared Panta account budget.
 */
export const APP_REGISTRY = {
  web: {
    id: 'web',
    displayName: 'Callit web',
    allowedOrigins: ['https://callit.app'],
    allowedOperations: [
      'categories:read',
      'markets:read',
      'market:read',
      'create:image-upload',
      'create:quote',
      'create:build',
      'create:register',
      'buy:quote',
      'buy:build',
      'buy:submit',
      'buy:verify',
      'trades:report',
      'positions:read',
      'claim:build',
      'claim:creator-fees:build',
      'metrics:read',
    ],
    attributionTag: 'web',
    rateBudget: { reads: 100, positions: 50, quotes: 25, builds: 15 },
    requiredBadgeText: PANTA_BADGE,
    apiKeyRef: 'PANTA_API_KEY',
    volumeClass: 'user',
  },
  blink: {
    id: 'blink',
    displayName: 'Callit Blink',
    allowedOrigins: ['https://callit.app'],
    allowedOperations: [
      'market:read',
      'buy:quote',
      'buy:build',
      'buy:submit',
      'trades:report',
    ],
    attributionTag: 'blink',
    rateBudget: { reads: 20, positions: 0, quotes: 5, builds: 5 },
    requiredBadgeText: PANTA_BADGE,
    apiKeyRef: 'PANTA_API_KEY',
    volumeClass: 'user',
  },
} satisfies Record<string, AppRegistration>;

/** The set of known app ids, derived from the registry (registry-driven union). */
export type AppId = keyof typeof APP_REGISTRY;

/**
 * blink — Solana Actions (Blinks) types.
 *
 * Owns: the Actions `GET` metadata, the `POST` request/response, the chained
 * `links.next` callback, and the Actions error shape.
 * Must not import: Panta types or any framework. Blinks are a distribution
 * surface, deliberately decoupled from Panta's wire contract.
 *
 * Note: a Blink `POST` returns a base64 transaction for the wallet to sign. We
 * never add instructions or accounts to Panta's transaction (see `tx`).
 */
import { z } from 'zod';

/** The Solana Actions spec version this surface targets. */
export const actionVersionSchema = z.literal('0');
export type ActionVersion = z.infer<typeof actionVersionSchema>;

/** A linked action (e.g. a GET that opens the market page). */
export const linkedActionSchema = z.object({
  type: z.literal('transaction'),
  href: z.string(),
  label: z.string(),
});
export type LinkedAction = z.infer<typeof linkedActionSchema>;

/** The `GET` metadata response (`type: "action"`). */
export const actionGetResponseSchema = z.object({
  type: z.literal('action'),
  icon: z.string(),
  title: z.string().max(70),
  description: z.string().max(500),
  label: z.string().max(50),
  disabled: z.boolean().optional(),
  links: z.object({ actions: z.array(linkedActionSchema) }).optional(),
});
export type ActionGetResponse = z.infer<typeof actionGetResponseSchema>;

/** The `POST` request body: `{ account }`. */
export const actionPostRequestSchema = z.object({
  account: z.string(),
});
export type ActionPostRequest = z.infer<typeof actionPostRequestSchema>;

/** The `POST` response: an unsigned transaction plus an optional callback link. */
export const actionPostResponseSchema = z.object({
  transaction: z.string(),
  message: z.string().optional(),
  links: z
    .object({ next: z.object({ type: z.literal('post'), href: z.string() }) })
    .optional(),
});
export type ActionPostResponse = z.infer<typeof actionPostResponseSchema>;

/** A Solana Actions error body. */
export const actionErrorSchema = z.object({
  message: z.string(),
});
export type ActionError = z.infer<typeof actionErrorSchema>;

/**
 * One rule in the domain-level `actions.json`.
 *
 * `pathPattern` is the URL a client or crawler may see; `apiPath` is where the
 * Action API for it lives. Both must be absolute URL paths. The spec resolves
 * `pathPattern` before following the URL, so a rule is how a plain share link
 * (no `solana-action:` scheme) is recognised as a Blink at all.
 *
 * Both are validated as single-slash paths here (Phase 3: SSRF/redirect — a
 * rule is a statement about OUR OWN origin; a value that could carry a host or
 * a `//` protocol-relative form would turn actions.json into an open redirect
 * for every Blink client that trusts it).
 */
export const actionRuleSchema = z.object({
  pathPattern: z.string().regex(/^\/(?!\/)[A-Za-z0-9\-._~/**]*$/, 'expected an absolute URL path'),
  apiPath: z.string().regex(/^\/(?!\/)[A-Za-z0-9\-._~/**]*$/, 'expected an absolute URL path'),
});
export type ActionRule = z.infer<typeof actionRuleSchema>;

/** The `actions.json` document: at least one rule, never zero. */
export const actionsJsonSchema = z.object({
  rules: z.array(actionRuleSchema).min(1),
});
export type ActionsJson = z.infer<typeof actionsJsonSchema>;

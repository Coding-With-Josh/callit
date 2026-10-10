/**
 * ids — branded identifiers.
 *
 * Owns: brands + validators for WalletAddress, TxSignature, MarketId, OrderId,
 * QuoteId, CreateId, EventPda, IdempotencyKey, UserIdTag and CampaignTag.
 * Must not import: money, time, or any framework module. Depends only on
 * `wallet` (for Solana address checks) and `result`.
 *
 * Brands make these nominally distinct: a MarketId can never be passed where an
 * OrderId is expected, even though both are strings at runtime.
 */
import { z } from 'zod';
import { isValidSolanaAddress } from './wallet';
import { err, ok, type Result } from './result';

const base58Pattern = /^[1-9A-HJ-NP-Za-km-z]+$/;

/** A validated Solana public key (decodes to exactly 32 bytes). */
export const walletAddressSchema = z
  .string()
  .refine(isValidSolanaAddress, 'invalid Solana address')
  .brand<'WalletAddress'>();
export type WalletAddress = z.infer<typeof walletAddressSchema>;

/** Parse an untrusted string into a WalletAddress without throwing. */
export function parseWalletAddress(
  input: string,
): Result<WalletAddress, string> {
  const parsed = walletAddressSchema.safeParse(input);
  return parsed.success
    ? ok(parsed.data)
    : err('invalid Solana address');
}

/**
 * A base58 transaction signature. Length bounds are UNVERIFIED (a 64-byte
 * signature is ~87-88 base58 chars); the bounds below are deliberately loose.
 */
export const txSignatureSchema = z
  .string()
  .min(64)
  .max(92)
  .regex(base58Pattern, 'invalid base58 transaction signature')
  .brand<'TxSignature'>();
export type TxSignature = z.infer<typeof txSignatureSchema>;

/** A Panta market identifier. Exact format is UNVERIFIED. */
export const marketIdSchema = z
  .string()
  .min(1)
  .max(128)
  .brand<'MarketId'>();
export type MarketId = z.infer<typeof marketIdSchema>;

/** A Panta primary-order identifier. Exact format is UNVERIFIED. */
export const orderIdSchema = z
  .string()
  .min(1)
  .max(128)
  .brand<'OrderId'>();
export type OrderId = z.infer<typeof orderIdSchema>;

/** A Panta primary-quote identifier. Exact format is UNVERIFIED. */
export const quoteIdSchema = z
  .string()
  .min(1)
  .max(128)
  .brand<'QuoteId'>();
export type QuoteId = z.infer<typeof quoteIdSchema>;

/** A Panta create-session identifier. Exact format is UNVERIFIED. */
export const createIdSchema = z
  .string()
  .min(1)
  .max(128)
  .brand<'CreateId'>();
export type CreateId = z.infer<typeof createIdSchema>;

/** A derived oracle event PDA (a Solana address). */
export const eventPdaSchema = z
  .string()
  .refine(isValidSolanaAddress, 'invalid event PDA address')
  .brand<'EventPda'>();
export type EventPda = z.infer<typeof eventPdaSchema>;

/** An idempotency key for build/submit/report operations. */
export const idempotencyKeySchema = z
  .string()
  .min(8)
  .max(128)
  .brand<'IdempotencyKey'>();
export type IdempotencyKey = z.infer<typeof idempotencyKeySchema>;

/**
 * A Panta userId attribution tag. Exact length/charset limits are UNVERIFIED;
 * the serializer in `attribution` enforces a single shared constant.
 */
export const userIdTagSchema = z.string().min(1).brand<'UserIdTag'>();
export type UserIdTag = z.infer<typeof userIdTagSchema>;

/** A campaign tag used in attribution (charset-limited). */
export const campaignTagSchema = z
  .string()
  .regex(/^[A-Za-z0-9_-]+$/, 'campaign tags allow letters, digits, _ and -')
  .max(64)
  .brand<'CampaignTag'>();
export type CampaignTag = z.infer<typeof campaignTagSchema>;

/** Parse an untrusted string into a TxSignature (throws on invalid input). */
export function txSignature(value: string): TxSignature {
  return txSignatureSchema.parse(value);
}

/** Parse an untrusted string into a MarketId (throws on invalid input). */
export function marketId(value: string): MarketId {
  return marketIdSchema.parse(value);
}

/** Parse an untrusted string into an OrderId (throws on invalid input). */
export function orderId(value: string): OrderId {
  return orderIdSchema.parse(value);
}

/** Parse an untrusted string into a QuoteId (throws on invalid input). */
export function quoteId(value: string): QuoteId {
  return quoteIdSchema.parse(value);
}

/** Parse an untrusted string into a UserIdTag (throws on invalid input). */
export function userIdTag(value: string): UserIdTag {
  return userIdTagSchema.parse(value);
}

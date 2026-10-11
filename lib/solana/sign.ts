/**
 * solana/sign — pure, framework-free helpers for the wallet-signing path.
 *
 * Owns:
 *  - decoding a base64 wire transaction (Panta's `unsignedTransactionB64` format)
 *  - the fail-closed "exactly one required signer" gate
 *  - signature extraction from a fully-signed transaction
 *
 * Must not import: React, Next, Privy, or any UI module. Runs in Node (tests)
 * and the browser (client signer hook).
 *
 * Phase 3 (signer substitution / multi-sig laundering): the ONLY thing these
 * helpers extract from untrusted transaction bytes is the fee payer, and it is
 * compared by the caller against the session identity wallet BEFORE the bytes
 * are ever offered to the wallet for signing (see use-solana-signer.ts).
 *
 * @solana/kit 8.4.0 API notes (verified against installed d.ts):
 *  - `getBase64Encoder().encode(b64)` is base64 TEXT -> wire bytes (the
 *    encoder emits bytes; `getBase64Decoder().decode(bytes)` is the inverse).
 *  - `getTransactionDecoder().decode(bytes)` returns a `Transaction`, which is
 *    `{ messageBytes, signatures }` — NOT a decompiled message. To read the
 *    header/static accounts you decode `messageBytes` with
 *    `getCompiledTransactionMessageDecoder`.
 */
import {
  assertIsFullySignedTransaction,
  getBase64Encoder,
  getCompiledTransactionMessageDecoder,
  getSignatureFromTransaction,
  getTransactionDecoder,
} from '@solana/kit';

/**
 * Typed failure for the decode/gate/extract helpers. One class, discriminated
 * `kind`, so callers can map to user-facing errors without string parsing.
 */
export class SolanaSignError extends Error {
  constructor(
    readonly kind: 'decode-failed' | 'not-single-signer' | 'not-fully-signed',
    message: string,
    readonly numRequiredSignatures?: number,
  ) {
    super(message);
    this.name = 'SolanaSignError';
  }
}

const BASE64_RE = /^[A-Za-z0-9+/]*={0,2}$/;

/**
 * Decode a Panta base64 transaction payload into raw wire bytes ready for
 * wallet signing. Throws SolanaSignError('decode-failed') on any garbage —
 * an undecodable payload must never reach the wallet (fail closed). The
 * explicit regex+length check makes the rejection deterministic even if the
 * underlying codec were lenient.
 */
export function decodeUnsignedTransactionB64(b64: string): Uint8Array {
  if (typeof b64 !== 'string' || b64.length === 0) {
    throw new SolanaSignError('decode-failed', 'empty transaction payload');
  }
  if (b64.length % 4 !== 0 || !BASE64_RE.test(b64)) {
    throw new SolanaSignError('decode-failed', 'invalid base64 transaction payload');
  }
  try {
    // base64 text -> wire bytes (encoder direction, see header note). Wrap in a
    // plain Uint8Array so callers can hand bytes straight to the wallet SDK
    // (its `transaction` field is a mutable Uint8Array, not ReadonlyUint8Array).
    return new Uint8Array(getBase64Encoder().encode(b64));
  } catch {
    throw new SolanaSignError('decode-failed', 'invalid base64 transaction payload');
  }
}

/**
 * Gate: the transaction must decode and must require EXACTLY ONE signer. That
 * one signer is `staticAccounts[0]` (the fee payer) which the caller compares
 * against the session identity wallet before signing.
 *
 * Why exactly one: with N required signers, the user's single signature could
 * be laundered into a shared transaction with other (unknown) signers — the
 * user would be authorizing more than they see. Refusing N != 1 is the
 * fail-closed default.
 */
export function getSingleRequiredSigner(bytes: Uint8Array): string {
  let tx;
  let compiled;
  try {
    tx = getTransactionDecoder().decode(bytes);
    compiled = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  } catch {
    throw new SolanaSignError('decode-failed', 'bytes are not a decodable transaction');
  }
  const numRequiredSignatures = compiled.header.numSignerAccounts;
  if (numRequiredSignatures !== 1) {
    throw new SolanaSignError(
      'not-single-signer',
      `expected exactly one required signer, got ${numRequiredSignatures}`,
      numRequiredSignatures,
    );
  }
  const feePayer = compiled.staticAccounts[0];
  if (!feePayer) {
    throw new SolanaSignError('decode-failed', 'transaction has no fee payer');
  }
  return feePayer;
}

/**
 * Extract the base58 transaction signature from signed wire bytes. Rejects
 * anything that did not come back fully signed — a partially-signed result is
 * never usable and must not be treated as success (fail closed).
 */
export function extractSignatureFromSigned(bytes: Uint8Array): string {
  let tx;
  try {
    tx = getTransactionDecoder().decode(bytes);
  } catch {
    throw new SolanaSignError('decode-failed', 'signed bytes are not a decodable transaction');
  }
  try {
    assertIsFullySignedTransaction(tx);
  } catch {
    throw new SolanaSignError('not-fully-signed', 'wallet returned a transaction that is not fully signed');
  }
  return getSignatureFromTransaction(tx);
}
/**
 * solana/sign unit tests.
 *
 * Covers the fail-closed gate: decode failures, exactly-one-required-signer,
 * signature extraction, and rejection of non-fully-signed results.
 *
 * API notes (verified against @solana/kit 8.4.0 d.ts): `assertIsAddress` is an
 * assertion function, `createTransactionMessage` takes `{ version: 0 }`,
 * `setTransactionMessageLifetimeUsingBlockhash` takes a lifetime object,
 * `signTransaction` takes CryptoKeyPairs (from `generateKeyPair`), and
 * base64 text -> bytes is `getBase64Encoder().encode(...)`.
 */
import { describe, expect, it } from 'vitest';
import {
  AccountRole,
  appendTransactionMessageInstruction,
  assertIsAddress,
  assertIsBlockhash,
  compileTransaction,
  createTransactionMessage,
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getSignatureFromTransaction,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  signTransaction,
  type Address,
  type Blockhash,
  type Instruction,
} from '@solana/kit';
import {
  decodeUnsignedTransactionB64,
  extractSignatureFromSigned,
  getSingleRequiredSigner,
  SolanaSignError,
} from './sign';

/** Assert + narrow (assertion functions return void). */
function toAddress(raw: string): Address {
  assertIsAddress(raw);
  return raw as Address;
}

/** Deterministic, structurally-valid dummy blockhash (32-byte base58 string). */
const BLOCKHASH: Blockhash = (() => {
  const raw = '3Jp9C1tKrLdD9r2RQZoTNLKgrT5v9ZxCTAiF9HXhDD3F';
  assertIsBlockhash(raw);
  return raw as Blockhash;
})();

const PAYER = '3Jp9C1tKrLdD9r2RQZoTNLKgrT5v9ZxCTAiF9HXhDD3F';
const SECOND = '8zQRDCnpnpjStPzHb9vz4xTqbvB7vgg5hK41yPY2euif';

/** Build a compiled v0 transaction message; payer is the sole required signer. */
function buildTx(payerAddr: string, extraSignerAddrs: readonly string[] = []) {
  const payer = toAddress(payerAddr);
  const instruction: Instruction = {
    programAddress: toAddress('11111111111111111111111111111111'),
    accounts: [
      { address: payer, role: AccountRole.WRITABLE_SIGNER },
      { address: payer, role: AccountRole.READONLY },
      ...extraSignerAddrs.map((addr) => ({
        address: toAddress(addr),
        role: AccountRole.READONLY_SIGNER,
      })),
    ],
    data: new Uint8Array([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]),
  };
  const message = createTransactionMessage({ version: 0 });
  const withPayer = setTransactionMessageFeePayer(payer, message);
  const withInstruction = appendTransactionMessageInstruction(instruction, withPayer);
  return setTransactionMessageLifetimeUsingBlockhash(
    { blockhash: BLOCKHASH, lastValidBlockHeight: BigInt(0) },
    withInstruction,
  );
}

/** Base64 wire bytes of an UNSIGNED transaction. */
function unsignedB64(payerAddr: string, extraSignerAddrs: readonly string[] = []): string {
  return getBase64EncodedWireTransaction(compileTransaction(buildTx(payerAddr, extraSignerAddrs)));
}

describe('decodeUnsignedTransactionB64', () => {
  it('decodes a valid base64 wire transaction', () => {
    const b64 = unsignedB64(PAYER);
    const bytes = decodeUnsignedTransactionB64(b64);
    expect(bytes.length).toBeGreaterThan(0);
  });

  it('rejects garbage base64 (fail closed)', () => {
    expect(() => decodeUnsignedTransactionB64('!!! not base64 !!!')).toThrowError(
      SolanaSignError,
    );
  });

  it('rejects an empty payload (fail closed)', () => {
    expect(() => decodeUnsignedTransactionB64('')).toThrowError(SolanaSignError);
  });

  it('rejects well-formed base64 that is not a transaction (fail closed)', () => {
    // 'aaaa' is valid base64 for 3 junk bytes; the decoder then rejects it.
    const bytes = decodeUnsignedTransactionB64('aaaa');
    expect(bytes.length).toBe(3);
    expect(() => getSingleRequiredSigner(bytes)).toThrowError(SolanaSignError);
  });
});

describe('getSingleRequiredSigner (signer gate)', () => {
  it('returns the fee payer for a single-signer transaction', () => {
    const bytes = decodeUnsignedTransactionB64(unsignedB64(PAYER));
    expect(getSingleRequiredSigner(bytes)).toBe(PAYER);
  });
});

describe('multi-signer laundering guard', () => {
  it('rejects a transaction requiring more than one signer', () => {
    const bytes = decodeUnsignedTransactionB64(unsignedB64(PAYER, [SECOND]));
    let thrown: unknown;
    try {
      getSingleRequiredSigner(bytes);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SolanaSignError);
    expect((thrown as SolanaSignError).kind).toBe('not-single-signer');
    expect((thrown as SolanaSignError).numRequiredSignatures).toBe(2);
  });
});

describe('extractSignatureFromSigned', () => {
  it('extracts the canonical base58 signature from a fully signed transaction', async () => {
    const signer = await generateKeyPairSigner();
    const signed = await signTransaction(
      [signer.keyPair],
      compileTransaction(buildTx(signer.address)),
    );
    const bytes = getBase64Encoder().encode(getBase64EncodedWireTransaction(signed));

    const signature = extractSignatureFromSigned(new Uint8Array(bytes));
    expect(signature).toBe(getSignatureFromTransaction(signed));
    // ed25519 signature: 64 bytes -> 87-88 base58 chars.
    expect(signature).toMatch(/^[1-9A-HJ-NP-Za-km-z]{86,89}$/);
  });

  it('rejects an unsigned transaction as not fully signed', () => {
    const bytes = decodeUnsignedTransactionB64(unsignedB64(PAYER));
    let thrown: unknown;
    try {
      extractSignatureFromSigned(bytes);
    } catch (e) {
      thrown = e;
    }
    expect(thrown).toBeInstanceOf(SolanaSignError);
    expect((thrown as SolanaSignError).kind).toBe('not-fully-signed');
  });

  it('rejects garbage bytes as undecodable', () => {
    expect(() => extractSignatureFromSigned(new Uint8Array([1, 2, 3]))).toThrowError(
      SolanaSignError,
    );
  });
});
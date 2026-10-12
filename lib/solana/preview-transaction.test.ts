/**
 * solana/preview-transaction unit tests.
 *
 * The builder backs the sign-only preview surfaces (the /dev smoke test and the
 * create wizard's sign step). What must hold: the bytes decode, their only
 * required signer is the fee payer, and the transaction invokes nothing but the
 * System program (a 1-lamport self-transfer).
 */
import { describe, expect, it } from 'vitest';
import {
  getCompiledTransactionMessageDecoder,
  getTransactionDecoder,
  type CompiledTransactionMessage,
} from '@solana/kit';
import { buildPreviewSelfTransferB64 } from './preview-transaction';
import { decodeUnsignedTransactionB64, getSingleRequiredSigner } from './sign';

const PAYER = '3Jp9C1tKrLdD9r2RQZoTNLKgrT5v9ZxCTAiF9HXhDD3F';
const OTHER = '8zQRDCnpnpjStPzHb9vz4xTqbvB7vgg5hK41yPY2euif';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';

/**
 * The compiled-message union also includes the v1 shape, which has no
 * `instructions` array. The preview builder emits a v0 message, so narrow to
 * the variants that DO carry instructions before reading them.
 */
type InstructionsMessage = Extract<
  CompiledTransactionMessage,
  { version: 0 } | { version: 'legacy' }
>;

/** Decode a preview transaction down to its compiled message. */
function compiledMessageOf(b64: string): InstructionsMessage {
  const bytes = decodeUnsignedTransactionB64(b64);
  const tx = getTransactionDecoder().decode(bytes);
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes);
  if (message.version !== 0 && message.version !== 'legacy') {
    throw new Error(`expected a v0/legacy message, got ${String(message.version)}`);
  }
  return message;
}

describe('buildPreviewSelfTransferB64', () => {
  it('builds bytes whose only required signer is the fee payer', () => {
    const b64 = buildPreviewSelfTransferB64(PAYER);
    expect(getSingleRequiredSigner(decodeUnsignedTransactionB64(b64))).toBe(PAYER);
  });

  it('bakes the given wallet in as the signer (no constant fee payer)', () => {
    const b64 = buildPreviewSelfTransferB64(OTHER);
    expect(getSingleRequiredSigner(decodeUnsignedTransactionB64(b64))).toBe(OTHER);
  });

  it('is deterministic for the same payer', () => {
    expect(buildPreviewSelfTransferB64(PAYER)).toBe(buildPreviewSelfTransferB64(PAYER));
  });

  it('invokes only the System program, with the payer as the only signer', () => {
    const compiled = compiledMessageOf(buildPreviewSelfTransferB64(PAYER));
    expect(compiled.staticAccounts[0]).toBe(PAYER);
    const programIds = compiled.instructions.map(
      (ix) => compiled.staticAccounts[ix.programAddressIndex],
    );
    expect(programIds).toEqual([SYSTEM_PROGRAM]);
  });

  it('throws (fail closed) on a malformed fee payer', () => {
    expect(() => buildPreviewSelfTransferB64('not-an-address')).toThrow();
  });
});

/**
 * solana/assemble unit tests — gates 1–5 of the compile pipeline.
 *
 * The POST that calls this is unauthenticated and its output is signed by a
 * stranger's wallet, so these tests pin every fail-closed gate: fee payer /
 * blockhash / height validity, empty-instruction refusal, the exactly-one-
 * signer gate (multi-sig laundering), per-row address and data validation, and
 * the byte-for-byte re-decode of what is actually returned.
 */
import { describe, expect, it } from 'vitest';
import { getBase64Decoder } from '@solana/kit';
import { type WalletAddress } from '@/types';
import { assembleUnsignedTransaction, type AssembleInput } from './assemble';
import { decodeUnsignedTransactionB64, getSingleRequiredSigner } from './sign';

/**
 * Structurally valid 32-byte base58 (usable as an address AND a blockhash).
 * The `as WalletAddress` is type-level only (brands are erased at runtime):
 * assembleUnsignedTransaction's own Gate 1 still validates the string.
 */
const PAYER = '3Jp9C1tKrLdD9r2RQZoTNLKgrT5v9ZxCTAiF9HXhDD3F' as WalletAddress;
const SECOND_SIGNER = '8zQRDCnpnpjStPzHb9vz4xTqbvB7vgg5hK41yPY2euif';
const SYSTEM_PROGRAM = '11111111111111111111111111111111';
const BLOCKHASH = '3Jp9C1tKrLdD9r2RQZoTNLKgrT5v9ZxCTAiF9HXhDD3F';

/** Base64 of the 12-byte system-program transfer blob used in sign.test. */
const DATA_B64 = getBase64Decoder().decode(
  new Uint8Array([2, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0]),
);

interface TestInstruction {
  programId: string;
  data: string;
  accounts: Array<{ pubkey: string; isSigner: boolean; isWritable: boolean }>;
}

/** Raw instructions whose ONLY required signer is `payer`. */
function singleSignerInstructions(payer: string): TestInstruction[] {
  return [
    {
      programId: SYSTEM_PROGRAM,
      data: DATA_B64,
      accounts: [
        { pubkey: payer, isSigner: true, isWritable: true },
        { pubkey: payer, isSigner: false, isWritable: false },
      ],
    },
  ];
}

function baseInput(overrides: Partial<AssembleInput> = {}): AssembleInput {
  return {
    feePayer: PAYER,
    instructions: singleSignerInstructions(PAYER),
    recentBlockhash: BLOCKHASH,
    lastValidBlockHeight: 123,
    ...overrides,
  };
}

describe('assembleUnsignedTransaction gates', () => {
  it('Gate 1: refuses an invalid fee payer (fail closed, no broken tx)', () => {
    // The brand is compile-time only; Gate 1 must still reject this at runtime.
    const r = assembleUnsignedTransaction(baseInput({ feePayer: 'not-an-address' as WalletAddress }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalid-fee-payer');
  });

  it('Gate 2: refuses a malformed blockhash', () => {
    const r = assembleUnsignedTransaction(baseInput({ recentBlockhash: 'zzz' }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalid-blockhash');
  });

  it('refuses a negative or non-integer lastValidBlockHeight', () => {
    for (const height of [-1, Number.NaN, 1.5]) {
      const r = assembleUnsignedTransaction(baseInput({ lastValidBlockHeight: height }));
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error.kind).toBe('invalid-block-height');
    }
  });

  it('refuses an empty instruction list', () => {
    const r = assembleUnsignedTransaction(baseInput({ instructions: [] }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('empty-instructions');
  });

  it('Gate 3: refuses instructions needing a second signer (multi-sig laundering)', () => {
    const instructions: TestInstruction[] = [
      {
        programId: SYSTEM_PROGRAM,
        data: DATA_B64,
        accounts: [
          { pubkey: PAYER, isSigner: true, isWritable: true },
          { pubkey: SECOND_SIGNER, isSigner: true, isWritable: false },
        ],
      },
    ];
    const r = assembleUnsignedTransaction(baseInput({ instructions }));
    expect(r.ok).toBe(false);
    if (!r.ok) {
      expect(r.error.kind).toBe('unexpected-signers');
    }
  });

  it('Gate 4: refuses a malformed program id', () => {
    const instructions = [{ ...singleSignerInstructions(PAYER)[0]!, programId: '..' }];
    const r = assembleUnsignedTransaction(baseInput({ instructions }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalid-instruction');
  });

  it('Gate 4: refuses non-base64 instruction data', () => {
    const instructions = [{ ...singleSignerInstructions(PAYER)[0]!, data: '!!!' }];
    const r = assembleUnsignedTransaction(baseInput({ instructions }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalid-instruction');
  });

  it('Gate 4: refuses a malformed account pubkey', () => {
    const good = singleSignerInstructions(PAYER)[0]!;
    const instructions = [
      {
        ...good,
        // The payer stays the sole signer so the exactly-one-signer gate
        // (Gate 3) passes; the malformed pubkey is a NON-signer so the
        // per-account address validation (Gate 4) is what must fire.
        accounts: [
          { pubkey: PAYER, isSigner: true, isWritable: true },
          { pubkey: 'nope', isSigner: false, isWritable: true },
        ],
      },
    ];
    const r = assembleUnsignedTransaction(baseInput({ instructions }));
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error.kind).toBe('invalid-instruction');
  });

  it('happy path compiles, and the returned bytes require exactly the payer (Gate 5)', () => {
    const r = assembleUnsignedTransaction(baseInput());
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    const bytes = decodeUnsignedTransactionB64(r.value);
    // Gate 5 is the re-decode of the EXACT bytes returned; asserting the single
    // signer here proves what the wallet will actually be asked to sign.
    expect(getSingleRequiredSigner(bytes)).toBe(PAYER);
  });
});
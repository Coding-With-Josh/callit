/**
 * Hidden dev route — REAL external-wallet signing smoke test. Not linked from UI.
 *
 * Builds a minimal self-transfer transaction (1 lamport, payer = the linked
 * wallet), serializes it to Panta's base64 wire format, then signs it through
 * the real path (use-solana-signer -> Privy standard wallet -> the user's
 * external wallet), and shows the resulting base58 signature. Nothing is
 * broadcast.
 *
 * The self-transfer keeps the signer gate happy: exactly one required signer
 * (the fee payer == the wallet being prompted), so this exercises the exact
 * pipeline the create/buy flows use. The builder lives in
 * lib/solana/preview-transaction, shared with the create wizard's sign step.
 */
'use client';

import { useState } from 'react';
import { WalletPill } from '@/components/auth/wallet-pill';
import { useSolanaSigner } from '@/components/auth/use-solana-signer';
import { SOLANA_CLUSTER } from '@/lib/solana/cluster';
import { buildPreviewSelfTransferB64 } from '@/lib/solana/preview-transaction';
import { describeSignRequestError } from '@/lib/solana/sign-messages';
import { formatSignatureShort } from '@/lib/format';

export default function DevPage() {
  const { wallet, connectedAddress, ready, sign } = useSolanaSigner();
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const handleSign = async () => {
    setResult(null);
    setError(null);
    if (!wallet) {
      setError('No linked Solana wallet — link one from the wallet pill.');
      return;
    }
    setBusy(true);
    try {
      const b64 = buildPreviewSelfTransferB64(wallet);
      const out = await sign(b64);
      if (out.ok) {
        setResult(
          `Signed ${formatSignatureShort(out.value.signature)} for ${wallet.slice(0, 6)}… (${SOLANA_CLUSTER} chain)`,
        );
      } else {
        setError(describeSignRequestError(out.error));
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <main className="flex min-h-screen flex-col items-center bg-[#FFF2DD] px-6 pt-40">
      <div className="w-full max-w-xl text-center">
        <h1 className="font-tusker-9800 text-3xl text-[#2D1C00] md:text-4xl">
          Dev: wallet signing
        </h1>
        <p className="mt-3 text-sm tracking-tight text-[#2D1C00]/70">
          Hidden route. Not linked from UI. Signs a 1-lamport self-transfer with
          your own wallet — nothing is broadcast.
        </p>
        <div className="mt-8 flex flex-col items-center gap-4">
          <WalletPill />
          <p className="font-mono text-xs text-[#2D1C00]/60">
            identity: {wallet ? `${wallet.slice(0, 6)}…` : 'none'} · connected:{' '}
            {connectedAddress ? `${connectedAddress.slice(0, 6)}…` : 'none'}
          </p>
          <button
            type="button"
            disabled={busy || !ready}
            onClick={handleSign}
            className="rounded-full bg-[#2D1C00] px-6 py-2.5 text-sm font-semibold tracking-tight text-[#FFF2DD] transition hover:scale-102 active:scale-98 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {busy ? 'Signing…' : 'Sign self-transfer (not broadcast)'}
          </button>
          {result && (
            <p className="font-mono text-xs text-[#2D1C00]/70">{result}</p>
          )}
          {error && (
            <p className="font-mono text-xs text-red-700" role="alert">
              {error}
            </p>
          )}
        </div>
      </div>
    </main>
  );
}
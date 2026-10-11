/**
 * auth/privy-provider — wraps app with PrivyProvider (client).
 *
 * Identity model (decided 2026-10-11, revised 2026-10-11): KEEP Privy as the
 * identity backend, EXTERNAL WALLETS ONLY, WALLET-ONLY login. No email, no
 * Google, no embedded wallet (`createOnLogin: 'off'`): a Privy account's only
 * wallet is one the user connected themselves — the same wallet they can use
 * on X via Blinks.
 *
 * The login UI is NOT Privy's modal: it is our own (components/auth/auth-modal)
 * which signs a headless Privy SIWS message (useLoginWithSiws / useLinkWithSiws)
 * — Privy's documented "SIWS implementation without Privy UIs" flow. This
 * provider config just pins which login methods Privy will accept; the
 * `appearance` block below exists only so any residual Privy surface (e.g. an
 * unexpected modal flash) stays on-brand: cream `#FFF2DD`, brown `#2D1C00`,
 * Tusker wordmark, solana-only wallet list. Two things `appearance` cannot
 * express — the Instrument Sans body font and the rounded-corner scale — are
 * pinned in `app/globals.css` against Privy's DOM ids (`#privy-dialog` /
 * `#privy-modal-content`).
 */
'use client';

import { PrivyProvider } from '@privy-io/react-auth';
import type { PropsWithChildren } from 'react';

/**
 * Brand wordmark for the modal header.
 *
 * MUST be a raw `<svg>` / `<img>` element (or a string URL) — Privy validates
 * `config.appearance.logo` at runtime and rejects a custom React *component*
 * here ("config.appearance.logo must be a string, or an SVG / IMG element.
 * Nothing will be rendered."). So we inline the element (its `type` is the
 * literal "svg") rather than passing `<CallitLogo />` (whose `type` is a
 * function, which fails that check).
 *
 * An inline SVG can use the page's loaded fonts; an `<img>`-referenced SVG
 * cannot, which is why the Tusker wordmark is drawn as `<text>` rather than a
 * font-outlined asset. Kept at module scope so the config identity is stable.
 */
const LOGO = (
  <svg
    width="112"
    height="34"
    viewBox="0 0 112 34"
    role="img"
    aria-label="callit"
    xmlns="http://www.w3.org/2000/svg"
  >
    <text
      x="0"
      y="27"
      fill="currentColor"
      className="font-tusker-9800 text-[#2D1C00]"
      style={{ fontFamily: "var(--font-tusker-9800)" }}
      fontSize="30"
      letterSpacing="-0.02em"
    >
      callit
    </text>
  </svg>
);

export function CallitPrivyProvider({ children }: PropsWithChildren) {
  const appId = process.env.NEXT_PUBLIC_PRIVY_APP_ID;
  if (!appId) {
    throw new Error('NEXT_PUBLIC_PRIVY_APP_ID missing');
  }
  return (
    <PrivyProvider
      appId={appId}
      config={{
        // Wallet-only: the product's identity is a wallet. No email, no
        // Google — the custom modal (auth-modal.tsx) is the only login UI and
        // accepts wallets only.
        loginMethods: ['wallet'],
        appearance: {
          // Cream surface: Privy derives the foreground/border palette from the
          // luminance of this value (high-luminance => light theme).
          theme: '#FFF2DD',
          // Brown buttons, active borders and focus accents.
          accentColor: '#2D1C00',
          logo: LOGO,
          landingHeader: 'Log in to callit',
          loginMessage: 'Back the markets you believe in.',
          // Solana-only: this product settles on Solana, so EVM wallets would be
          // noise. (Offering fewer options, not a weaker check.)
          walletChainType: 'solana-only',
        },
        embeddedWallets: {
          solana: {
            // EXTERNAL WALLETS ONLY. Never mint an embedded (Privy-managed)
            // wallet on login: it is browser-bound, unusable on X, and muddies
            // "one wallet everywhere". Users connect/link their own wallet;
            // the server session mint still independently requires a linked
            // Solana wallet (identity-verifier) and 403s otherwise.
            createOnLogin: 'off',
          },
        },
      }}
    >
      {children}
    </PrivyProvider>
  );
}
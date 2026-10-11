/**
 * auth/privy-provider — wraps app with PrivyProvider (client).
 *
 * Identity model (decided 2026-10-11): KEEP Privy, EXTERNAL WALLETS ONLY.
 * Embedded wallet creation is disabled (`createOnLogin: 'off'`), so a Privy
 * account's only wallet is one the user connected/linked themselves — the same
 * wallet they can use on X via Blinks. Login is wallet-first
 * (`showWalletLoginFirst: true`); email/Google remain as account login, but
 * without a linked wallet the server session mint still 403s `no-wallet`
 * (identity-verifier) — the app is unusable until a wallet is linked, by
 * design, and the UI surfaces a "Link wallet" affordance (wallet-pill).
 *
 * Styling — the `appearance` block maps Privy's login modal onto the Callit
 * palette: cream `#FFF2DD` surface, brown `#2D1C00` accent, and the Tusker
 * wordmark. The two things `appearance` cannot express — the Instrument Sans
 * body font and the rounded-corner scale — are pinned in `app/globals.css`
 * against Privy's DOM ids (`#privy-dialog` / `#privy-modal-content`).
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
        // Wallet first: the product's identity is a wallet; email/Google are
        // conveniences, not the identity.
        loginMethods: ['wallet', 'email', 'google'],
        appearance: {
          // Cream surface: Privy derives the foreground/border palette from the
          // luminance of this value (high-luminance => light theme).
          theme: '#FFF2DD',
          // Brown buttons, active borders and focus accents.
          accentColor: '#2D1C00',
          logo: LOGO,
          landingHeader: 'Log in to callit',
          loginMessage: 'Back the markets you believe in.',
          // Wallet-first login: present the wallet picker before email/social.
          showWalletLoginFirst: true,
          // Solana-only: this product settles on Solana, so EVM wallets would be
          // noise in the picker. (Offering fewer options, not a weaker check.)
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
import type { Metadata, Viewport } from "next";
import { Suspense } from "react";
import { Geist_Mono, Google_Sans_Flex } from "next/font/google";
import localFont from "next/font/local";
import { SmoothScroll } from "@/components/smooth-scroll";
import { CallitPrivyProvider } from "@/components/auth/privy-provider";
import { jsonLd } from "@/lib/seo/jsonld";
import { INDEXABLE_ROBOTS } from "@/lib/seo/robots";
import { SITE } from "@/lib/seo/site";
import "./globals.css";

const instrumentSans = Google_Sans_Flex({
  variable: "--font-instrument-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Tusker Grotesk — one file per numbered family. The runtime variable applied on
// <html> is --tusker-<number>; globals.css maps it to the Tailwind token
// --font-tusker-<number> (utility `font-tusker-<number>`). Keeping the two names
// distinct avoids a self-referential `--font-tusker-x: var(--font-tusker-x)` in
// the theme layer. `weight: "100 900"` lets the single file cover any weight so
// the browser never synthesizes a faux-bold on top of the chosen family.
const tusker6700 = localFont({
  src: "../fonts/TuskerGrotesk-6700Bold.ttf",
  variable: "--tusker-6700",
  weight: "100 900",
  display: "swap",
});

const tusker6800 = localFont({
  src: "../fonts/TuskerGrotesk-6800Super.ttf",
  variable: "--tusker-6800",
  weight: "100 900",
  display: "swap",
});

const tusker7600 = localFont({
  src: "../fonts/TuskerGrotesk-7600Semibold.ttf",
  variable: "--tusker-7600",
  weight: "100 900",
  display: "swap",
});

const tusker7700 = localFont({
  src: "../fonts/TuskerGrotesk-7700Bold.ttf",
  variable: "--tusker-7700",
  weight: "100 900",
  display: "swap",
});

const tusker7800 = localFont({
  src: "../fonts/TuskerGrotesk-7800Super.ttf",
  variable: "--tusker-7800",
  weight: "100 900",
  display: "swap",
});

const tusker8700 = localFont({
  src: "../fonts/TuskerGrotesk-8700Bold.ttf",
  variable: "--tusker-8700",
  weight: "100 900",
  display: "swap",
});

const tusker8800 = localFont({
  src: "../fonts/TuskerGrotesk-8800Super.ttf",
  variable: "--tusker-8800",
  weight: "100 900",
  display: "swap",
});

const tusker9800 = localFont({
  src: "../fonts/TuskerGrotesk-9800Super.ttf",
  variable: "--tusker-9800",
  weight: "100 900",
  display: "swap",
});

const fontVariables = [
  instrumentSans.variable,
  geistMono.variable,
  tusker6700.variable,
  tusker6800.variable,
  tusker7600.variable,
  tusker7700.variable,
  tusker7800.variable,
  tusker8700.variable,
  tusker8800.variable,
  tusker9800.variable,
].join(" ");

const SITE_TITLE = `${SITE.name} — prediction markets you can share`;

/**
 * Search-site verification tags are only emitted when their env vars are set.
 * Spread conditionally so an unset var produces no `<meta>` at all rather than
 * `content="undefined"` (Phase 2: fail-safe default).
 */
const verification = {
  ...(process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION
    ? { google: process.env.NEXT_PUBLIC_GOOGLE_SITE_VERIFICATION }
    : {}),
  ...(process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION
    ? {
        other: {
          "msvalidate.01": process.env.NEXT_PUBLIC_BING_SITE_VERIFICATION,
        },
      }
    : {}),
};

export const metadata: Metadata = {
  // metadataBase resolves every relative canonical/OG URL in the tree to one
  // origin. Without it, Next emits relative og:url values and warns at build
  // (Phase 3: canonical drift).
  metadataBase: new URL(SITE.url),
  title: {
    default: SITE_TITLE,
    // Child routes set the bare page title; this adds the brand.
    template: `%s · ${SITE.name}`,
  },
  description: SITE.description,
  applicationName: SITE.name,
  authors: [{ name: SITE.name, url: SITE.url }],
  creator: SITE.name,
  publisher: SITE.name,
  category: "finance",
  keywords: [
    "prediction markets",
    "YES/NO markets",
    "binary prediction market",
    "forecast markets",
    "Solana",
    "Panta",
  ],
  // Deliberately NO `alternates.canonical` here: a root canonical would be
  // inherited by any route that forgets its own, telling Google that route is a
  // duplicate of "/" (Phase 3: wrong-duplicate). Each indexable route sets its
  // own canonical; this layout only owns the site-wide defaults.
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: SITE_TITLE,
    description: SITE.description,
    url: "/",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: SITE_TITLE,
    description: SITE.description,
    site: "@call_it",
    creator: "@call_it",
  },
  robots: INDEXABLE_ROBOTS,
  formatDetection: { telephone: false, address: false, email: false },
  manifest: "/manifest.webmanifest",
  verification,
};

/** themeColor tints the mobile browser chrome to match the cream shell. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#FFF2DD",
};

/**
 * Organization + WebSite graph. `@id`s let per-page JSON-LD reference the site
 * and publisher without repeating them. Static literals only.
 */
const siteJsonLd = {
  "@context": "https://schema.org",
  "@graph": [
    {
      "@type": "Organization",
      "@id": `${SITE.url}/#organization`,
      name: SITE.name,
      url: SITE.url,
      sameAs: [SITE.socials.x, SITE.socials.github],
    },
    {
      "@type": "WebSite",
      "@id": `${SITE.url}/#website`,
      name: SITE.name,
      url: SITE.url,
      description: SITE.description,
      inLanguage: "en",
      publisher: { "@id": `${SITE.url}/#organization` },
    },
  ],
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${fontVariables} antialiased`}>
      {/* No height on <html>: a pinned html height fights the window scroller
          under Lenis (stuck-scroll vector). body min-h-dvh fills short pages. */}
      <body className="min-h-dvh flex flex-col">
        {/* Structured data (Organization + WebSite). Rendered as a plain data
            script; jsonLd() escapes "<" so no literal can close the tag
            (Phase 3: structured-data injection). */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: jsonLd(siteJsonLd) }}
        />
        <CallitPrivyProvider>{children}</CallitPrivyProvider>
        {/* SmoothScroll reads usePathname() (a runtime URL value). Under
            cacheComponents it must sit in a Suspense boundary or it blocks the
            static shell for every route. It renders null, so the fallback is
            nothing visible — it just streams in after prerender. */}
        <Suspense fallback={null}>
          <SmoothScroll />
        </Suspense>
      </body>
    </html>
  );
}

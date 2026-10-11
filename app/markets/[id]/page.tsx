import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { cache, Suspense } from "react";
import { MarketDetail } from "@/components/market/market-detail";
import { Navbar } from "@/components/sections/navbar";
import { Footer } from "@/components/sections/footer";
import { loadMarketCached } from "@/lib/panta/catalog-cache";
import { jsonLd } from "@/lib/seo/jsonld";
import { INDEXABLE_ROBOTS, NOINDEX_ROBOTS } from "@/lib/seo/robots";
import { SITE, absoluteUrl } from "@/lib/seo/site";

type PageProps = { params: Promise<{ id: string }> };

// Dedupe the metadata + page reads into one upstream call per request. The read
// itself is cross-request cached (loadMarketCached), so a crawler revisiting a
// URL — or a share robot fetching the page and its OG image — does not fan out
// to Panta every time.
const loadMarketOnce = cache((id: string) => loadMarketCached(id));

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const fixture = await loadMarketOnce(id);

  if (!fixture) {
    return {
      title: "Market not found",
      robots: NOINDEX_ROBOTS,
    };
  }

  const { market, provenance, disclaimer } = fixture;

  // Phase 3 (index-state injection): only a genuine live read with no Panta
  // sandbox notice is indexable. A fixture/demo id, or a pk_test read that
  // carries the "test mode" disclaimer, is real content for a human but not a
  // real market — fail closed to noindex.
  const indexable = provenance === "live" && disclaimer === null;

  const description =
    market.description?.trim() ||
    `Back YES or NO on "${market.title}" — a live prediction market on callit.`;

  // Canonical/OG use the requested id (not market.marketId) so the canonical
  // always equals the URL that was fetched — no self-contradicting canonical.
  return {
    title: market.title,
    description,
    alternates: { canonical: `/markets/${id}` },
    openGraph: {
      type: "website",
      siteName: SITE.name,
      title: market.title,
      description,
      url: `/markets/${id}`,
    },
    twitter: {
      card: "summary_large_image",
      title: market.title,
      description,
    },
    robots: indexable ? INDEXABLE_ROBOTS : NOINDEX_ROBOTS,
  };
}

export default function MarketPage({ params }: PageProps) {
  // The shell (navbar + footer) is static; the market streams in. `params` is a
  // runtime value under cacheComponents, so it is awaited INSIDE the Suspense
  // child — awaiting it here would block the static shell. An id that is not a
  // plain slug never reaches the network (see read-adapters::MARKET_ID_PATTERN).
  return (
    <main className="flex-1 w-full bg-[#FFF2DD] font-sans">
      <Navbar />
      <Suspense fallback={<MarketDetailFallback />}>
        <MarketRoute params={params} />
      </Suspense>
      <Footer />
    </main>
  );
}

async function MarketRoute({ params }: PageProps) {
  const { id } = await params;
  const fixture = await loadMarketOnce(id);
  if (!fixture) notFound();

  const { market } = fixture;
  const url = absoluteUrl(`/markets/${id}`);
  const breadcrumb = {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: [
      {
        "@type": "ListItem",
        position: 1,
        name: "Markets",
        item: absoluteUrl("/#browse"),
      },
      { "@type": "ListItem", position: 2, name: market.title, item: url },
    ],
  };
  const webpage = {
    "@context": "https://schema.org",
    "@type": "WebPage",
    name: market.title,
    description: market.description,
    url,
    inLanguage: "en",
    // References the WebSite node emitted in the root layout.
    isPartOf: { "@id": `${SITE.url}/#website` },
    about: { "@type": "Thing", name: market.title },
  };

  return (
    <>
      {/* Phase 3 (structured-data injection): market.title/description originate
          upstream. jsonLd() escapes "<", so no upstream value can close the
          script tag and inject markup. */}
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd([breadcrumb, webpage]) }}
      />
      <MarketDetail fixture={fixture} />
    </>
  );
}

/** Layout-matched placeholder while the live read streams. */
const MarketDetailFallback = () => (
  <div className="mx-auto w-full max-w-6xl px-6 pt-28 pb-24 md:px-12">
    <div className="h-4 w-24 rounded-full bg-[#2D1C00]/5" />
    <div className="mt-8 h-12 w-2/3 rounded-2xl bg-[#2D1C00]/5" />
    <div className="mt-4 h-4 w-1/2 rounded-full bg-[#2D1C00]/5" />
    <div className="mt-10 h-56 w-full rounded-4xl bg-[#2D1C00]/5" />
  </div>
);

import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MarketDetail } from "@/components/market/market-detail";
import { Navbar } from "@/components/sections/navbar";
import { getMarketFixture, listMarketFixtureIds } from "@/lib/market-fixtures";

type PageProps = { params: Promise<{ id: string }> };

// While fixtures stand in for the API, prerender the known ids at build time.
// Unknown ids render on demand and hit the notFound() guard below. (dynamicParams
// is unavailable under nextConfig.cacheComponents.)
export function generateStaticParams(): Array<{ id: string }> {
  return listMarketFixtureIds().map((id) => ({ id }));
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  const { id } = await params;
  const fixture = getMarketFixture(id);
  return {
    title: fixture ? `${fixture.market.title} · callit` : "Market not found · callit",
  };
}

export default async function MarketPage({ params }: PageProps) {
  const { id } = await params;
  const fixture = getMarketFixture(id);

  // Unknown id -> not-found boundary (never a blank or fabricated render).
  // NOTE: under nextConfig.cacheComponents the dynamic fallback streams after
  // the shell commits, so the HTTP status is 200 (soft-404) even though the
  // not-found UI renders. Known fixture ids are prerendered 200. A true 404
  // status needs a middleware/proxy pre-check — tracked in build.md (pre-live).
  if (!fixture) notFound();

  return (
    <main className="flex-1 w-full bg-[#FFF2DD] font-sans">
      <Navbar />
      <MarketDetail fixture={fixture} />
    </main>
  );
}
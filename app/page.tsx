import type { Metadata } from "next";
import { Hero } from "@/components/sections/hero";
import { Navbar } from "@/components/sections/navbar";
import { Browse } from "@/components/sections/browse";
import { About, Faq, FAQ_ITEMS } from "@/components/sections/faq";
import { Footer } from "@/components/sections/footer";
import { jsonLd } from "@/lib/seo/jsonld";

/**
 * The only indexable page's canonical. Every other route sets its own; the root
 * layout intentionally sets none (see app/layout.tsx).
 */
export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

/**
 * FAQPage built from the exact FAQ_ITEMS the Faq component renders, so the
 * markup and the visible copy can never drift (Phase 3: structured-data/visible
 * mismatch). Escaped by jsonLd() before it reaches the DOM.
 */
const faqJsonLd = {
  "@context": "https://schema.org",
  "@type": "FAQPage",
  mainEntity: FAQ_ITEMS.map((item) => ({
    "@type": "Question",
    name: item.q,
    acceptedAnswer: { "@type": "Answer", text: item.a },
  })),
};

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center font-sans max-w-screen min-h-screen bg-[#FFF2DD]">
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: jsonLd(faqJsonLd) }}
      />
      <Navbar />
      <Hero />
      <Browse />
      <About />
      <Faq />
      <Footer />
    </div>
  );
}

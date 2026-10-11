/**
 * faq — server-rendered definitional content and the single source for the
 * homepage FAQPage structured data.
 *
 * Why a server component (not client): the copy must be in the initial HTML for
 * crawlers and answer engines. Every answer here is a definition ("what is a
 * prediction market", "what does a 62¢ YES share mean") rather than a product
 * claim — factual, verifiable, and stable enough to be cited.
 *
 * `FAQ_ITEMS` is exported so the page's JSON-LD is generated from the exact same
 * strings that are visible on the page (Phase 3: structured-data/visible-copy
 * mismatch is a spam signal).
 */

export interface FaqItem {
  readonly q: string;
  readonly a: string;
}

export const FAQ_ITEMS: readonly FaqItem[] = [
  {
    q: "What is a prediction market?",
    a: "A prediction market lets people trade on the outcome of a future event. Buying a Yes share pays out if the event happens; a No share pays out if it does not. The price of a share is the market's live estimate of the probability.",
  },
  {
    q: "What does the price of a Yes share mean?",
    a: "A Yes share priced at $0.62 implies roughly a 62% chance that the event happens. Prices are set by Panta's automated market maker and move as people trade.",
  },
  {
    q: "How do Yes and No shares work?",
    a: "Every market is binary. Yes and No shares on the same market are complementary: if the answer resolves Yes, Yes shares pay $1 and No shares pay $0. If it resolves No, the reverse.",
  },
  {
    q: "How are markets resolved?",
    a: "Resolution is determined by Panta's oracle against the sources of truth published alongside the market. callit displays the rule Panta publishes; it does not adjudicate outcomes itself.",
  },
  {
    q: "What does 'Powered by Panta' mean?",
    a: "Prices, liquidity and settlement for every market are provided by Panta. callit is the marketplace and social layer on top — the place you browse a market, read its odds, and share it.",
  },
  {
    q: "Do I need a crypto wallet to look at markets?",
    a: "No. Anyone can browse markets and read the live odds. Taking a side requires a Solana wallet.",
  },
];

/** A short definitional intro. Sits above the FAQ on the landing page. */
export const About = () => (
  <section
    id="about"
    aria-label="About callit"
    className="mx-auto w-full max-w-3xl px-6 py-16 md:px-12 md:py-20"
  >
    <h2 className="font-tusker-9800 text-3xl tracking-tight text-[#2D1C00] md:text-4xl">
      What is callit?
    </h2>
    <p className="mt-4 text-sm font-medium leading-relaxed tracking-tight text-[#2D1C00]/70 md:text-base">
      callit is a marketplace for binary prediction markets. Every market is one
      question with two sides — Yes and No — and a live price that reflects the
      crowd&apos;s estimate of the odds. You can browse the catalog and read the
      odds without an account; backing a side takes a Solana wallet.
    </p>
    <p className="mt-3 text-sm font-medium leading-relaxed tracking-tight text-[#2D1C00]/70 md:text-base">
      Prices, liquidity and settlement are provided by Panta. callit is the layer
      on top: the place a market is written, shared as a link, and understood at a
      glance.
    </p>
  </section>
);

/** The visible FAQ. Rendered on the landing page; FAQ_ITEMS drives its JSON-LD. */
export const Faq = () => (
  <section
    id="faq"
    aria-label="Frequently asked questions"
    className="mx-auto w-full max-w-3xl px-6 pb-24 md:px-12"
  >
    <h2 className="font-tusker-9800 text-3xl tracking-tight text-[#2D1C00] md:text-4xl">
      Questions, answered
    </h2>
    <dl className="mt-8 flex flex-col">
      {FAQ_ITEMS.map((item) => (
        <div key={item.q} className="border-t border-[#2D1C00]/10 py-6">
          <dt className="font-tusker-7700 text-lg tracking-tight text-[#2D1C00] md:text-xl">
            {item.q}
          </dt>
          <dd className="mt-2 text-sm font-medium leading-relaxed tracking-tight text-[#2D1C00]/70 md:text-base">
            {item.a}
          </dd>
        </div>
      ))}
    </dl>
  </section>
);

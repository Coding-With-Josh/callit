import Link from "next/link";
import { Navbar } from "@/components/sections/navbar";
import { Footer } from "@/components/sections/footer";

/** Segment-level 404 for unknown market ids (renders with a real 404 status). */
export default function MarketNotFound() {
  return (
    <main className="flex-1 w-full bg-[#FFF2DD] px-6 pt-40 pb-24 font-sans">
      <Navbar />
      <div className="mx-auto max-w-xl text-center">
        <h1 className="text-3xl font-tusker-9800 text-[#2D1C00] md:text-4xl">
          Market not found
        </h1>
        <p className="mt-3 text-sm leading-relaxed tracking-tight text-[#2D1C00]/70 md:text-base">
          This market doesn&apos;t exist or was removed. The link may be stale,
          or the market id is wrong.
        </p>
        <Link
          href="/#browse"
          className="mt-6 inline-flex items-center justify-center rounded-full bg-[#2D1C00] px-6 py-2.5 text-sm font-semibold tracking-tight text-white transition hover:scale-102 active:scale-98"
        >
          Browse markets
        </Link>
      </div>
      <Footer />
    </main>
  );
}
import type { Metadata } from "next";
import { CreateWizard } from "@/components/create/create-wizard";
import { Navbar } from "@/components/sections/navbar";
import { SITE } from "@/lib/seo/site";

const DESCRIPTION =
  "Turn a claim into a prediction market people can back with YES or NO. Draft it, check it resolves, see the fee, then share the link.";

export const metadata: Metadata = {
  // Rendered by the root template as "Create a market · callit".
  title: "Create a market",
  description: DESCRIPTION,
  alternates: { canonical: "/create" },
  openGraph: {
    type: "website",
    siteName: SITE.name,
    title: `Create a market · ${SITE.name}`,
    description: DESCRIPTION,
    url: "/create",
  },
  twitter: {
    card: "summary_large_image",
    title: `Create a market · ${SITE.name}`,
    description: DESCRIPTION,
  },
};

export default function CreatePage() {
  return (
    <main className="flex-1 w-full bg-[#FFF2DD] font-sans">
      <Navbar />
      <CreateWizard />
    </main>
  );
}

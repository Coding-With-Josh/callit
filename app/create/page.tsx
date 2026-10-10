import type { Metadata } from "next";
import { CreateWizard } from "@/components/create/create-wizard";
import { Navbar } from "@/components/sections/navbar";

export const metadata: Metadata = {
  title: "Create a market · callit",
  description:
    "Turn a claim into a Panta prediction market: draft it, check it resolves, see the fee, then sign.",
};

export default function CreatePage() {
  return (
    <main className="flex-1 w-full bg-[#FFF2DD] font-sans">
      <Navbar />
      <CreateWizard />
    </main>
  );
}

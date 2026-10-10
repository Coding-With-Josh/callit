import { Hero } from "@/components/sections/hero";
import { Navbar } from "@/components/sections/navbar";
import { Browse } from "@/components/sections/browse";
import Image from "next/image";

export default function Home() {
  return (
    <div className="flex flex-col flex-1 items-center justify-center font-sans max-w-screen min-h-screen bg-[#FFF2DD]">
      <Navbar />
      <Hero />
      <Browse />
    </div>
  );
}

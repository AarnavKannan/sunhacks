import { AssistantSection } from "@/components/AssistantSection";
import { Bento } from "@/components/Bento";
import { DownloadSection } from "@/components/DownloadSection";
import { Evidence } from "@/components/Evidence";
import { FAQ } from "@/components/FAQ";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { Manifesto } from "@/components/Manifesto";
import { Nav } from "@/components/Nav";
import { Marquee, TrustBar } from "@/components/TrustBar";
import { Workflow } from "@/components/Workflow";
import { useReveal } from "@/lib/hooks";

export default function App() {
  useReveal();

  return (
    <>
      <a className="skip-link" href="#product">Skip to content</a>
      <Nav />
      <main>
        <Hero />
        <TrustBar />
        <Manifesto />
        <Marquee />
        <Bento />
        <Evidence />
        <Workflow />
        <AssistantSection />
        <DownloadSection />
        <FAQ />
      </main>
      <Footer />
    </>
  );
}

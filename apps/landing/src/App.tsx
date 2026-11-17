import { AssistantSection } from "@/components/AssistantSection";
import { DownloadSection } from "@/components/DownloadSection";
import { FAQ } from "@/components/FAQ";
import { Footer } from "@/components/Footer";
import { Hero } from "@/components/Hero";
import { Nav } from "@/components/Nav";
import { Workflow } from "@/components/Workflow";

export default function App() {
  return (
    <>
      <a className="skip-link" href="#workflow">Skip to content</a>
      <Nav />
      <main>
        <Hero />
        <Workflow />
        <AssistantSection />
        <DownloadSection />
        <FAQ />
      </main>
      <Footer />
    </>
  );
}

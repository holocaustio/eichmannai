import Link from 'next/link';
import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: "About",
  description: "When survivors became witnesses. Learn about this digital archive preserving the testimonies from the 1961 Eichmann Trial in Jerusalem.",
  openGraph: {
    title: "About | The Eichmann Trial",
    description: "When survivors became witnesses. Learn about this digital archive preserving the testimonies from the 1961 Eichmann Trial.",
  },
};

export default function AboutPage() {
  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="py-20 px-6 border-b border-stone-900">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-4">About This Archive</p>
          <h1 className="font-serif text-4xl md:text-5xl font-light mb-6">
            When Survivors Became Witnesses
          </h1>
          <p className="text-stone-400 text-lg max-w-3xl mx-auto leading-relaxed">
            The Eichmann Trial placed Holocaust testimony at the center of a public proceeding 
            for the first time. This archive preserves that moment.
          </p>
        </div>
      </section>

      {/* A Personal Note */}
      <section className="py-20 px-6 border-b border-stone-900 bg-gradient-to-b from-stone-900/50 to-stone-950">
        <div className="max-w-3xl mx-auto">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-6 text-center">Why I Built This</p>
          
          <div className="space-y-6 text-stone-400 text-lg leading-relaxed font-light">
            <p>
              My name is Alon Carmel.
            </p>
            
            <p>
              My grandfather, <span className="text-stone-200">Israel Carmel</span>, was one of the witnesses 
              who testified at the Eichmann Trial. He stood in that courtroom in Jerusalem in 1961 and 
              spoke about what he saw, what he survived, what he carried with him.
            </p>
            
            <p>
              Growing up, I heard fragments of his story. Some at family gatherings. Some in the silences 
              between words. But it wasn&apos;t until I began reading the trial transcripts that I truly heard 
              his voice, and the voices of over a hundred others who testified alongside him.
            </p>
            
            <p>
              I built this project because I believe these voices deserve to be heard. Not summarized. 
              Not simplified. But preserved, accessible, and honored for what they are: the testimony 
              of those who witnessed history&apos;s darkest chapter and chose to speak.
            </p>
            
            <p>
              This archive is my way of ensuring that my grandfather&apos;s testimony, and the testimonies 
              of all who stood in that courtroom, remain alive for future generations.
            </p>
            
            <p className="text-stone-300 italic pt-4">
              For my grandfather. For all the witnesses. And for everyone who will listen.
            </p>
            
            <p className="text-stone-500 text-base pt-6">
              Alon Carmel
            </p>
          </div>
        </div>
      </section>

      {/* The Significance */}
      <section className="py-16 px-6 border-b border-stone-900">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl font-light mb-8">A Turning Point</h2>
          <div className="space-y-6 text-stone-400 text-lg leading-relaxed">
            <p>
              Before Jerusalem, the Holocaust was documented through Nazi records and official proceedings. 
              Survivors carried their memories privately. Public testimony was rare.
            </p>
            <p>
              The Eichmann Trial changed this. More than one hundred witnesses testified before the court. 
              Their testimonies addressed events across ghettos, deportations, camps, and daily life under 
              Nazi rule—stories that had never been told in a public forum.
            </p>
            <p>
              The trial placed survivor testimony at the center of a major criminal proceeding, presented 
              publicly and broadcast to the world. It marked a shift in how the Holocaust would be remembered: 
              not only through documents, but through voices.
            </p>
          </div>
        </div>
      </section>

      {/* The Record */}
      <section className="py-16 px-6 border-b border-stone-900 bg-stone-900/30">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl font-light mb-8">The Historical Record</h2>
          <div className="space-y-6 text-stone-400 text-lg leading-relaxed mb-12">
            <p>
              The proceedings extended over several months and generated one of the most comprehensive 
              trial records related to the Holocaust.
            </p>
          </div>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6">
            <div className="text-center p-6 border border-stone-800 bg-stone-900/50">
              <p className="font-serif text-4xl text-stone-200 mb-2">110+</p>
              <p className="text-stone-500 text-sm">Witnesses</p>
            </div>
            <div className="text-center p-6 border border-stone-800 bg-stone-900/50">
              <p className="font-serif text-4xl text-stone-200 mb-2">121</p>
              <p className="text-stone-500 text-sm">Sessions</p>
            </div>
            <div className="text-center p-6 border border-stone-800 bg-stone-900/50">
              <p className="font-serif text-4xl text-stone-200 mb-2">75</p>
              <p className="text-stone-500 text-sm">Volumes</p>
            </div>
            <div className="text-center p-6 border border-stone-800 bg-stone-900/50">
              <p className="font-serif text-4xl text-stone-200 mb-2">1000s</p>
              <p className="text-stone-500 text-sm">Pages</p>
            </div>
          </div>
        </div>
      </section>

      {/* This Archive */}
      <section className="py-16 px-6 border-b border-stone-900">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl font-light mb-8">This Digital Archive</h2>
          <div className="space-y-6 text-stone-400 text-lg leading-relaxed">
            <p>
              This archive brings together trial transcripts, witness testimony, legal proceedings, 
              and supporting materials, and makes them accessible through a structured digital experience.
            </p>
            <p>
              The goal is to allow visitors to observe, study, and understand the trial as it unfolded—and 
              through it, to hear the voices of those who testified.
            </p>
            <p className="text-stone-300 border-l-2 border-stone-700 pl-6 py-2 italic">
              Primary sources remain central. Digital tools support access, navigation, and comprehension.
            </p>
          </div>
        </div>
      </section>

      {/* What's Included */}
      <section className="py-16 px-6 border-b border-stone-900 bg-stone-900/30">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl font-light mb-8">What the Archive Includes</h2>
          
          <div className="grid gap-4">
            <div className="flex gap-4 items-start p-4 border border-stone-800 bg-stone-900/20">
              <span className="text-amber-500 mt-1">•</span>
              <p className="text-stone-400">Full trial transcripts across all 75 volumes</p>
            </div>
            <div className="flex gap-4 items-start p-4 border border-stone-800 bg-stone-900/20">
              <span className="text-amber-500 mt-1">•</span>
              <p className="text-stone-400">Testimony from over 110 witnesses</p>
            </div>
            <div className="flex gap-4 items-start p-4 border border-stone-800 bg-stone-900/20">
              <span className="text-amber-500 mt-1">•</span>
              <p className="text-stone-400">Structured witness profiles with biographical and contextual information</p>
            </div>
            <div className="flex gap-4 items-start p-4 border border-stone-800 bg-stone-900/20">
              <span className="text-amber-500 mt-1">•</span>
              <p className="text-stone-400">Linked entities: people, places, organizations, and events mentioned across testimonies</p>
            </div>
            <div className="flex gap-4 items-start p-4 border border-stone-800 bg-stone-900/20">
              <span className="text-amber-500 mt-1">•</span>
              <p className="text-stone-400">A navigable representation of the trial structure and proceedings</p>
            </div>
          </div>
          
          <p className="text-stone-500 text-sm mt-6 italic">
            All content is grounded in the original historical record.
          </p>
        </div>
      </section>

      {/* Exploring */}
      <section className="py-16 px-6 border-b border-stone-900">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl font-light mb-8">Exploring the Trial</h2>
          <p className="text-stone-400 text-lg leading-relaxed mb-8">
            Visitors can explore the archive in multiple ways:
          </p>
          
          <div className="grid md:grid-cols-2 gap-6">
            <div className="p-6 border border-stone-800 bg-stone-900/50">
              <h3 className="text-stone-200 font-medium mb-2">Through the Witnesses</h3>
              <p className="text-stone-500 text-sm">
                Browse individual testimonies and discover who testified and what they experienced
              </p>
            </div>
            <div className="p-6 border border-stone-800 bg-stone-900/50">
              <h3 className="text-stone-200 font-medium mb-2">Through Connections</h3>
              <p className="text-stone-500 text-sm">
                Navigate links between witnesses, locations, events, and the people they mentioned
              </p>
            </div>
            <div className="p-6 border border-stone-800 bg-stone-900/50">
              <h3 className="text-stone-200 font-medium mb-2">Sequentially</h3>
              <p className="text-stone-500 text-sm">
                Follow the trial as it unfolded, from opening statement to verdict
              </p>
            </div>
            <div className="p-6 border border-stone-800 bg-stone-900/50">
              <h3 className="text-stone-200 font-medium mb-2">Across Testimonies</h3>
              <p className="text-stone-500 text-sm">
                View related testimony through linked entities and cross-references
              </p>
            </div>
          </div>
          
          <p className="text-stone-500 text-sm mt-8">
            The archive is designed for readers without prior legal training and does not require 
            familiarity with the trial.
          </p>
        </div>
      </section>

      {/* AI Assisted Viewing */}
      <section className="py-16 px-6 border-b border-stone-900 bg-stone-900/30">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl font-light mb-8">AI Assisted Viewing</h2>
          <p className="text-stone-400 text-lg leading-relaxed mb-8">
            The archive offers an optional AI assisted viewing mode designed to support understanding 
            of complex and lengthy testimony.
          </p>
          
          <div className="bg-stone-900/50 border border-stone-800 p-8 mb-8">
            <p className="text-stone-300 mb-4">When enabled, the guide can:</p>
            <ul className="space-y-3 text-stone-400">
              <li className="flex gap-3">
                <span className="text-amber-500">→</span>
                Summarize sections of testimony
              </li>
              <li className="flex gap-3">
                <span className="text-amber-500">→</span>
                Clarify legal and procedural context
              </li>
              <li className="flex gap-3">
                <span className="text-amber-500">→</span>
                Highlight key themes and references
              </li>
              <li className="flex gap-3">
                <span className="text-amber-500">→</span>
                Connect testimony across witnesses and trial phases
              </li>
            </ul>
          </div>
          
          <div className="border-l-2 border-amber-700 pl-6 py-2">
            <p className="text-stone-400 leading-relaxed">
              The AI does not replace primary sources, does not speak in the voices of witnesses, 
              and does not interpret events beyond the historical record. Its function is to assist 
              navigation and comprehension—not to author or judge the material.
            </p>
          </div>
          
          <p className="text-stone-500 text-sm mt-6">
            AI assisted viewing can be enabled or disabled at any time.
          </p>
        </div>
      </section>

      {/* Approach */}
      <section className="py-16 px-6 border-b border-stone-900">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl font-light mb-8">Our Approach</h2>
          <div className="space-y-6 text-stone-400 text-lg leading-relaxed">
            <p>
              This project presents the Eichmann Trial as a historical proceeding and preserves 
              the testimonies as they were given.
            </p>
            <p>
              It does not recreate events, dramatize testimony, or offer speculative interpretation. 
              The emphasis remains on the witnesses and what they chose to share—supported by modern 
              tools that make their words accessible.
            </p>
            <p className="text-stone-500">
              Sources, methodology, and AI usage are documented transparently.
            </p>
          </div>
        </div>
      </section>

      {/* Begin Exploring */}
      <section className="py-16 px-6 border-b border-stone-900 bg-stone-900/30">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-serif text-3xl font-light mb-12">Begin Exploring</h2>
          
          <div className="grid md:grid-cols-2 gap-6 max-w-2xl mx-auto">
            <Link 
              href="/witnesses" 
              className="p-6 border border-stone-700 hover:border-stone-500 hover:bg-stone-900/50 transition-all group"
            >
              <p className="text-stone-200 font-medium mb-2 group-hover:text-white">Meet the Witnesses</p>
              <p className="text-stone-500 text-sm">Hear from those who testified</p>
            </Link>
            
            <Link 
              href="/explore" 
              className="p-6 border border-stone-700 hover:border-stone-500 hover:bg-stone-900/50 transition-all group"
            >
              <p className="text-stone-200 font-medium mb-2 group-hover:text-white">Explore Connections</p>
              <p className="text-stone-500 text-sm">Navigate people, places, and events</p>
            </Link>
          </div>
        </div>
      </section>

      {/* Acknowledgments */}
      <section className="py-16 px-6 border-b border-stone-900">
        <div className="max-w-3xl mx-auto text-center">
          <h2 className="font-serif text-3xl font-light mb-8">Acknowledgments</h2>
          
          <div className="space-y-4 text-stone-400">
            <p>
              <strong className="text-stone-200">Yad Vashem</strong> — For maintaining the official 
              witness list and historical records
            </p>
            <p>
              <strong className="text-stone-200">Israel State Archives</strong> — For digitizing and 
              hosting the trial transcripts
            </p>
            <p>
              <strong className="text-stone-200">The Witnesses</strong> — Whose courage in 
              testifying preserved history for future generations
            </p>
          </div>
        </div>
      </section>

      {/* Dedication */}
      <section className="py-20 px-6">
        <div className="max-w-2xl mx-auto text-center">
          <blockquote className="font-serif text-xl md:text-2xl text-stone-300 font-light italic leading-relaxed">
            &quot;This project is dedicated to the memory of the six million Jews murdered in the 
            Holocaust, and to the survivors whose testimonies ensure we never forget.&quot;
          </blockquote>
        </div>
      </section>

      {/* Footer */}
      <footer className="py-12 px-6 border-t border-stone-900">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-stone-600 text-sm">
            The Eichmann Trial Digital Archive • December 2025
          </p>
        </div>
      </footer>
    </main>
  );
}

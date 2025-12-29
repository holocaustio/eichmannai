export default function AboutPage() {
  return (
    <main className="min-h-screen">
      {/* Hero */}
      <section className="py-20 px-6 border-b border-stone-900">
        <div className="max-w-4xl mx-auto text-center">
          <p className="text-stone-600 text-xs tracking-[0.3em] uppercase mb-4">About This Project</p>
          <h1 className="font-serif text-4xl md:text-5xl font-light mb-6">
            Building a Digital Archive
          </h1>
          <p className="text-stone-400 text-lg max-w-2xl mx-auto">
            The journey of creating a searchable archive of all 108 witness testimonies 
            from the Adolf Eichmann trial (1961).
          </p>
        </div>
      </section>

      {/* Mission */}
      <section className="py-16 px-6 border-b border-stone-900">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl font-light mb-8">Our Mission</h2>
          <div className="space-y-6 text-stone-400 text-lg leading-relaxed">
            <p>
              The Eichmann trial was groundbreaking—the first trial broadcast globally on television, 
              where 108 Holocaust survivors testified publicly across 121 court sessions.
            </p>
            <p>
              The trial transcripts exist primarily as scanned PDFs in Hebrew, spread across multiple 
              volumes totaling over 25,000 pages. No structured, searchable database of individual 
              testimonies existed.
            </p>
            <p>
              Our mission was to extract, structure, and present each of the 108 witness testimonies 
              in a modern, accessible web interface—preserving the voices of survivors for future generations.
            </p>
          </div>
        </div>
      </section>

      {/* The Journey */}
      <section className="py-16 px-6 border-b border-stone-900 bg-stone-900/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-serif text-3xl font-light mb-12 text-center">The Journey</h2>
          
          <div className="space-y-12">
            {/* Phase 1 */}
            <div className="flex gap-6">
              <div className="flex-shrink-0 w-12 h-12 border border-stone-700 flex items-center justify-center text-stone-400 font-serif text-xl">
                1
              </div>
              <div>
                <h3 className="text-xl text-stone-200 mb-3">Data Acquisition</h3>
                <p className="text-stone-400 leading-relaxed">
                  We began by identifying and downloading the trial materials from Yad Vashem&apos;s 
                  digital archives and the Israel State Archives. This involved web scraping PDFs 
                  hosted on government archive servers—multiple volumes (Vol 1-4) covering all 121 
                  sessions, with files ranging from 50MB to 200MB each.
                </p>
              </div>
            </div>

            {/* Phase 2 */}
            <div className="flex gap-6">
              <div className="flex-shrink-0 w-12 h-12 border border-stone-700 flex items-center justify-center text-stone-400 font-serif text-xl">
                2
              </div>
              <div>
                <h3 className="text-xl text-stone-200 mb-3">The OCR Challenge</h3>
                <p className="text-stone-400 leading-relaxed mb-4">
                  The trial transcripts presented unique challenges: scanned documents (not native digital text), 
                  Hebrew text (right-to-left with complex typography), multi-column layouts, mixed content 
                  (Hebrew, English, German), and varying quality.
                </p>
                <p className="text-stone-400 leading-relaxed">
                  We tried multiple OCR approaches—Tesseract OCR, Adobe Acrobat, Google Cloud Vision API, 
                  and Google Document AI. Each had limitations: poor Hebrew recognition, column text merged 
                  incorrectly, or prohibitive costs at scale.
                </p>
              </div>
            </div>

            {/* Phase 3 */}
            <div className="flex gap-6">
              <div className="flex-shrink-0 w-12 h-12 border border-amber-700 flex items-center justify-center text-amber-400 font-serif text-xl">
                3
              </div>
              <div>
                <h3 className="text-xl text-stone-200 mb-3">The Breakthrough</h3>
                <p className="text-stone-400 leading-relaxed">
                  After multiple failed OCR attempts, we discovered something crucial: 
                  <span className="text-amber-400"> the PDFs already contained embedded text!</span> The 
                  scanned documents had been OCR&apos;d at some point and the text was embedded as a hidden 
                  layer. A simple <code className="bg-stone-800 px-2 py-0.5 text-stone-300">pdftotext</code> command 
                  extracted clean, properly ordered Hebrew text in seconds—what would have cost thousands 
                  of dollars and taken weeks with commercial OCR.
                </p>
              </div>
            </div>

            {/* Phase 4 */}
            <div className="flex gap-6">
              <div className="flex-shrink-0 w-12 h-12 border border-stone-700 flex items-center justify-center text-stone-400 font-serif text-xl">
                4
              </div>
              <div>
                <h3 className="text-xl text-stone-200 mb-3">Entity Extraction</h3>
                <p className="text-stone-400 leading-relaxed">
                  We built a hybrid AI pipeline to extract and classify all entities mentioned in the trial: 
                  witnesses, persons (Nazi officials, victims, relatives), locations (camps, ghettos, cities), 
                  organizations (SS, Gestapo, Jewish councils), and documents. We combined DictaBERT 
                  (a Hebrew BERT NER model) for initial entity detection with OpenAI GPT-4 for consolidation 
                  and relationship mapping.
                </p>
              </div>
            </div>

            {/* Phase 5 */}
            <div className="flex gap-6">
              <div className="flex-shrink-0 w-12 h-12 border border-stone-700 flex items-center justify-center text-stone-400 font-serif text-xl">
                5
              </div>
              <div>
                <h3 className="text-xl text-stone-200 mb-3">Testimony Extraction</h3>
                <p className="text-stone-400 leading-relaxed">
                  The core challenge: extract exactly one witness&apos;s testimony—starting when they are 
                  sworn in and ending when dismissed by the judge—without including the next witness. 
                  We built boundary detection algorithms using Hebrew text patterns, created a comprehensive 
                  witness index from Yad Vashem&apos;s official list, and handled edge cases like multi-session 
                  testimonies and overlapping content.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Challenges */}
      <section className="py-16 px-6 border-b border-stone-900">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl font-light mb-8">Technical Challenges</h2>
          
          <div className="grid gap-6">
            <div className="border border-stone-800 p-6">
              <h3 className="text-stone-200 font-medium mb-2">Hebrew Text Direction</h3>
              <p className="text-stone-500 text-sm">
                Mixed left-to-right and right-to-left content caused display issues. 
                Required explicit directional attributes and Unicode normalization.
              </p>
            </div>
            
            <div className="border border-stone-800 p-6">
              <h3 className="text-stone-200 font-medium mb-2">Name Variant Matching</h3>
              <p className="text-stone-500 text-sm">
                The same witness might appear with 5+ spelling variations (Hebrew, English, 
                transliterations). Required comprehensive variant lists with fuzzy matching.
              </p>
            </div>
            
            <div className="border border-stone-800 p-6">
              <h3 className="text-stone-200 font-medium mb-2">Large File Processing</h3>
              <p className="text-stone-500 text-sm">
                100,000+ lines of text caused memory issues. Solved with streaming 
                processing and chunking.
              </p>
            </div>
            
            <div className="border border-stone-800 p-6">
              <h3 className="text-stone-200 font-medium mb-2">Unicode Control Characters</h3>
              <p className="text-stone-500 text-sm">
                Invisible directional markers and bracket reversals required careful 
                handling and cleanup.
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Results */}
      <section className="py-16 px-6 border-b border-stone-900 bg-stone-900/30">
        <div className="max-w-4xl mx-auto">
          <h2 className="font-serif text-3xl font-light mb-12 text-center">Results</h2>
          
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
            <div className="text-center p-6 border border-stone-800 bg-stone-900/50">
              <p className="font-serif text-4xl text-emerald-400 mb-2">108</p>
              <p className="text-stone-500 text-sm">Testimonies Extracted</p>
              <p className="text-emerald-600 text-xs mt-1">100% success rate</p>
            </div>
            <div className="text-center p-6 border border-stone-800 bg-stone-900/50">
              <p className="font-serif text-4xl text-stone-200 mb-2">25K+</p>
              <p className="text-stone-500 text-sm">Pages Processed</p>
            </div>
            <div className="text-center p-6 border border-stone-800 bg-stone-900/50">
              <p className="font-serif text-4xl text-stone-200 mb-2">50M+</p>
              <p className="text-stone-500 text-sm">Characters</p>
            </div>
            <div className="text-center p-6 border border-stone-800 bg-stone-900/50">
              <p className="font-serif text-4xl text-stone-200 mb-2">~$50</p>
              <p className="text-stone-500 text-sm">Total Cost</p>
              <p className="text-stone-600 text-xs mt-1">vs. $1,500+ with OCR</p>
            </div>
          </div>

          <div className="border border-stone-800 p-8 text-center">
            <h3 className="text-xl text-stone-200 mb-4">Time Invested</h3>
            <div className="grid grid-cols-2 md:grid-cols-3 gap-4 text-sm">
              <div>
                <p className="text-stone-400">Web scraping</p>
                <p className="text-stone-600">2 days</p>
              </div>
              <div>
                <p className="text-stone-400">OCR research</p>
                <p className="text-stone-600">3 days</p>
              </div>
              <div>
                <p className="text-stone-400">Text extraction</p>
                <p className="text-stone-600">1 day</p>
              </div>
              <div>
                <p className="text-stone-400">Entity extraction</p>
                <p className="text-stone-600">2 days</p>
              </div>
              <div>
                <p className="text-stone-400">Testimony extraction</p>
                <p className="text-stone-600">2 days</p>
              </div>
              <div>
                <p className="text-stone-400">Web interface</p>
                <p className="text-stone-600">2 days</p>
              </div>
            </div>
            <p className="mt-6 text-stone-500">Total: ~12 days</p>
          </div>
        </div>
      </section>

      {/* Lessons Learned */}
      <section className="py-16 px-6 border-b border-stone-900">
        <div className="max-w-3xl mx-auto">
          <h2 className="font-serif text-3xl font-light mb-8">Lessons Learned</h2>
          
          <div className="space-y-6">
            <div className="flex gap-4">
              <span className="text-amber-500 text-xl">1.</span>
              <div>
                <h3 className="text-stone-200 font-medium mb-1">Check for Embedded Text First</h3>
                <p className="text-stone-500 text-sm">
                  Before investing in expensive OCR solutions, always check if PDFs already contain 
                  embedded text. A simple test could save weeks of work.
                </p>
              </div>
            </div>
            
            <div className="flex gap-4">
              <span className="text-amber-500 text-xl">2.</span>
              <div>
                <h3 className="text-stone-200 font-medium mb-1">Simple Solutions Often Work Best</h3>
                <p className="text-stone-500 text-sm">
                  The complex multi-column OCR with AI parsing was unnecessary. The simplest approach 
                  produced the cleanest results.
                </p>
              </div>
            </div>
            
            <div className="flex gap-4">
              <span className="text-amber-500 text-xl">3.</span>
              <div>
                <h3 className="text-stone-200 font-medium mb-1">Domain Knowledge is Essential</h3>
                <p className="text-stone-500 text-sm">
                  Understanding court transcript structure (sworn-in markers, Q&A format, dismissal 
                  phrases) was essential for accurate extraction.
                </p>
              </div>
            </div>
            
            <div className="flex gap-4">
              <span className="text-amber-500 text-xl">4.</span>
              <div>
                <h3 className="text-stone-200 font-medium mb-1">Validate Against Ground Truth</h3>
                <p className="text-stone-500 text-sm">
                  Cross-referencing against Yad Vashem&apos;s official list of 108 witnesses ensured 
                  completeness and accuracy.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Acknowledgments */}
      <section className="py-16 px-6 border-b border-stone-900 bg-stone-900/30">
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
              <strong className="text-stone-200">The 108 Witnesses</strong> — Whose courage in 
              testifying preserved history
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
            The Eichmann Trial Archive • December 2025
          </p>
        </div>
      </footer>
    </main>
  );
}

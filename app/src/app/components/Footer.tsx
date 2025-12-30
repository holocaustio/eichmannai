import Link from 'next/link';

export default function Footer() {
  return (
    <footer className="border-t border-stone-900 bg-stone-950">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16">
        <div className="flex flex-col md:flex-row justify-between items-center gap-8">
          <div className="text-center md:text-left">
            <p className="text-stone-500 text-sm">The Eichmann Trial Digital Archive</p>
            <p className="text-stone-600 text-xs mt-1">Preserving testimony for future generations</p>
          </div>
          
          <div className="flex gap-8 text-stone-600 text-sm">
            <Link href="/about" className="hover:text-stone-400 transition-colors">About</Link>
            <Link href="/explore" className="hover:text-stone-400 transition-colors">Explore</Link>
            <Link href="/witnesses" className="hover:text-stone-400 transition-colors">Witnesses</Link>
          </div>
        </div>
        
        {/* Feedback message */}
        <div className="mt-8 pt-8 border-t border-stone-900 text-center">
          <p className="text-stone-600 text-xs">
            We make mistakes, we try our best, but if you found a mistake, please email me{' '}
            <a 
              href="mailto:alon.carmel@gmail.com" 
              className="text-stone-500 hover:text-stone-400 transition-colors underline"
            >
              alon.carmel@gmail.com
            </a>
          </p>
        </div>
      </div>
    </footer>
  );
}

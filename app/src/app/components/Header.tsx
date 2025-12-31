'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect } from 'react';

const navItems = [
  { href: '/', label: 'Home' },
  { href: '/opening-statement', label: 'Opening Statement' },
  { href: '/witnesses', label: 'Witnesses' },
  { href: '/verdict', label: 'Verdict' },
  { href: '/explore', label: 'Explore the Trial' },
  { href: '/explore#timeline', label: 'Timeline' },
  { href: '/about', label: 'About' }
];

export default function Header() {
  const pathname = usePathname();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);
  const [scrolled, setScrolled] = useState(false);

  // Track scroll position
  useEffect(() => {
    const handleScroll = () => {
      setScrolled(window.scrollY > 50);
    };
    
    // Check initial scroll position
    handleScroll();
    
    window.addEventListener('scroll', handleScroll);
    return () => window.removeEventListener('scroll', handleScroll);
  }, []);

  // Close mobile menu on route change
  useEffect(() => {
    setMobileMenuOpen(false);
  }, [pathname]);

  return (
    <header 
      className={`fixed top-0 left-0 right-0 z-50 transition-all duration-300 ${
        scrolled 
          ? 'bg-stone-950/95 backdrop-blur-sm border-b border-stone-900' 
          : 'bg-transparent border-b border-transparent'
      }`}
      style={{ textShadow: scrolled ? 'none' : '0 2px 8px rgba(0,0,0,0.6)' }}
    >
      <div className="max-w-7xl mx-auto px-4 sm:px-6 py-4 flex items-center justify-between">
        <Link 
          href="/" 
          className={`font-serif text-lg transition-colors ${
            scrolled 
              ? 'text-stone-200 hover:text-white' 
              : 'text-white hover:text-white/80'
          }`}
        >
          The Eichmann Trial Digital Archive
        </Link>
        
        {/* Desktop Navigation */}
        <nav className="hidden md:flex items-center gap-8">
          {navItems.map((item) => {
            const isActive = pathname === item.href || 
              (item.href !== '/' && pathname.startsWith(item.href));
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`text-sm tracking-wide transition-colors ${
                  scrolled
                    ? isActive 
                      ? 'text-stone-100' 
                      : 'text-stone-500 hover:text-stone-300'
                    : isActive
                      ? 'text-white'
                      : 'text-white/70 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        {/* Mobile Menu Button */}
        <button
          type="button"
          className={`md:hidden p-2 transition-colors ${
            scrolled 
              ? 'text-stone-400 hover:text-stone-200' 
              : 'text-white/80 hover:text-white'
          }`}
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
          aria-expanded={mobileMenuOpen}
        >
          {mobileMenuOpen ? (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          ) : (
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 6h16M4 12h16M4 18h16" />
            </svg>
          )}
        </button>
      </div>

      {/* Mobile Navigation */}
      {mobileMenuOpen && (
        <nav className="md:hidden border-t border-stone-900 bg-stone-950/95 backdrop-blur-sm">
          <div className="px-4 py-2">
            {navItems.map((item) => {
              const isActive = pathname === item.href || 
                (item.href !== '/' && pathname.startsWith(item.href));
              
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  className={`block py-3 text-sm tracking-wide transition-colors border-b border-stone-900 last:border-b-0 ${
                    isActive 
                      ? 'text-stone-100' 
                      : 'text-stone-500 hover:text-stone-300'
                  }`}
                >
                  {item.label}
                </Link>
              );
            })}
          </div>
        </nav>
      )}
    </header>
  );
}

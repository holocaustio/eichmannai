'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

const navItems = [
  { href: '/', label: 'Home' },
  { href: '/witnesses', label: 'Witnesses' },
  { href: '/explore', label: 'Explore' },
  { href: '/about', label: 'About' },
];

export default function Header() {
  const pathname = usePathname();

  return (
    <header className="border-b border-stone-900 sticky top-0 bg-stone-950/95 backdrop-blur-sm z-50">
      <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
        <Link href="/" className="font-serif text-lg text-stone-200 hover:text-white transition-colors">
          The Eichmann Trial
        </Link>
        
        <nav className="flex items-center gap-8">
          {navItems.map((item) => {
            const isActive = pathname === item.href || 
              (item.href !== '/' && pathname.startsWith(item.href));
            
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`text-sm tracking-wide transition-colors ${
                  isActive 
                    ? 'text-stone-100' 
                    : 'text-stone-500 hover:text-stone-300'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
      </div>
    </header>
  );
}

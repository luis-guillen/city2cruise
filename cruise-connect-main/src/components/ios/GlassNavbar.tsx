import { ReactNode } from 'react';

interface GlassNavbarProps {
  title: string;
  subtitle?: string;
  leading?: ReactNode;
  trailing?: ReactNode;
  large?: boolean;
}

export default function GlassNavbar({ title, subtitle, leading, trailing, large = false }: GlassNavbarProps) {
  return (
    <nav className="ios-navbar">
      <div className="max-w-lg mx-auto px-4">
        {/* Compact bar */}
        <div className="flex items-center justify-between h-[44px]">
          <div className="flex items-center gap-2 min-w-[60px]">
            {leading}
          </div>
          {!large && (
            <div className="flex-1 text-center">
              <h1 className="ios-title truncate">{title}</h1>
              {subtitle && <p className="ios-caption -mt-0.5">{subtitle}</p>}
            </div>
          )}
          <div className="flex items-center gap-2 min-w-[60px] justify-end">
            {trailing}
          </div>
        </div>
        {/* Large title */}
        {large && (
          <div className="pb-2">
            <h1 className="ios-title-large">{title}</h1>
            {subtitle && <p className="ios-subtitle mt-1">{subtitle}</p>}
          </div>
        )}
      </div>
    </nav>
  );
}

import { ReactNode } from 'react';

interface GlassCardProps {
  children: ReactNode;
  className?: string;
  variant?: 'default' | 'thick' | 'thin' | 'ultra';
  padding?: 'none' | 'sm' | 'md' | 'lg';
  animate?: boolean;
  delay?: number;
  onClick?: () => void;
}

const paddingMap = {
  none: '',
  sm: 'p-3',
  md: 'p-4',
  lg: 'p-5',
};

const variantMap = {
  default: 'glass',
  thick: 'glass-thick',
  thin: 'glass-thin',
  ultra: 'glass-ultra',
};

export default function GlassCard({
  children,
  className = '',
  variant = 'default',
  padding = 'md',
  animate = true,
  delay = 0,
  onClick
}: GlassCardProps) {
  return (
    <div
      onClick={onClick}
      className={`
        ${variantMap[variant]}
        rounded-[20px]
        ${paddingMap[padding]}
        ${animate ? 'animate-scale-in' : ''}
        ${onClick ? 'cursor-pointer active:scale-[0.98] transition-transform' : ''}
        ${className}
      `}
      style={delay > 0 ? { animationDelay: `${delay * 0.06}s` } : undefined}
    >
      {children}
    </div>
  );
}

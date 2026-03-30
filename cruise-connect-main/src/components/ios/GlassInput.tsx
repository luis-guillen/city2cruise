import { InputHTMLAttributes, forwardRef, ReactNode } from 'react';

interface GlassInputProps extends InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  icon?: ReactNode;
  error?: string;
}

const GlassInput = forwardRef<HTMLInputElement, GlassInputProps>(
  ({ label, icon, error, className = '', ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label className="ios-caption font-medium pl-1">{label}</label>
        )}
        <div className="relative">
          {icon && (
            <div className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--ios-text-tertiary)]">
              {icon}
            </div>
          )}
          <input
            ref={ref}
            className={`
              ios-input
              ${icon ? 'pl-11' : ''}
              ${error ? 'border-[var(--ios-red)] focus:border-[var(--ios-red)] focus:ring-red-100' : ''}
              ${className}
            `}
            {...props}
          />
        </div>
        {error && (
          <p className="text-[var(--ios-red)] text-[13px] pl-1">{error}</p>
        )}
      </div>
    );
  }
);

GlassInput.displayName = 'GlassInput';
export default GlassInput;

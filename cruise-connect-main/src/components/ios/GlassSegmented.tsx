import { useRef, type KeyboardEvent } from 'react';

interface SegmentItem {
  id: string;
  label: string;
}

interface GlassSegmentedProps {
  items: SegmentItem[];
  active: string;
  onChange: (id: string) => void;
  className?: string;
  /**
   * Texto descriptivo para lectores de pantalla (aria-label del grupo).
   * Por defecto: "Selector de modo".
   */
  ariaLabel?: string;
}

/**
 * Selector segmentado tipo iOS.
 *
 * A11y (Hito 4.1.2): Implementa el patrón ARIA radiogroup completo:
 *  - Contenedor role="radiogroup" con aria-label.
 *  - Cada item role="radio" con aria-checked + tabIndex roving.
 *  - Flechas izquierda/derecha mueven la selección + foco.
 *  - Home/End van al primero/último.
 */
export default function GlassSegmented({
  items,
  active,
  onChange,
  className = '',
  ariaLabel = 'Selector de modo',
}: GlassSegmentedProps) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusItem = (index: number) => {
    const target = refs.current[index];
    if (target) {
      target.focus();
      onChange(items[index].id);
    }
  };

  const handleKey = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    switch (e.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        e.preventDefault();
        focusItem((index + 1) % items.length);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        e.preventDefault();
        focusItem((index - 1 + items.length) % items.length);
        break;
      case 'Home':
        e.preventDefault();
        focusItem(0);
        break;
      case 'End':
        e.preventDefault();
        focusItem(items.length - 1);
        break;
    }
  };

  return (
    <div
      role="radiogroup"
      aria-label={ariaLabel}
      className={`ios-segmented ${className}`}
    >
      {items.map((item, idx) => {
        const isActive = active === item.id;
        return (
          <button
            key={item.id}
            ref={(el) => {
              refs.current[idx] = el;
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            tabIndex={isActive ? 0 : -1}
            onClick={() => onChange(item.id)}
            onKeyDown={(e) => handleKey(e, idx)}
            className={`ios-segmented-item ${isActive ? 'active' : ''}`}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

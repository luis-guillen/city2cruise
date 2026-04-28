import { lazy, Suspense } from 'react';
import { useTranslation } from 'react-i18next';
import type { ComponentProps } from 'react';

/** Hito 4.2.2 — Lazy wrapper para DriverMap. */
const Inner = lazy(() => import('@/components/DriverMap'));

export default function LazyDriverMap(props: ComponentProps<typeof Inner>) {
  const { t } = useTranslation();
  return (
    <Suspense
      fallback={
        <div
          role="status"
          aria-live="polite"
          className="flex h-[320px] items-center justify-center rounded-xl border border-border bg-card"
        >
          <span
            aria-hidden="true"
            className="h-5 w-5 animate-spin rounded-full border-2 border-current border-t-transparent text-muted-foreground motion-reduce:animate-none"
          />
          <span className="ml-3 text-sm text-muted-foreground">
            {t('common.loading')}
          </span>
        </div>
      }
    >
      <Inner {...props} />
    </Suspense>
  );
}

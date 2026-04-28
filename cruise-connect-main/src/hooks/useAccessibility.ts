import { useEffect, useMemo } from 'react';

export type AccessibilityProfile = 'age_advanced' | 'pmr' | 'standard';

const STORAGE_KEY = 'accessibility_profile';

/**
 * Returns utility classes and flags for the active accessibility profile.
 *
 * age_advanced — 18px base font, 48×48 min touch targets, simplified flows
 * pmr          — full ARIA support + high-contrast focus rings; visual stays standard
 * standard     — default styles, no overrides
 *
 * Usage:
 *   const { profile, setProfile, cls } = useAccessibility();
 *   <button className={cls.btn}>…</button>
 */
export function useAccessibility() {
    const stored = (localStorage.getItem(STORAGE_KEY) ?? 'standard') as AccessibilityProfile;

    function setProfile(p: AccessibilityProfile) {
        localStorage.setItem(STORAGE_KEY, p);
        // Toggle data-attributes on <html> so global CSS can react
        document.documentElement.dataset.a11y = p;
        window.dispatchEvent(new CustomEvent('a11y-profile-change', { detail: p }));
    }

    useEffect(() => {
        document.documentElement.dataset.a11y = stored;
    }, [stored]);

    const cls = useMemo(() => {
        const isAdvanced = stored === 'age_advanced';
        const isPmr = stored === 'pmr';

        return {
            // Root text size — apply on the outermost wrapper
            text: isAdvanced ? 'text-[18px]' : 'text-base',

            // Interactive elements need ≥ 48×48 touch target
            btn: [
                isAdvanced ? 'min-h-[48px] min-w-[48px] text-lg px-6 py-3' : '',
                isPmr ? 'focus-visible:ring-4 focus-visible:ring-offset-2' : '',
            ].filter(Boolean).join(' '),

            // Input fields
            input: [
                isAdvanced ? 'text-lg h-12 px-4' : '',
                isPmr ? 'focus-visible:ring-4' : '',
            ].filter(Boolean).join(' '),

            // Labels
            label: isAdvanced ? 'text-lg font-medium' : '',

            // Spacing between form sections (simplified layout)
            section: isAdvanced ? 'space-y-6' : 'space-y-4',
        };
    }, [stored]);

    return { profile: stored, setProfile, cls, isAdvanced: stored === 'age_advanced', isPmr: stored === 'pmr' };
}

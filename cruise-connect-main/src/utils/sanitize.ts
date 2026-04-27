import DOMPurify from 'dompurify';

/**
 * Strips all HTML tags and attributes from user-supplied text.
 * Use before rendering any user-controlled string in the DOM.
 */
export function sanitizeText(raw: string): string {
    return DOMPurify.sanitize(raw, { ALLOWED_TAGS: [], ALLOWED_ATTR: [] });
}

/**
 * Allows a safe subset of HTML (bold, italic, links) — for rich-text fields.
 * Never use this for innerHTML that could contain script injection.
 */
export function sanitizeRich(raw: string): string {
    return DOMPurify.sanitize(raw, {
        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'a', 'br'],
        ALLOWED_ATTR: ['href', 'target', 'rel'],
    });
}

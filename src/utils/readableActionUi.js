/**
 * Helpers for mapping readable items (books / comics / magazines) to more appropriate UI labels & icons.
 *
 * NOTE: We intentionally guard translation lookups because globalize.translate() can throw when a key
 * is missing in the active locale.
 */

/**
 * Safe wrapper for globalize.translate().
 * @param {any} globalize - globalize module instance.
 * @param {string} key - translation key.
 * @param {string} [fallback] - fallback string if the key is missing.
 * @returns {string}
 */
export function safeTranslate(globalize, key, fallback) {
    try {
        return globalize.translate(key);
    } catch (err) {
        return fallback ?? key;
    }
}

/**
 * @param {any} item
 * @returns {boolean}
 */
export function isReadableItem(item) {
    if (!item) return false;
    if (item.IsFolder) return false;

    const type = item.Type;
    const mediaType = item.MediaType;

    // Jellyfin uses Type === 'Book' for most book-library items. Some installations may use
    // more specific types (e.g., ComicBook, Magazine), so we include common possibilities.
    return (
        type === 'Book'
        || type === 'ComicBook'
        || type === 'Magazine'
        || mediaType === 'Book'
    );
}

/**
 * Extract a lowercase file extension (without dot) from the best-available path-ish field.
 * @param {any} item
 * @returns {string}
 */
export function getReadableFileExtension(item) {
    if (!item) return '';

    const candidate =
        item.Path
        || item?.MediaSources?.[0]?.Path
        || item?.MediaSources?.[0]?.Container;

    if (!candidate || typeof candidate !== 'string') return '';

    const cleaned = candidate.split('?')[0].split('#')[0];
    const lastDot = cleaned.lastIndexOf('.');
    if (lastDot === -1 || lastDot === cleaned.length - 1) return '';

    return cleaned.substring(lastDot + 1).toLowerCase();
}

/**
 * Returns a Material Icons glyph name suitable for readable items.
 * @param {any} item
 * @returns {string}
 */
export function getReadableMaterialIconName(item) {
    const ext = getReadableFileExtension(item);

    switch (ext) {
        case 'pdf':
            return 'picture_as_pdf';
        case 'epub':
            return 'auto_stories';
        case 'cbz':
        case 'cbr':
        case 'cbt':
        case 'cb7':
            return 'collections_bookmark';
        default:
            return 'menu_book';
    }
}

/**
 * Returns the user-facing label for the primary open/read action.
 * @param {any} globalize
 * @param {boolean} isResumable
 * @returns {string}
 */
export function getReadablePrimaryLabel(globalize, isResumable) {
    if (isResumable) {
        // Prefer a dedicated key if present, otherwise fall back to the existing header label.
        try {
            return globalize.translate('ContinueReading');
        } catch (err) {
            // ignore
        }

        try {
            return globalize.translate('HeaderContinueReading');
        } catch (err) {
            // ignore
        }

        return 'Continue reading';
    }

    return safeTranslate(globalize, 'Read', 'Read');
}

/**
 * Returns a label for "play/read all from here" style actions.
 * @param {any} globalize
 * @returns {string}
 */
export function getReadableFromHereLabel(globalize) {
    return safeTranslate(globalize, 'ReadFromHere', 'Read from here');
}

/**
 * Returns icon + label for the primary open/read action for readable items.
 * @param {any} item
 * @param {boolean} isResumable
 * @param {any} globalize
 * @returns {{ icon: string, title: string }}
 */
export function getReadablePrimaryActionUi(item, isResumable, globalize) {
    return {
        icon: getReadableMaterialIconName(item),
        title: getReadablePrimaryLabel(globalize, isResumable)
    };
}

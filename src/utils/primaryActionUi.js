/**
 * Helper for choosing the primary action icon/label for readable items (Books/Comics/Magazines).
 *
 * This is intentionally dependency-free so it can be reused from multiple UI surfaces:
 * cards, item details, context menus, lists, etc.
 */

function getExtensionFromPath(path) {
    if (!path || typeof path !== 'string') {
        return '';
    }

    const lastDot = path.lastIndexOf('.');
    if (lastDot === -1 || lastDot === path.length - 1) {
        return '';
    }

    return path.substring(lastDot + 1).toLowerCase();
}

function getBestItemPath(item) {
    // Path is commonly present for library items; media sources might not be.
    if (item?.Path) {
        return item.Path;
    }

    const mediaSources = item?.MediaSources;
    if (Array.isArray(mediaSources) && mediaSources.length > 0) {
        return mediaSources[0]?.Path || '';
    }

    return '';
}

export function isReadableItem(item) {
    if (!item || item.IsFolder) {
        return false;
    }

    const type = item.Type;
    const mediaType = item.MediaType;

    // Jellyfin typically uses Type="Book" for items in book libraries.
    // Some installs/providers may surface ComicBook/Magazine as distinct types.
    return type === 'Book'
        || type === 'ComicBook'
        || type === 'Magazine'
        || mediaType === 'Book';
}

export function getReadableItemIcon(item) {
    const type = item?.Type;

    // Prefer format-specific icons when we can infer the extension.
    const ext = getExtensionFromPath(getBestItemPath(item));

    switch (ext) {
        case 'pdf':
            return 'picture_as_pdf';
        case 'epub':
            return 'auto_stories';
        case 'cbz':
        case 'cbr':
        case 'cb7':
        case 'cbt':
            return 'collections_bookmark';
        case 'mobi':
        case 'azw':
        case 'azw3':
        case 'kfx':
            return 'menu_book';
        default:
            break;
    }

    // If we know it's a comic but can't infer extension, pick a comic-ish icon.
    if (type === 'ComicBook') {
        return 'collections_bookmark';
    }

    return 'menu_book';
}

export function getPrimaryActionUi(item, { action } = {}) {
    const actionStr = (action || '').toString().toLowerCase();
    const isResumeAction = actionStr.includes('resume');

    if (!isReadableItem(item)) {
        if (isResumeAction) {
            return { icon: 'play_arrow', labelKey: 'Resume', labelFallback: 'Resume' };
        }

        return { icon: 'play_arrow', labelKey: 'Play', labelFallback: 'Play' };
    }

    const hasPosition = !!item?.UserData?.PlaybackPositionTicks;

    // For readable items we intentionally avoid "Play" language.
    if (hasPosition) {
        return {
            icon: getReadableItemIcon(item),
            labelKey: 'ContinueReading',
            labelFallback: 'Continue reading'
        };
    }

    return {
        icon: getReadableItemIcon(item),
        labelKey: 'Read',
        labelFallback: 'Read'
    };
}

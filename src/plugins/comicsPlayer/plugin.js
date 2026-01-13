import { Archive } from 'libarchive.js';
import loading from '../../components/loading/loading';
import dialogHelper from '../../components/dialogHelper/dialogHelper';
import toast from '../../components/toast/toast';
import keyboardnavigation from '../../scripts/keyboardNavigation';
import { appRouter } from '../../components/router/appRouter';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import * as userSettings from '../../scripts/settings/userSettings';
import { PluginType } from '../../types/plugin.ts';

import './style.scss';

// supported book file extensions
const FILE_EXTENSIONS = ['.cbr', '.cbt', '.cbz', '.cb7'];
// the comic book archive supports any kind of image format as it's just a zip archive
const IMAGE_FORMATS = ['jpg', 'jpeg', 'jpe', 'jif', 'jfif', 'jfi', 'png', 'avif', 'gif', 'bmp', 'dib', 'tiff', 'tif', 'webp'];

export class ComicsPlayer {
    constructor() {
        this.name = 'Comics Player';
        this.type = PluginType.MediaPlayer;
        this.id = 'comicsplayer';
        this.priority = 1;
        this.imageMap = new Map();

        this.onDialogClosed = this.onDialogClosed.bind(this);
        this.onWindowKeyDown = this.onWindowKeyDown.bind(this);
    }

    play(options) {
    this.currentPage = 0;
    this.pageCount = 0;

    const item = options.items[0];
    // Prefer a series-level key when available so settings apply across a series.
    this.settingsKey = item.SeriesId || item.ParentId || item.Id;
    this.comicsPlayerSettings = userSettings.getComicsPlayerSettings(this.settingsKey);

    const elem = this.createMediaElement();
    return this.setCurrentSrc(elem, options);
}

stop() {
    this.unbindEvents();
    this.unbindGestureEvents?.();

    const stopInfo = {
        src: this.item
    };

    Events.trigger(this, 'stopped', [stopInfo]);

    const settingsKey = this.settingsKey || this.item?.SeriesId || this.item?.ParentId || this.item?.Id;
    if (settingsKey) {
        userSettings.setComicsPlayerSettings(this.comicsPlayerSettings, settingsKey);
    }

    try {
        this.swiperInstance?.destroy(true, true);
    } catch (err) {
        // ignore
    }
    this.swiperInstance = null;

    this.archiveSource?.release();

    const elem = this.mediaElement;
    if (elem) {
        dialogHelper.close(elem);
        this.mediaElement = null;
    }

    loading.hide();
}

destroy() {
        // Nothing to do here
    }

    currentTime() {
        return this.currentPage;
    }

    duration() {
        return this.pageCount;
    }

    currentItem() {
        return this.item;
    }

    volume() {
        return 100;
    }

    isMuted() {
        return false;
    }

    paused() {
        return false;
    }

    seekable() {
        return true;
    }

    onDialogClosed() {
        this.stop();
    }

    onDirChanged = () => {
        let langDir = this.comicsPlayerSettings.langDir;

        if (!langDir || langDir === 'ltr') {
            langDir = 'rtl';
        } else {
            langDir = 'ltr';
        }

        this.changeLanguageDirection(langDir);

        this.comicsPlayerSettings.langDir = langDir;
    };

    changeLanguageDirection(langDir) {
        const currentPage = this.currentPage;

        this.swiperInstance.changeLanguageDirection(langDir);

        const prevIcon = langDir === 'ltr' ? 'arrow_circle_left' : 'arrow_circle_right';
        this.mediaElement.querySelector('.btnToggleLangDir > span').classList.remove(prevIcon);

        const newIcon = langDir === 'ltr' ? 'arrow_circle_right' : 'arrow_circle_left';
        this.mediaElement.querySelector('.btnToggleLangDir > span').classList.add(newIcon);

        const dirTitle = langDir === 'ltr' ? 'Right To Left' : 'Left To Right';
        this.mediaElement.querySelector('.btnToggleLangDir').title = dirTitle;

        this.reload(currentPage);
    }

    onViewChanged = () => {
        let view = this.comicsPlayerSettings.pagesPerView;

        if (!view || view === 1) {
            view = 2;
        } else {
            view = 1;
        }

        this.changeView(view);

        this.comicsPlayerSettings.pagesPerView = view;
    };

    changeView(view) {
        const currentPage = this.currentPage;

        this.swiperInstance.params.slidesPerView = view;
        this.swiperInstance.params.slidesPerGroup = view;

        const prevIcon = view === 1 ? 'devices_fold' : 'import_contacts';
        this.mediaElement.querySelector('.btnToggleView > span').classList.remove(prevIcon);

        const newIcon = view === 1 ? 'import_contacts' : 'devices_fold';
        this.mediaElement.querySelector('.btnToggleView > span').classList.add(newIcon);

        const viewTitle = view === 1 ? 'Double Page View' : 'Single Page View';
        this.mediaElement.querySelector('.btnToggleView').title = viewTitle;

        this.reload(currentPage);
    }

    reload(currentPage) {
        const effect = this.swiperInstance.params.effect;

        this.swiperInstance.params.effect = 'none';
        this.swiperInstance.update();

        this.swiperInstance.slideNext();
        this.swiperInstance.slidePrev();

        if (this.currentPage != currentPage) {
            this.swiperInstance.slideTo(currentPage);
            this.swiperInstance.update();
        }

        this.swiperInstance.params.effect = effect;
        this.swiperInstance.update();
    }

    onWindowKeyDown(e) {
        // Skip modified keys
        if (e.ctrlKey || e.altKey || e.metaKey || e.shiftKey) return;

        const key = keyboardnavigation.getKeyName(e);
        if (key === 'Escape') {
            e.preventDefault();
            this.stop();
        }
    }

    bindMediaElementEvents() {
        const elem = this.mediaElement;

        elem?.addEventListener('close', this.onDialogClosed, { once: true });
        elem?.querySelector('.btnExit').addEventListener('click', this.onDialogClosed, { once: true });
        elem?.querySelector('.btnToggleLangDir').addEventListener('click', this.onDirChanged);
        elem?.querySelector('.btnToggleView').addEventListener('click', this.onViewChanged);
    }

    bindEvents() {
        this.bindMediaElementEvents();

        document.addEventListener('keydown', this.onWindowKeyDown);
    }

    unbindMediaElementEvents() {
        const elem = this.mediaElement;

        elem?.removeEventListener('close', this.onDialogClosed);
        elem?.querySelector('.btnExit').removeEventListener('click', this.onDialogClosed);
        elem?.querySelector('.btnToggleLangDir').removeEventListener('click', this.onDirChanged);
        elem?.querySelector('.btnToggleView').removeEventListener('click', this.onViewChanged);
    }

    unbindEvents() {
        this.unbindMediaElementEvents();

        document.removeEventListener('keydown', this.onWindowKeyDown);
    }

    createMediaElement() {
        let elem = this.mediaElement;
        if (elem) {
            return elem;
        }

        elem = document.getElementById('comicsPlayer');
        if (!elem) {
            elem = dialogHelper.createDialog({
                exitAnimationDuration: 400,
                size: 'fullscreen',
                autoFocus: false,
                scrollY: false,
                exitAnimation: 'fadeout',
                removeOnClose: true
            });

            const viewIcon = this.comicsPlayerSettings.pagesPerView === 1 ? 'import_contacts' : 'devices_fold';
            const dirIcon = this.comicsPlayerSettings.langDir === 'ltr' ? 'arrow_circle_right' : 'arrow_circle_left';

            elem.id = 'comicsPlayer';
            elem.classList.add('slideshowDialog');
            elem.innerHTML = `<div dir=${this.comicsPlayerSettings.langDir} class="slideshowSwiperContainer">
                                <div class="swiper-wrapper"></div>
                                <div class="swiper-button-next actionButtonIcon"></div>
                                <div class="swiper-button-prev actionButtonIcon"></div>
                                <div class="swiper-pagination"></div>
                            </div>
                            <div class="actionButtons">
                                <button is="paper-icon-button-light" class="autoSize btnToggleLangDir" tabindex="-1">
                                    <span class="material-icons actionButtonIcon ${dirIcon}" aria-hidden="true"></span>
                                </button>
                                <button is="paper-icon-button-light" class="autoSize btnToggleView" tabindex="-1">
                                    <span class="material-icons actionButtonIcon ${viewIcon}" aria-hidden="true"></span>
                                </button>
                                <button is="paper-icon-button-light" class="autoSize btnExit" tabindex="-1">
                                    <span class="material-icons actionButtonIcon close" aria-hidden="true"></span>
                                </button>
                            </div>`;

            dialogHelper.open(elem);
        }

        this.mediaElement = elem;

        const dirTitle = this.comicsPlayerSettings.langDir === 'ltr' ? 'Right To Left' : 'Left To Right';
        this.mediaElement.querySelector('.btnToggleLangDir').title = dirTitle;

        const viewTitle = this.comicsPlayerSettings.pagesPerView === 1 ? 'Double Page View' : 'Single Page View';
        this.mediaElement.querySelector('.btnToggleView').title = viewTitle;

        this.bindEvents();
        return elem;
    }

    setCurrentSrc(elem, options) {
    const item = options.items[0];
    this.item = item;
    this.streamInfo = {
        started: true,
        ended: false,
        item: this.item,
        mediaSource: {
            Id: item.Id
        }
    };

    loading.show();

    const serverId = item.ServerId;
    const apiClient = ServerConnections.getApiClient(serverId);

    Archive.init({
        workerUrl: appRouter.baseUrl() + '/libraries/worker-bundle.js'
    });

    const downloadUrl = apiClient.getItemDownloadUrl(item.Id);
    this.archiveSource = new ArchiveSource(downloadUrl);

    //eslint-disable-next-line import/no-unresolved
    import('swiper/css/bundle');

    return this.archiveSource.load()
        // eslint-disable-next-line import/no-unresolved
        .then(() => import('swiper/bundle'))
        .then(({ Swiper }) => {
            loading.hide();

            this.pageCount = this.archiveSource.count;
            this.currentPage = options.startPositionTicks / 10000 || 0;

            const pagesPerView = this.comicsPlayerSettings.pagesPerView || 1;

            // Prefetch tuning (virtual window)
            this.prefetchBefore = 2;
            this.prefetchAfter = pagesPerView === 2 ? 10 : 8;

            // Keep a small ObjectURL cache around the active slide to reduce memory usage on huge archives.
            this.archiveSource.setCacheSize(this.prefetchBefore + this.prefetchAfter + 10);

            // Better zoom defaults (more zoom when in double-page mode)
            this.maxZoomRatio = pagesPerView === 2 ? 8 : 6;

            this.swiperInstance = new Swiper(elem.querySelector('.slideshowSwiperContainer'), {
                direction: 'horizontal',
                // loop is disabled due to the lack of Swiper support in virtual slides
                loop: false,
                zoom: {
                    minRatio: 1,
                    maxRatio: this.maxZoomRatio,
                    toggle: true,
                    containerClass: 'slider-zoom-container'
                },
                autoplay: false,
                keyboard: {
                    enabled: true
                },

                // Reduce work on huge archives; we'll manage loading via virtual window + object URL cache.
                preloadImages: false,
                updateOnImagesReady: false,
                watchSlidesProgress: true,

                slidesPerView: pagesPerView,
                slidesPerGroup: pagesPerView,
                slidesPerColumn: 1,
                initialSlide: this.currentPage,
                navigation: {
                    nextEl: '.swiper-button-next',
                    prevEl: '.swiper-button-prev'
                },
                pagination: {
                    el: '.swiper-pagination',
                    clickable: true,
                    type: 'fraction'
                },
                // reduces memory consumption for large libraries while allowing preloading of nearby images
                virtual: {
                    slides: this.archiveSource.slides,
                    cache: false,
                    renderSlide: (_slide, index) => this.getSlideHtml(index),
                    addSlidesBefore: this.prefetchBefore,
                    addSlidesAfter: this.prefetchAfter
                }
            });

            const updatePrefetch = () => {
                this.archiveSource?.pruneToWindow(this.swiperInstance.activeIndex, this.prefetchBefore, this.prefetchAfter);
            };

            // Initial prefetch
            updatePrefetch();

            // save current page ( a page is an image file inside the archive )
            this.swiperInstance.on('slideChange', () => {
                this.currentPage = this.swiperInstance.activeIndex;
                updatePrefetch();
                Events.trigger(this, 'pause');
            });

            // When zoomed in, disable page swipe so drag gestures pan the image instead.
            this.swiperInstance.on('zoomChange', (_swiper, scale) => {
                const zoomed = (scale || 1) > 1.01;
                this.mediaElement?.classList.toggle('isZoomed', zoomed);
                this.swiperInstance.allowSlidePrev = !zoomed;
                this.swiperInstance.allowSlideNext = !zoomed;

                // Remember last zoom (optional per-book setting)
                this.comicsPlayerSettings.lastZoomRatio = scale || 1;
            });

            this.bindGestureEvents();
        })
        .catch((err) => {
            loading.hide();
            console.error('[comicsPlayer] failed to open archive', err);

            // Avoid "Unknown promise rejection reason" overlays; surface a friendly message.
            toast('Unable to open comic. See console for details.');

            // Ensure we clean up any partial state.
            this.stop();
        });
}

getSlideHtml(index) {
    const url = this.archiveSource.getUrl(index);
    return `<div class="swiper-slide">
               <div class="slider-zoom-container">
                   <img src="${url}" class="swiper-slide-img" loading="lazy" decoding="async" draggable="false">
               </div>
           </div>`;
}

bindGestureEvents() {
    // Double-click (desktop) / double-tap (touch) to toggle zoom.
    const container = this.mediaElement?.querySelector('.slideshowSwiperContainer');
    if (!container || !this.swiperInstance?.zoom) return;

    this._lastTapTime = 0;
    this._lastTapX = 0;
    this._lastTapY = 0;

    this._onDblClick = (e) => {
        e.preventDefault();
        try {
            this.swiperInstance.zoom.toggle(e);
        } catch (err) {
            // ignore
        }
    };

    this._onPointerUp = (e) => {
        if (e.pointerType !== 'touch') return;

        const now = Date.now();
        const dx = Math.abs((e.clientX || 0) - (this._lastTapX || 0));
        const dy = Math.abs((e.clientY || 0) - (this._lastTapY || 0));
        const isDoubleTap = (now - (this._lastTapTime || 0)) < 300 && dx < 25 && dy < 25;

        this._lastTapTime = now;
        this._lastTapX = e.clientX || 0;
        this._lastTapY = e.clientY || 0;

        if (isDoubleTap) {
            e.preventDefault();
            try {
                this.swiperInstance.zoom.toggle(e);
            } catch (err) {
                // ignore
            }
        }
    };

    // Passive must be false to allow preventDefault()
    container.addEventListener('dblclick', this._onDblClick, { passive: false });
    container.addEventListener('pointerup', this._onPointerUp, { passive: false });

    this.unbindGestureEvents = () => {
        container.removeEventListener('dblclick', this._onDblClick);
        container.removeEventListener('pointerup', this._onPointerUp);
    };
}

canPlayMediaType(mediaType) {
        return (mediaType || '').toLowerCase() === 'book';
    }

    canPlayItem(item) {
        return item.Path && FILE_EXTENSIONS.some(ext => item.Path.endsWith(ext));
    }
}

class ArchiveSource {
    constructor(url) {
        this.url = url;

        /** @type {{name: string, file: File}[]} */
        this.entries = [];

        /** Virtual slides payload (indexes) */
        this.slides = [];

        /** LRU cache of ObjectURLs (index -> url) */
        this.urlCache = new Map();
        this.maxUrlCache = 32;
    }

    get count() {
        return this.entries.length;
    }

    setCacheSize(size) {
        const n = parseInt(size, 10);
        if (!Number.isFinite(n) || n <= 0) {
            return;
        }
        this.maxUrlCache = Math.max(8, n);
        this._enforceCacheLimit();
    }

    _enforceCacheLimit() {
        while (this.urlCache.size > this.maxUrlCache) {
            const oldestKey = this.urlCache.keys().next().value;
            const oldestUrl = this.urlCache.get(oldestKey);
            this.urlCache.delete(oldestKey);
            /* eslint-disable-next-line compat/compat */
            URL.revokeObjectURL(oldestUrl);
        }
    }

    getUrl(index) {
        const cached = this.urlCache.get(index);
        if (cached) {
            // refresh LRU
            this.urlCache.delete(index);
            this.urlCache.set(index, cached);
            return cached;
        }

        const entry = this.entries[index];
        if (!entry) return '';

        /* eslint-disable-next-line compat/compat */
        const url = URL.createObjectURL(entry.file);
        this.urlCache.set(index, url);
        this._enforceCacheLimit();
        return url;
    }

    pruneToWindow(activeIndex, before, after) {
        if (!this.entries.length) return;

        const min = Math.max(0, (activeIndex || 0) - (before || 0));
        const max = Math.min(this.entries.length - 1, (activeIndex || 0) + (after || 0));

        // Ensure urls exist for the window
        for (let i = min; i <= max; i++) {
            this.getUrl(i);
        }

        // Revoke urls far outside the window (keep a tiny buffer to reduce churn)
        const buffer = 2;
        for (const [idx, url] of Array.from(this.urlCache.entries())) {
            if (idx < (min - buffer) || idx > (max + buffer)) {
                this.urlCache.delete(idx);
                /* eslint-disable-next-line compat/compat */
                URL.revokeObjectURL(url);
            }
        }
    }

    async load() {
        const res = await fetch(this.url);
        if (!res.ok) {
            throw new Error(`Failed to fetch comic: HTTP ${res.status}`);
        }

        const blob = await res.blob();
        this.archive = await Archive.open(blob);

        // Some archives can throw during extraction; surface a clearer error.
        try {
            await this.archive.extractFiles();
        } catch (err) {
            const msg = (err && err.message) ? err.message : String(err);
            throw new Error(`Archive extract failed: ${msg}`);
        }

        let files = await this.archive.getFilesArray();

        // metadata files and files without a file extension should not be considered as a page
        files = files.filter((file) => {
            const name = file.file.name;
            const index = name.lastIndexOf('.');
            return index !== -1 && IMAGE_FORMATS.includes(name.slice(index + 1).toLowerCase());
        });

        files.sort((a, b) => {
            if (a.file.name < b.file.name) {
                return -1;
            } else {
                return 1;
            }
        });

        this.entries = files.map(f => ({ name: f.file.name, file: f.file }));
        this.slides = this.entries.map((_, i) => i);
    }

    release() {
        this.entries = [];
        this.slides = [];

        /* eslint-disable-next-line compat/compat */
        for (const url of this.urlCache.values()) {
            URL.revokeObjectURL(url);
        }
        this.urlCache.clear();
    }
}

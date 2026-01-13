import { Archive } from 'libarchive.js';
import loading from '../../components/loading/loading';
import dialogHelper from '../../components/dialogHelper/dialogHelper';
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

        this.panelMode = false;
        this.currentPanelIndex = 0;
        this.activePanelList = null;
        this.panelCache = new Map();
        this.lastActiveIndex = null;
        this.pendingPanelIndex = null;

        this.onDialogClosed = this.onDialogClosed.bind(this);
        this.onWindowKeyDown = this.onWindowKeyDown.bind(this);
    }

    play(options) {
        this.currentPage = 0;
        this.pageCount = 0;

        const mediaSourceId = options.items[0].Id;
        this.comicsPlayerSettings = userSettings.getComicsPlayerSettings(mediaSourceId);

        this.panelMode = Boolean(this.comicsPlayerSettings.panelMode);
        this.currentPanelIndex = 0;
        this.activePanelList = null;
        this.panelCache.clear();
        this.lastActiveIndex = null;

        const elem = this.createMediaElement();
        return this.setCurrentSrc(elem, options);
    }

    stop() {
        this.unbindEvents();

        const stopInfo = {
            src: this.item
        };

        Events.trigger(this, 'stopped', [stopInfo]);

        const mediaSourceId = this.item.Id;
        userSettings.setComicsPlayerSettings(this.comicsPlayerSettings, mediaSourceId);

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

        if (this.panelMode) {
            this.applyPanelModeToActiveSlide(false).catch((err) => console.error('ComicsPlayer: applyPanelMode failed', err));
        }
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

        if (this.panelMode) {
            this.resetTransformsForAllSlides();
            this.currentPanelIndex = 0;
            this.applyPanelModeToActiveSlide(true).catch((err) => console.error('ComicsPlayer: applyPanelMode failed', err));
        }
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

        if (this.panelMode) {
            const isRtl = this.comicsPlayerSettings.langDir === 'rtl';
            const forwardKeys = isRtl ? ['ArrowLeft', 'Left', 'PageDown'] : ['ArrowRight', 'Right', 'PageDown'];
            const backKeys = isRtl ? ['ArrowRight', 'Right', 'PageUp'] : ['ArrowLeft', 'Left', 'PageUp'];

            if (forwardKeys.includes(key)) {
                e.preventDefault();
                this.panelNext();
                return;
            }

            if (backKeys.includes(key)) {
                e.preventDefault();
                this.panelPrev();
                return;
            }
        }

        if (key === 'Escape') {
            e.preventDefault();
            this.stop();
        }
    }

    onPanelModeToggled = () => {
        this.panelMode = !this.panelMode;
        this.comicsPlayerSettings.panelMode = this.panelMode;

        const panelBtn = this.mediaElement?.querySelector('.btnTogglePanel');
        if (panelBtn) {
            panelBtn.classList.toggle('selected', this.panelMode);
            panelBtn.title = this.panelMode ? 'Exit Panel Mode' : 'Panel Mode';
        }

        this.mediaElement?.classList.toggle('comicsPanelMode', this.panelMode);

        // Swiper zoom interferes with guided transforms; disable it while in panel mode.
        try {
            if (this.panelMode) {
                this.swiperInstance?.zoom?.disable?.();
            } else {
                this.swiperInstance?.zoom?.enable?.();
            }
        } catch (err) {
            // ignore
        }

        if (this.panelMode) {
            this.currentPanelIndex = 0;
            this.pendingPanelIndex = null;
            this.applyPanelModeToActiveSlide(true).catch((err) => console.error('ComicsPlayer: applyPanelMode failed', err));
        } else {
            this.activePanelList = null;
            this.pendingPanelIndex = null;
            this.resetTransformsForAllSlides();
            this.updatePanelIndicator();
        }
    };

    onNextCapture = (e) => {
        if (!this.panelMode) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        this.panelNext();
    };

    onPrevCapture = (e) => {
        if (!this.panelMode) return;

        e.preventDefault();
        e.stopPropagation();
        e.stopImmediatePropagation();

        this.panelPrev();
    };

    panelNext() {
        const panels = this.activePanelList;
        if (panels && panels.length > 1 && this.currentPanelIndex < panels.length - 1) {
            this.currentPanelIndex += 1;
            this.focusActivePanel();
            return;
        }

        this.pendingPanelIndex = 0;
        this.currentPanelIndex = 0;
        this.swiperInstance?.slideNext();
    }

    panelPrev() {
        const panels = this.activePanelList;
        if (panels && panels.length > 1 && this.currentPanelIndex > 0) {
            this.currentPanelIndex -= 1;
            this.focusActivePanel();
            return;
        }

        this.pendingPanelIndex = 'last';
        this.currentPanelIndex = 0;
        this.swiperInstance?.slidePrev();
    }

    updatePanelIndicator() {
        const el = this.mediaElement?.querySelector('.panelIndicator');
        if (!el) return;

        const panels = this.activePanelList;
        if (!this.panelMode || !panels || panels.length <= 1) {
            el.classList.add('hide');
            el.textContent = '';
            return;
        }

        el.classList.remove('hide');
        el.textContent = `Panel ${this.currentPanelIndex + 1}/${panels.length}`;
    }

    resetTransformsForAllSlides() {
        const imgs = this.mediaElement?.querySelectorAll('img.swiper-slide-img');
        imgs?.forEach((img) => {
            img.style.transform = '';
            img.style.transformOrigin = '';
            img.style.width = '';
            img.style.height = '';
        });
    }

    async applyPanelModeToActiveSlide(resetIndex) {
        if (!this.panelMode) return;

        const img = await this.waitForActiveImage();
        if (!img || !img.naturalWidth || !img.naturalHeight) return;

        const activeIndex = this.swiperInstance?.activeIndex ?? this.currentPage ?? 0;
        const url = this.archiveSource?.urls?.[activeIndex];
        if (!url) return;

        const analysis = await this.getPanelAnalysis(url);
        const panels = getOrderedPanels(analysis, this.comicsPlayerSettings.langDir);

        this.activePanelList = panels;

        if (resetIndex) {
            this.currentPanelIndex = 0;
        } else if (this.pendingPanelIndex !== null && this.pendingPanelIndex !== undefined) {
            if (this.pendingPanelIndex === 'last') {
                this.currentPanelIndex = Math.max(0, panels.length - 1);
            } else if (typeof this.pendingPanelIndex === 'number') {
                this.currentPanelIndex = Math.max(0, Math.min(panels.length - 1, this.pendingPanelIndex));
            }
        }
        this.pendingPanelIndex = null;

        this.focusActivePanel();
    }

    focusActivePanel() {
        if (!this.panelMode) return;

        const img = this.mediaElement?.querySelector('.swiper-slide-active img.swiper-slide-img');
        const container = this.mediaElement?.querySelector('.swiper-slide-active .slider-zoom-container');
        if (!img || !container) return;

        const panels = this.activePanelList;
        const box = panels?.[this.currentPanelIndex];
        if (!box) return;

        // Fit image inside container first, then apply guided transform to focus the selected panel.
        const cw = container.clientWidth || container.getBoundingClientRect().width;
        const ch = container.clientHeight || container.getBoundingClientRect().height;
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;

        if (!cw || !ch || !iw || !ih) return;

        const fitScale = Math.min(cw / iw, ch / ih);
        const fitW = iw * fitScale;
        const fitH = ih * fitScale;

        img.style.width = `${fitW}px`;
        img.style.height = `${fitH}px`;
        img.style.transformOrigin = '0 0';
        img.style.left = '0px';
        img.style.top = '0px';

        const bw = Math.max(0.02, box.w) * fitW;
        const bh = Math.max(0.02, box.h) * fitH;
        const cx = (box.x + box.w / 2) * fitW;
        const cy = (box.y + box.h / 2) * fitH;

        // Leave some room for the top-right action buttons and navigation arrows.
        const TOP_SAFE = 62;
        const SIDE_SAFE = 52;
        const BOTTOM_SAFE = 44;

        const leftSafe = SIDE_SAFE;
        const rightSafe = SIDE_SAFE;
        const topSafe = TOP_SAFE;
        const bottomSafe = BOTTOM_SAFE;

        const availW = Math.max(1, cw - leftSafe - rightSafe);
        const availH = Math.max(1, ch - topSafe - bottomSafe);

        const pagesPerView = this.comicsPlayerSettings?.pagesPerView || 1;
        const MAX_PANEL_SCALE = pagesPerView >= 2 ? 10 : 8;
        let s = Math.min(availW / bw, availH / bh) * 0.99;
        // Allow a bit of zoom-out if the "panel" is basically full-width so we don't crop.
        s = Math.max(0.6, Math.min(MAX_PANEL_SCALE, s));

        let tx = (leftSafe + (availW / 2)) - (cx * s);
        let ty = (topSafe + (availH / 2)) - (cy * s);

        // Clamp translation so the selected panel stays within the safe area.
        const panelLeft = (box.x * fitW * s) + tx;
        const panelRight = ((box.x + box.w) * fitW * s) + tx;
        if (panelLeft < leftSafe) tx += (leftSafe - panelLeft);
        if (panelRight > (cw - rightSafe)) tx -= (panelRight - (cw - rightSafe));

        const panelTop = (box.y * fitH * s) + ty;
        const panelBottom = ((box.y + box.h) * fitH * s) + ty;
        if (panelTop < topSafe) ty += (topSafe - panelTop);
        if (panelBottom > (ch - bottomSafe)) ty -= (panelBottom - (ch - bottomSafe));

        img.style.transform = `matrix(${s},0,0,${s},${tx},${ty})`;

        this.updatePanelIndicator();
    }

    waitForActiveImage() {
        return new Promise((resolve) => {
            const tryFind = () => {
                const img = this.mediaElement?.querySelector('.swiper-slide-active img.swiper-slide-img');
                if (img && img.complete && img.naturalWidth) {
                    resolve(img);
                    return;
                }

                if (img) {
                    const done = () => resolve(img);
                    img.addEventListener('load', done, { once: true });
                    img.addEventListener('error', done, { once: true });
                    return;
                }

                requestAnimationFrame(tryFind);
            };

            tryFind();
        });
    }

    async getPanelAnalysis(url) {
        const cached = this.panelCache.get(url);
        if (cached) return cached;

        try {
            const img = await loadImageForAnalysis(url);
            const analysis = analyzeComicPage(img);

            this.panelCache.set(url, analysis);
            return analysis;
        } catch (err) {
            const fallback = { cropBox: { x: 0, y: 0, w: 1, h: 1 }, panels: [] };
            this.panelCache.set(url, fallback);
            return fallback;
        }
    }

    bindMediaElementEvents() {
        const elem = this.mediaElement;

        elem?.addEventListener('close', this.onDialogClosed, { once: true });
        elem?.querySelector('.btnExit').addEventListener('click', this.onDialogClosed, { once: true });
        elem?.querySelector('.btnToggleLangDir').addEventListener('click', this.onDirChanged);
        elem?.querySelector('.btnToggleView').addEventListener('click', this.onViewChanged);
        elem?.querySelector('.btnTogglePanel')?.addEventListener('click', this.onPanelModeToggled);

        // Capture swiper navigation clicks so we can advance panels without changing pages
        elem?.querySelector('.swiper-button-next')?.addEventListener('click', this.onNextCapture, true);
        elem?.querySelector('.swiper-button-prev')?.addEventListener('click', this.onPrevCapture, true);
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
        elem?.querySelector('.btnTogglePanel')?.removeEventListener('click', this.onPanelModeToggled);

        elem?.querySelector('.swiper-button-next')?.removeEventListener('click', this.onNextCapture, true);
        elem?.querySelector('.swiper-button-prev')?.removeEventListener('click', this.onPrevCapture, true);
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
                                <button is="paper-icon-button-light" class="autoSize btnTogglePanel" tabindex="-1">
                                    <span class="material-icons actionButtonIcon view_quilt" aria-hidden="true"></span>
                                </button>
                                <button is="paper-icon-button-light" class="autoSize btnExit" tabindex="-1">
                                    <span class="material-icons actionButtonIcon close" aria-hidden="true"></span>
                                </button>
                                <div class="panelIndicator hide" aria-live="polite"></div>
                            </div>`;

            dialogHelper.open(elem);
        }

        this.mediaElement = elem;

        const dirTitle = this.comicsPlayerSettings.langDir === 'ltr' ? 'Right To Left' : 'Left To Right';
        this.mediaElement.querySelector('.btnToggleLangDir').title = dirTitle;

        const viewTitle = this.comicsPlayerSettings.pagesPerView === 1 ? 'Double Page View' : 'Single Page View';
        this.mediaElement.querySelector('.btnToggleView').title = viewTitle;

        const panelBtn = this.mediaElement.querySelector('.btnTogglePanel');
        if (panelBtn) {
            panelBtn.title = this.panelMode ? 'Exit Panel Mode' : 'Panel Mode';
            panelBtn.classList.toggle('selected', this.panelMode);
        }

        this.mediaElement.classList.toggle('comicsPanelMode', this.panelMode);

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

                this.pageCount = this.archiveSource.urls.length;
                this.currentPage = options.startPositionTicks / 10000 || 0;

                this.swiperInstance = new Swiper(elem.querySelector('.slideshowSwiperContainer'), {
                    direction: 'horizontal',
                    // loop is disabled due to the lack of Swiper support in virtual slides
                    loop: false,
                    zoom: {
                        minRatio: 1,
                        toggle: true,
                        containerClass: 'slider-zoom-container'
                    },
                    autoplay: false,
                    keyboard: {
                        enabled: true
                    },
                    preloadImages: true,
                    slidesPerView: this.comicsPlayerSettings.pagesPerView,
                    slidesPerGroup: this.comicsPlayerSettings.pagesPerView,
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
                    // reduces memory consumption for large libraries while allowing preloading of images
                    virtual: {
                        slides: this.archiveSource.urls,
                        cache: true,
                        renderSlide: this.getImgFromUrl,
                        addSlidesBefore: 1,
                        addSlidesAfter: 1
                    }
                });

                // save current page ( a page is an image file inside the archive )
                this.swiperInstance.on('slideChange', () => {
                    this.currentPage = this.swiperInstance.activeIndex;

                    if (this.panelMode) {
                        // Reset transforms on rendered slides to prevent carry-over between pages.
                        this.resetTransformsForAllSlides();
                        this.currentPanelIndex = 0;
                        this.applyPanelModeToActiveSlide(true).catch((err) => console.error('ComicsPlayer: applyPanelMode failed', err));
                    } else {
                        this.activePanelList = null;
                        this.updatePanelIndicator();
                    }

                    Events.trigger(this, 'pause');
                });

                if (this.panelMode) {
                    try {
                        this.swiperInstance?.zoom?.disable?.();
                    } catch (err) {
                        // ignore
                    }

                    this.resetTransformsForAllSlides();
                    this.currentPanelIndex = 0;
                    this.applyPanelModeToActiveSlide(true).catch((err) => console.error('ComicsPlayer: applyPanelMode failed', err));
                }
            }).catch((err) => {
                console.error('ComicsPlayer: failed to open comic', err);
                try { loading.hide(); } catch (e) { /* ignore */ }
                try {
                    dialogHelper.alert({
                        title: 'Unable to open comic',
                        text: (err && err.message) ? err.message : String(err)
                    });
                } catch (e) {
                    // ignore
                }
                try {
                    this.stop();
                } catch (e) {
                    // ignore
                }
                return undefined;
            });
    }

    getImgFromUrl(url) {
        return `<div class="swiper-slide">
                   <div class="slider-zoom-container">
                       <img src="${url}" class="swiper-slide-img">
                   </div>
               </div>`;
    }

    canPlayMediaType(mediaType) {
        return (mediaType || '').toLowerCase() === 'book';
    }

    canPlayItem(item) {
        return item.Path && FILE_EXTENSIONS.some(ext => item.Path.endsWith(ext));
    }
}

async function loadImageForAnalysis(url) {
    return new Promise((resolve, reject) => {
        const img = new Image();
        img.decoding = 'async';
        img.loading = 'eager';
        img.src = url;

        const done = () => resolve(img);
        img.addEventListener('load', done, { once: true });
        img.addEventListener('error', (e) => reject(e), { once: true });

        // Some browsers support decode() for faster async decode.
        if (typeof img.decode === 'function') {
            img.decode().then(done).catch(() => {
                // Ignore; we'll fall back to load event.
            });
        }
    });
}

function getOrderedPanels(analysis, langDir) {
    const cropBox = analysis?.cropBox || { x: 0, y: 0, w: 1, h: 1 };
    const panels = Array.isArray(analysis?.panels) ? analysis.panels : [];

    // Fallback to a single "smart crop" box when we can't confidently detect panels.
    const effective = panels.length >= 2 && panels.length <= 15 ? panels : [cropBox];

    return sortPanels(effective, langDir);
}

function analyzeComicPage(img) {
    const maxDim = 480;
    const iw = img.naturalWidth || img.width;
    const ih = img.naturalHeight || img.height;

    if (!iw || !ih) {
        return {
            cropBox: { x: 0, y: 0, w: 1, h: 1 },
            panels: []
        };
    }

    const scale = Math.min(1, maxDim / Math.max(iw, ih));
    const w = Math.max(1, Math.floor(iw * scale));
    const h = Math.max(1, Math.floor(ih * scale));

    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;

    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) {
        return {
            cropBox: { x: 0, y: 0, w: 1, h: 1 },
            panels: []
        };
    }

    ctx.drawImage(img, 0, 0, w, h);
    const data = ctx.getImageData(0, 0, w, h).data;

    // Estimate background from corners (most comics have white margins).
    const cornerIdx = [
        0,
        (w - 1) * 4,
        ((h - 1) * w) * 4,
        ((h - 1) * w + (w - 1)) * 4
    ];

    let bg = 0;
    for (const i of cornerIdx) {
        const r = data[i];
        const g = data[i + 1];
        const b = data[i + 2];
        bg += (r + g + b) / 3;
    }
    bg /= cornerIdx.length;

    const mask = new Uint8Array(w * h);
    let minX = w;
    let minY = h;
    let maxX = 0;
    let maxY = 0;
    let hasContent = false;

    // Build a simple "content" mask: pixels that differ from the background and aren't near-white.
    const bgDelta = 14;
    const nearWhite = 245;

    for (let y = 0; y < h; y += 1) {
        for (let x = 0; x < w; x += 1) {
            const idx = (y * w + x) * 4;
            const a = data[idx + 3];
            if (a < 40) continue;

            const r = data[idx];
            const g = data[idx + 1];
            const b = data[idx + 2];
            const gray = (r + g + b) / 3;

            const isContent = gray < nearWhite && Math.abs(gray - bg) > bgDelta;
            if (isContent) {
                mask[y * w + x] = 1;
                hasContent = true;

                if (x < minX) minX = x;
                if (y < minY) minY = y;
                if (x > maxX) maxX = x;
                if (y > maxY) maxY = y;
            }
        }
    }

    if (!hasContent) {
        return {
            cropBox: { x: 0, y: 0, w: 1, h: 1 },
            panels: []
        };
    }

    // Expand crop box slightly to avoid cutting art.
    const pad = 2;
    minX = Math.max(0, minX - pad);
    minY = Math.max(0, minY - pad);
    maxX = Math.min(w - 1, maxX + pad);
    maxY = Math.min(h - 1, maxY + pad);

    const crop = {
        x0: minX,
        y0: minY,
        x1: maxX + 1,
        y1: maxY + 1
    };

    const cropBox = {
        x: crop.x0 / w,
        y: crop.y0 / h,
        w: (crop.x1 - crop.x0) / w,
        h: (crop.y1 - crop.y0) / h
    };

    // Attempt to split the crop region into panels using gutter detection.
    const sat = buildSummedAreaTable(mask, w, h);
    const regions = splitIntoPanels(sat, w, h, crop, 0);

    const cropArea = Math.max(1, (crop.x1 - crop.x0) * (crop.y1 - crop.y0));
    const panels = regions
        .map(r => ({
            x: r.x0 / w,
            y: r.y0 / h,
            w: (r.x1 - r.x0) / w,
            h: (r.y1 - r.y0) / h,
            _area: ((r.x1 - r.x0) * (r.y1 - r.y0)) / cropArea
        }))
        // Filter very tiny regions (noise / captions).
        .filter(p => p._area >= 0.02 && p.w >= 0.08 && p.h >= 0.08)
        .map(({ _area, ...rest }) => rest);

    return {
        cropBox,
        panels
    };
}

function buildSummedAreaTable(mask, w, h) {
    // SAT size (w+1)*(h+1)
    const sat = new Uint32Array((w + 1) * (h + 1));
    for (let y = 1; y <= h; y += 1) {
        let rowSum = 0;
        for (let x = 1; x <= w; x += 1) {
            rowSum += mask[(y - 1) * w + (x - 1)];
            sat[y * (w + 1) + x] = sat[(y - 1) * (w + 1) + x] + rowSum;
        }
    }
    return sat;
}

function sumRegion(sat, w, x0, y0, x1, y1) {
    // x1,y1 are exclusive
    const stride = w + 1;
    const A = sat[y0 * stride + x0];
    const B = sat[y0 * stride + x1];
    const C = sat[y1 * stride + x0];
    const D = sat[y1 * stride + x1];
    return D - B - C + A;
}

function findHorizontalGutter(sat, w, region) {
    const { x0, y0, x1, y1 } = region;
    const width = x1 - x0;
    const height = y1 - y0;

    if (height < 80) return null;

    // Threshold: how many "content" pixels allowed in a gutter row.
    const maxRowContent = Math.max(1, Math.floor(width * 0.004));

    let best = null;
    let bandStart = -1;

    for (let y = y0 + 6; y < y1 - 6; y += 1) {
        const count = sumRegion(sat, w, x0, y, x1, y + 1);
        const isGutter = count <= maxRowContent;

        if (isGutter && bandStart === -1) {
            bandStart = y;
        } else if (!isGutter && bandStart !== -1) {
            const bandEnd = y;
            const bandSize = bandEnd - bandStart;
            if (bandSize >= 4) {
                const mid = (bandStart + bandEnd) / 2;
                const rel = (mid - y0) / height;

                // Prefer gutters near the middle (avoid splitting captions near edges).
                const centerScore = 1 - Math.abs(0.5 - rel);
                const score = bandSize * 1.5 + centerScore * 10;

                if (!best || score > best.score) {
                    best = { bandStart, bandEnd, score };
                }
            }
            bandStart = -1;
        }
    }

    return best;
}

function findVerticalGutter(sat, w, region) {
    const { x0, y0, x1, y1 } = region;
    const width = x1 - x0;
    const height = y1 - y0;

    if (width < 80) return null;

    const maxColContent = Math.max(1, Math.floor(height * 0.004));

    let best = null;
    let bandStart = -1;

    for (let x = x0 + 6; x < x1 - 6; x += 1) {
        const count = sumRegion(sat, w, x, y0, x + 1, y1);
        const isGutter = count <= maxColContent;

        if (isGutter && bandStart === -1) {
            bandStart = x;
        } else if (!isGutter && bandStart !== -1) {
            const bandEnd = x;
            const bandSize = bandEnd - bandStart;
            if (bandSize >= 4) {
                const mid = (bandStart + bandEnd) / 2;
                const rel = (mid - x0) / width;

                const centerScore = 1 - Math.abs(0.5 - rel);
                const score = bandSize * 1.5 + centerScore * 10;

                if (!best || score > best.score) {
                    best = { bandStart, bandEnd, score };
                }
            }
            bandStart = -1;
        }
    }

    return best;
}

function splitIntoPanels(sat, w, h, region, depth) {
    const { x0, y0, x1, y1 } = region;
    const width = x1 - x0;
    const height = y1 - y0;

    if (depth >= 4 || width < 120 || height < 120) {
        return [region];
    }

    const hGutter = findHorizontalGutter(sat, w, region);
    if (hGutter) {
        const top = { x0, y0, x1, y1: hGutter.bandStart };
        const bottom = { x0, y0: hGutter.bandEnd, x1, y1 };

        // Prevent tiny splits
        if ((top.y1 - top.y0) > 60 && (bottom.y1 - bottom.y0) > 60) {
            return [
                ...splitIntoPanels(sat, w, h, top, depth + 1),
                ...splitIntoPanels(sat, w, h, bottom, depth + 1)
            ];
        }
    }

    const vGutter = findVerticalGutter(sat, w, region);
    if (vGutter) {
        const left = { x0, y0, x1: vGutter.bandStart, y1 };
        const right = { x0: vGutter.bandEnd, y0, x1, y1 };

        if ((left.x1 - left.x0) > 60 && (right.x1 - right.x0) > 60) {
            return [
                ...splitIntoPanels(sat, w, h, left, depth + 1),
                ...splitIntoPanels(sat, w, h, right, depth + 1)
            ];
        }
    }

    return [region];
}

function sortPanels(panels, langDir) {
    const rtl = langDir === 'rtl';

    // Sort by top-to-bottom, then left-to-right (or right-to-left within rows).
    const withCenters = panels.map(p => ({
        ...p,
        cx: p.x + p.w / 2,
        cy: p.y + p.h / 2
    }));

    withCenters.sort((a, b) => a.cy - b.cy);

    const rows = [];
    const rowThreshold = 0.08; // normalized Y threshold for grouping panels into a row

    for (const p of withCenters) {
        const row = rows[rows.length - 1];
        if (!row) {
            rows.push([p]);
            continue;
        }

        const avgY = row.reduce((acc, r) => acc + r.cy, 0) / row.length;
        if (Math.abs(p.cy - avgY) <= rowThreshold) {
            row.push(p);
        } else {
            rows.push([p]);
        }
    }

    const ordered = [];
    for (const row of rows) {
        row.sort((a, b) => (rtl ? b.cx - a.cx : a.cx - b.cx));
        ordered.push(...row);
    }

    return ordered.map(({ cx, cy, ...rest }) => rest);
}

class ArchiveSource {
    constructor(url) {
        this.url = url;
        this.files = [];
        this.urls = [];
    }

    async load() {
        const res = await fetch(this.url);
        if (!res.ok) {
            return;
        }

        const blob = await res.blob();
        this.archive = await Archive.open(blob);
        this.raw = await this.archive.getFilesArray();
        await this.archive.extractFiles();

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

        for (const file of files) {
            /* eslint-disable-next-line compat/compat */
            const url = URL.createObjectURL(file.file);
            this.urls.push(url);
        }
    }

    release() {
        this.files = [];
        /* eslint-disable-next-line compat/compat */
        this.urls.forEach(URL.revokeObjectURL);
        this.urls = [];
    }
}

export default ComicsPlayer;

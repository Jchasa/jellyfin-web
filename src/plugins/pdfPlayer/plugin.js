import loading from '../../components/loading/loading';
import keyboardnavigation from '../../scripts/keyboardNavigation';
import dialogHelper from '../../components/dialogHelper/dialogHelper';
import dom from '../../utils/dom';
import { appRouter } from '../../components/router/appRouter';
import { ServerConnections } from 'lib/jellyfin-apiclient';
import { PluginType } from '../../types/plugin.ts';
import Events from '../../utils/events.ts';

import './style.scss';
import '../../elements/emby-button/paper-icon-button-light';

/**
 * Enhanced PDF Player (Jellyfin Web 10.11.x)
 * - Thumbnails sidebar
 * - Outline / TOC
 * - Search
 * - Zoom + fit controls
 * - Text selection layer (pdf.js text layer)
 */
export class PdfPlayer {
    constructor() {
        this.name = 'PDF Player';
        this.type = PluginType.MediaPlayer;
        this.id = 'pdfplayer';
        this.priority = 1;

        // State
        this.progress = 0; // 0-based page index
        this.loaded = false;
        this.cancellationToken = false;

        this.currentPageNumber = 1; // 1-based
        this.fitMode = 'page'; // 'page' | 'width'
        this.zoomFactor = 1; // additional zoom multiplier
        this._lastCssScale = 1;
        this.sidebarOpen = false;
        this.sidebarTab = 'thumbs'; // 'thumbs' | 'outline' | 'search'
        this.selectionEnabled = false;
        this.activeSearchQuery = '';
        this.searchToken = 0;
        this.renderToken = 0;

        // UI refs
        this._txtSearch = null;
        this._btnSearchClear = null;

        // Caches
        this.pagePromises = new Map(); // pageNumber -> Promise<PDFPageProxy>
        this.thumbRendered = new Set(); // pageNumber
        this.outlineBuilt = false;

        // Bound handlers
        this.bound = [];

        this.onDialogClosed = this.onDialogClosed.bind(this);
        this.onWindowKeyDown = this.onWindowKeyDown.bind(this);
        this.onTouchStart = this.onTouchStart.bind(this);
        this.onWindowResize = this.onWindowResize.bind(this);
    }

    play(options) {
        this.progress = 0;
        this.currentPageNumber = 1;
        this.loaded = false;
        this.cancellationToken = false;
        this.searchToken++;
        this.renderToken++;
        this.pagePromises.clear();
        this.thumbRendered.clear();
        this.outlineBuilt = false;

        loading.show();

        const elem = this.createMediaElement();
        return this.setCurrentSrc(elem, options);
    }

    stop() {
        this.unbindEvents();

        const stopInfo = {
            src: this.item
        };

        // Notify PlaybackManager that playback has stopped
        Events.trigger(this, 'stopped', [stopInfo]);

        const elem = this.mediaElement;
        if (elem) {
            dialogHelper.close(elem);
            this.mediaElement = null;
        }

        loading.hide();

        this.cancellationToken = true;
        this.searchToken++;
        this.renderToken++;
        this.pagePromises.clear();

        if (this.thumbObserver) {
            try {
                this.thumbObserver.disconnect();
            } catch (e) {
                // ignore
            }
            this.thumbObserver = null;
        }
    }

    destroy() {
        // Nothing to do here
    }

    currentItem() {
        return this.item;
    }

    currentTime() {
        return this.progress;
    }

    duration() {
        return this.book ? this.book.numPages : 0;
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

    onWindowKeyDown(e) {
        if (!this.loaded) return;

        // Skip modified keys
        if (e.ctrlKey || e.altKey || e.metaKey) return;

        const key = keyboardnavigation.getKeyName(e);

        switch (key) {
            case 'l':
            case 'ArrowRight':
            case 'Right':
                e.preventDefault();
                this.next();
                break;
            case 'j':
            case 'ArrowLeft':
            case 'Left':
                e.preventDefault();
                this.previous();
                break;
            case '+':
            case '=':
                e.preventDefault();
                this.zoomIn();
                break;
            case '-':
            case '_':
                e.preventDefault();
                this.zoomOut();
                break;
            case '0':
                e.preventDefault();
                this.resetZoom();
                break;
            case 'w':
                e.preventDefault();
                this.fitWidth();
                break;
            case 'p':
                e.preventDefault();
                this.fitPage();
                break;
            case 's':
                e.preventDefault();
                this.toggleSelection();
                break;
            case 't':
                e.preventDefault();
                this.toggleSidebar();
                break;
            case 'Escape':
                e.preventDefault();
                this.stop();
                break;
        }
    }

    onTouchStart(e) {
        // Touch navigation should not interfere with selecting text
        if (!this.loaded || !e.touches || e.touches.length === 0) return;
        if (this.selectionEnabled) return;

        if (e.touches[0].clientX < dom.getWindowSize().innerWidth / 2) {
            this.previous();
        } else {
            this.next();
        }
    }

    onWindowResize() {
        if (!this.loaded) return;
        clearTimeout(this._resizeTimer);
        this._resizeTimer = setTimeout(() => {
            if (!this.loaded) return;
            this.renderMainPage(this.currentPageNumber);
        }, 150);
    }

    onDialogClosed() {
        this.stop();
    }

    bind(el, eventName, handler, options) {
        el.addEventListener(eventName, handler, options);
        this.bound.push([el, eventName, handler, options]);
    }

    unbindAll() {
        for (const [el, eventName, handler, options] of this.bound) {
            try {
                el.removeEventListener(eventName, handler, options);
            } catch (e) {
                // ignore
            }
        }
        this.bound = [];
    }

    bindMediaElementEvents() {
        const elem = this.mediaElement;

        this.bind(elem, 'close', this.onDialogClosed, { once: true });

        const btnExit = elem.querySelector('.btnExit');
        if (btnExit) {
            this.bind(btnExit, 'click', this.onDialogClosed, { once: true });
        }

        const btnPrev = elem.querySelector('.btnPrev');
        const btnNext = elem.querySelector('.btnNext');
        const btnSidebar = elem.querySelector('.btnSidebar');
        const btnZoomIn = elem.querySelector('.btnZoomIn');
        const btnZoomOut = elem.querySelector('.btnZoomOut');
        const btnZoomReset = elem.querySelector('.btnZoomReset');
        const btnFitWidth = elem.querySelector('.btnFitWidth');
        const btnFitPage = elem.querySelector('.btnFitPage');
        const btnSelect = elem.querySelector('.btnSelect');

        if (btnPrev) this.bind(btnPrev, 'click', () => this.previous());
        if (btnNext) this.bind(btnNext, 'click', () => this.next());
        if (btnSidebar) this.bind(btnSidebar, 'click', () => this.toggleSidebar());
        if (btnZoomIn) this.bind(btnZoomIn, 'click', () => this.zoomIn());
        if (btnZoomOut) this.bind(btnZoomOut, 'click', () => this.zoomOut());
        if (btnZoomReset) this.bind(btnZoomReset, 'click', () => this.resetZoom());
        if (btnFitWidth) this.bind(btnFitWidth, 'click', () => this.fitWidth());
        if (btnFitPage) this.bind(btnFitPage, 'click', () => this.fitPage());
        if (btnSelect) this.bind(btnSelect, 'click', () => this.toggleSelection());

        // Sidebar tabs
        elem.querySelectorAll('.pdfSidebarTabButton').forEach(btn => {
            this.bind(btn, 'click', () => {
                const tab = btn.getAttribute('data-tab');
                this.setSidebarTab(tab);
            });
        });

        // Search box
        const txtSearch = elem.querySelector('.txtPdfSearch');
        const btnSearch = elem.querySelector('.btnPdfSearch');
        const btnSearchClear = elem.querySelector('.btnPdfSearchClear');

        this._txtSearch = txtSearch;
        this._btnSearchClear = btnSearchClear;
        this.updateSearchClearVisibility();

        if (txtSearch) {
            this.bind(txtSearch, 'keydown', (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    this.startSearch();
                }
            });
            this.bind(txtSearch, 'input', () => this.updateSearchClearVisibility());
        }
        if (btnSearch) this.bind(btnSearch, 'click', () => this.startSearch());
        if (btnSearchClear) this.bind(btnSearchClear, 'click', () => this.clearSearch());

        // Click-to-jump within results list is handled when rendering results
    }

    bindEvents() {
        this.bindMediaElementEvents();
        document.addEventListener('keydown', this.onWindowKeyDown);
        document.addEventListener('touchstart', this.onTouchStart);
        window.addEventListener('resize', this.onWindowResize);
    }

    unbindEvents() {
        this.unbindAll();
        document.removeEventListener('keydown', this.onWindowKeyDown);
        document.removeEventListener('touchstart', this.onTouchStart);
        window.removeEventListener('resize', this.onWindowResize);
    }

    createMediaElement() {
        let elem = this.mediaElement;
        if (elem) {
            return elem;
        }

        elem = document.getElementById('pdfPlayer');
        if (!elem) {
            elem = dialogHelper.createDialog({
                size: 'fullscreen',
                autoFocus: false,
                scrollY: false,
                exitAnimation: 'fadeout',
                removeOnClose: true
            });

            let html = '';
            html += '<div class="pdfChrome">';
            html += '  <div class="pdfTopBar">';
            html += '    <button is="paper-icon-button-light" class="pdfIconButton btnSidebar" tabindex="-1" title="Sidebar"><span class="material-icons actionButtonIcon" aria-hidden="true">menu</span></button>';
            html += '    <button is="paper-icon-button-light" class="pdfIconButton btnPrev" tabindex="-1" title="Previous page"><span class="material-icons actionButtonIcon" aria-hidden="true">chevron_left</span></button>';
            html += '    <div class="pdfPageIndicator" aria-live="polite"><span class="txtPage"></span></div>';
            html += '    <button is="paper-icon-button-light" class="pdfIconButton btnNext" tabindex="-1" title="Next page"><span class="material-icons actionButtonIcon" aria-hidden="true">chevron_right</span></button>';
            html += '    <div class="pdfTopBarSpacer"></div>';
            html += '    <button class="pdfTextButton btnFitWidth" tabindex="-1" title="Fit width">Width</button>';
            html += '    <button class="pdfTextButton btnFitPage" tabindex="-1" title="Fit page">Page</button>';
            html += '    <button is="paper-icon-button-light" class="pdfIconButton btnZoomOut" tabindex="-1" title="Zoom out"><span class="material-icons actionButtonIcon" aria-hidden="true">zoom_out</span></button>';
            html += '    <button class="pdfZoomReadout btnZoomReset" tabindex="-1" title="Reset zoom"><span class="txtZoom"></span></button>';
            html += '    <button is="paper-icon-button-light" class="pdfIconButton btnZoomIn" tabindex="-1" title="Zoom in"><span class="material-icons actionButtonIcon" aria-hidden="true">zoom_in</span></button>';
            html += '    <button is="paper-icon-button-light" class="pdfIconButton btnSelect" tabindex="-1" title="Toggle text selection"><span class="material-icons actionButtonIcon" aria-hidden="true">text_fields</span></button>';
            html += '    <button is="paper-icon-button-light" class="btnExit btnPdfExit" title="Close"><span class="material-icons actionButtonIcon" aria-hidden="true">close</span></button>';            html += '  </div>';

            html += '  <div class="pdfMain">';
            html += '    <aside class="pdfSidebar" aria-label="PDF sidebar">';
            html += '      <div class="pdfSidebarTabs" role="tablist">';
            html += '        <button class="pdfSidebarTabButton is-active" role="tab" data-tab="thumbs" aria-selected="true">Thumbnails</button>';
            html += '        <button class="pdfSidebarTabButton" role="tab" data-tab="outline" aria-selected="false">Outline</button>';
            html += '        <button class="pdfSidebarTabButton" role="tab" data-tab="search" aria-selected="false">Search</button>';
            html += '      </div>';
            html += '      <div class="pdfSidebarBody">';
            html += '        <div class="pdfSidebarPanel pdfPanelThumbs is-active" data-panel="thumbs"><div class="pdfThumbList"></div></div>';
            html += '        <div class="pdfSidebarPanel pdfPanelOutline" data-panel="outline"><div class="pdfOutlineList"></div></div>';
            html += '        <div class="pdfSidebarPanel pdfPanelSearch" data-panel="search">';
            html += '          <div class="pdfSearchRow">';
            html += '            <input class="txtPdfSearch" type="search" placeholder="Search in document..." aria-label="Search in PDF" />';
            html += '            <button is="paper-icon-button-light" class="pdfIconButton btnPdfSearch" tabindex="-1" title="Search"><span class="material-icons actionButtonIcon" aria-hidden="true">search</span></button>';
            html += '            <button is="paper-icon-button-light" class="pdfIconButton btnPdfSearchClear" tabindex="-1" title="Clear search"><span class="material-icons actionButtonIcon" aria-hidden="true">backspace</span></button>';
            html += '          </div>';
            html += '          <div class="pdfSearchStatus"></div>';
            html += '          <div class="pdfSearchResults"></div>';
            html += '        </div>';
            html += '      </div>';
            html += '    </aside>';

            html += '    <div class="pdfViewport" aria-label="PDF viewer">';
            html += '      <div class="pdfPageContainer">';
            html += '        <canvas id="canvas"></canvas>';
            html += '        <div id="textLayer" class="textLayer"></div>';
            html += '      </div>';
            html += '    </div>';
            html += '  </div>';
            html += '</div>';

            elem.id = 'pdfPlayer';
            elem.innerHTML = html;

            dialogHelper.open(elem);
        }

        this.mediaElement = elem;
        // default collapsed sidebar
        this.applySidebarState();
        this.applySelectionState();
        return elem;
    }

    async setCurrentSrc(elem, options) {
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

        const serverId = item.ServerId;
        const apiClient = ServerConnections.getApiClient(serverId);

        const { GlobalWorkerOptions, getDocument, renderTextLayer } = await import('pdfjs-dist');

        const downloadHref = apiClient.getItemDownloadUrl(item.Id);

        this.bindEvents();
        GlobalWorkerOptions.workerSrc = appRouter.baseUrl() + '/libraries/pdf.worker.js';

        const downloadTask = getDocument({
            url: downloadHref,
            // Disable for PDF.js XSS vulnerability
            // https://github.com/mozilla/pdf.js/security/advisories/GHSA-wgrm-67xf-hhpq
            isEvalSupported: false
        });

        this._renderTextLayer = renderTextLayer;

        const book = await downloadTask.promise;
        if (this.cancellationToken) return;

        this.book = book;
        this.loaded = true;

        // Determine start page (Jellyfin passes "ticks" where 10000 = one page)
        const ticks = options.startPositionTicks || 0;
        const startIndex = ticks / 10000;
        const startPage = Math.max(1, Math.min(this.duration(), Math.floor(startIndex) + 1));

        this.progress = startPage - 1;
        this.currentPageNumber = startPage;

        // Build sidebars
        this.buildThumbnails();
        await this.buildOutline();

        // Render initial page
        await this.renderMainPage(startPage);

        loading.hide();
    }

    next() {
        if (!this.loaded) return;
        if (this.currentPageNumber >= this.duration()) return;

        this.currentPageNumber += 1;
        this.progress = this.currentPageNumber - 1;
        this.renderMainPage(this.currentPageNumber);

        Events.trigger(this, 'pause');
    }

    previous() {
        if (!this.loaded) return;
        if (this.currentPageNumber <= 1) return;

        this.currentPageNumber -= 1;
        this.progress = this.currentPageNumber - 1;
        this.renderMainPage(this.currentPageNumber);

        Events.trigger(this, 'pause');
    }

    goToPage(pageNumber) {
        if (!this.loaded) return;
        const n = Math.max(1, Math.min(this.duration(), pageNumber));
        this.currentPageNumber = n;
        this.progress = n - 1;
        this.renderMainPage(n);

        Events.trigger(this, 'pause');
    }

    async getPage(pageNumber) {
        if (!this.book) throw new Error('PDF not loaded');
        if (!this.pagePromises.has(pageNumber)) {
            this.pagePromises.set(pageNumber, this.book.getPage(pageNumber));
        }
        return this.pagePromises.get(pageNumber);
    }

    prunePageCache(centerPageNumber) {
        // keep a small window around current page to avoid unbounded growth
        const keep = new Set();
        for (let i = -3; i <= 3; i++) {
            const p = centerPageNumber + i;
            if (p >= 1 && p <= this.duration()) keep.add(p);
        }
        for (const key of this.pagePromises.keys()) {
            if (!keep.has(key)) {
                this.pagePromises.delete(key);
            }
        }
    }

    computeBaseScale(originalViewport, containerRect) {
        const widthScale = containerRect.width / originalViewport.width;
        const pageScale = Math.min(containerRect.width / originalViewport.width, containerRect.height / originalViewport.height);
        return this.fitMode === 'width' ? widthScale : pageScale;
    }

    updateIndicators() {
        const elem = this.mediaElement;
        if (!elem) return;

        const txtPage = elem.querySelector('.txtPage');
        const txtZoom = elem.querySelector('.txtZoom');

        if (txtPage) {
            const total = this.duration() || 0;
            txtPage.textContent = `${this.currentPageNumber} / ${total}`;
        }

        if (txtZoom) {
            const pct = Math.round(this._lastCssScale * 100);
            txtZoom.textContent = `${pct}%`;
        }

        const btnPrev = elem.querySelector('.btnPrev');
        const btnNext = elem.querySelector('.btnNext');

        if (btnPrev) btnPrev.disabled = this.currentPageNumber <= 1;
        if (btnNext) btnNext.disabled = this.currentPageNumber >= this.duration();

        // Selection button state
        const btnSelect = elem.querySelector('.btnSelect');
        if (btnSelect) {
            btnSelect.classList.toggle('is-active', this.selectionEnabled);
        }

        // Highlight current thumb
        elem.querySelectorAll('.pdfThumbItem').forEach(t => {
            const p = parseInt(t.getAttribute('data-page') || '0', 10);
            t.classList.toggle('is-current', p === this.currentPageNumber);
        });
    }

    async renderMainPage(pageNumber) {
        if (!this.mediaElement || !this.book) return;

        const token = ++this.renderToken;
        const elem = this.mediaElement;

        loading.show();

        try {
            const page = await this.getPage(pageNumber);
            if (this.cancellationToken || token !== this.renderToken) return;

            const viewportEl = elem.querySelector('.pdfViewport');
            const pageContainer = elem.querySelector('.pdfPageContainer');
            const canvas = elem.querySelector('#canvas');
            const textLayerDiv = elem.querySelector('#textLayer');

            if (!viewportEl || !pageContainer || !canvas || !textLayerDiv) return;

            const containerRect = viewportEl.getBoundingClientRect();
            const original = page.getViewport({ scale: 1 });

            const base = this.computeBaseScale(original, containerRect);
            const cssScale = Math.max(0.1, Math.min(10, base * this.zoomFactor));
            this._lastCssScale = cssScale;

            const viewport = page.getViewport({ scale: cssScale });

            // Size container
            pageContainer.style.width = `${Math.floor(viewport.width)}px`;
            pageContainer.style.height = `${Math.floor(viewport.height)}px`;

            // HiDPI canvas render using transform
            const outputScale = window.devicePixelRatio || 1;

            canvas.width = Math.floor(viewport.width * outputScale);
            canvas.height = Math.floor(viewport.height * outputScale);
            canvas.style.width = `${Math.floor(viewport.width)}px`;
            canvas.style.height = `${Math.floor(viewport.height)}px`;

            const ctx = canvas.getContext('2d');
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, canvas.width, canvas.height);

            const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

            const renderTask = page.render({
                canvasContext: ctx,
                transform,
                viewport
            });

            await renderTask.promise;
            if (this.cancellationToken || token !== this.renderToken) return;

            // Text layer (for selection + search highlight)
            await this.renderTextLayerForPage(page, viewport, token);

            this.updateIndicators();
            this.prunePageCache(pageNumber);
        } catch (err) {
            console.error('[pdfPlayer] Failed to render page', err);
        } finally {
            loading.hide();
        }
    }

    async renderTextLayerForPage(page, viewport, token) {
        const elem = this.mediaElement;
        if (!elem) return;

        const textLayerDiv = elem.querySelector('#textLayer');
        if (!textLayerDiv) return;

        // Show text layer when selection is enabled OR an active search exists.
        const shouldShow = this.selectionEnabled || !!this.activeSearchQuery;
        textLayerDiv.classList.toggle('is-visible', shouldShow);
        textLayerDiv.classList.toggle('is-selectable', this.selectionEnabled);

        // If we don't need it visible, keep it cleared for perf.
        if (!shouldShow) {
            textLayerDiv.innerHTML = '';
            return;
        }

        if (!this._renderTextLayer) {
            // renderTextLayer missing (unexpected on pdfjs 3.11.x), fallback: clear
            textLayerDiv.innerHTML = '';
            return;
        }

        try {
            const textContent = await page.getTextContent();
            if (this.cancellationToken || token !== this.renderToken) return;

            textLayerDiv.innerHTML = '';
            // PDF.js uses this CSS variable in viewer styles; we set it for better alignment.
            textLayerDiv.style.setProperty('--scale-factor', viewport.scale);

            const task = this._renderTextLayer({
                textContentSource: textContent,
                container: textLayerDiv,
                viewport,
                textDivs: [],
                enhanceTextSelection: true
            });

            // renderTextLayer returns either a promise or an object with .promise (depending on build)
            if (task && task.promise) {
                await task.promise;
            } else if (task && typeof task.then === 'function') {
                await task;
            }

            if (this.cancellationToken || token !== this.renderToken) return;

            this.applySearchHighlights();
        } catch (err) {
            console.warn('[pdfPlayer] Failed to render text layer', err);
            textLayerDiv.innerHTML = '';
        }
    }

    applySearchHighlights() {
        const elem = this.mediaElement;
        if (!elem) return;

        const q = (this.activeSearchQuery || '').trim().toLowerCase();
        const textLayerDiv = elem.querySelector('#textLayer');
        if (!textLayerDiv) return;

        // Clear
        textLayerDiv.querySelectorAll('.pdfSearchHit').forEach(el => {
            el.classList.remove('pdfSearchHit');
        });

        if (!q) return;

        // Simple highlight: mark spans that contain the query (case-insensitive)
        const spans = textLayerDiv.querySelectorAll('span');
        spans.forEach(s => {
            const t = (s.textContent || '').toLowerCase();
            if (t && t.includes(q)) {
                s.classList.add('pdfSearchHit');
            }
        });
    }

    toggleSidebar() {
        this.sidebarOpen = !this.sidebarOpen;
        this.applySidebarState();
        // re-render to update fit calc with changed viewport size
        this.renderMainPage(this.currentPageNumber);
    }

    applySidebarState() {
        const elem = this.mediaElement;
        if (!elem) return;
        elem.classList.toggle('sidebar-open', this.sidebarOpen);
        // keep tab state applied
        this.setSidebarTab(this.sidebarTab);
    }

    setSidebarTab(tab) {
        if (!tab) return;
        this.sidebarTab = tab;

        const elem = this.mediaElement;
        if (!elem) return;

        elem.querySelectorAll('.pdfSidebarTabButton').forEach(btn => {
            const t = btn.getAttribute('data-tab');
            const active = t === tab;
            btn.classList.toggle('is-active', active);
            btn.setAttribute('aria-selected', active ? 'true' : 'false');
        });

        elem.querySelectorAll('.pdfSidebarPanel').forEach(panel => {
            const p = panel.getAttribute('data-panel');
            panel.classList.toggle('is-active', p === tab);
        });
    }

    toggleSelection() {
        this.selectionEnabled = !this.selectionEnabled;
        this.applySelectionState();
        this.renderMainPage(this.currentPageNumber);
    }

    applySelectionState() {
        const elem = this.mediaElement;
        if (!elem) return;
        elem.classList.toggle('selection-enabled', this.selectionEnabled);
        this.updateIndicators();
    }

    zoomIn() {
        this.zoomFactor = Math.min(5, this.zoomFactor * 1.1);
        this.renderMainPage(this.currentPageNumber);
    }

    zoomOut() {
        this.zoomFactor = Math.max(0.2, this.zoomFactor / 1.1);
        this.renderMainPage(this.currentPageNumber);
    }

    resetZoom() {
        this.zoomFactor = 1;
        this.renderMainPage(this.currentPageNumber);
    }

    fitWidth() {
        this.fitMode = 'width';
        this.zoomFactor = 1;
        this.renderMainPage(this.currentPageNumber);
    }

    fitPage() {
        this.fitMode = 'page';
        this.zoomFactor = 1;
        this.renderMainPage(this.currentPageNumber);
    }

    buildThumbnails() {
        const elem = this.mediaElement;
        if (!elem || !this.book) return;

        const list = elem.querySelector('.pdfThumbList');
        if (!list) return;

        list.innerHTML = '';

        const total = this.duration();
        for (let p = 1; p <= total; p++) {
            const item = document.createElement('div');
            item.className = 'pdfThumbItem';
            item.setAttribute('data-page', String(p));
            item.innerHTML = `
                <div class="pdfThumbCanvasWrap">
                    <canvas class="pdfThumbCanvas"></canvas>
                </div>
                <div class="pdfThumbLabel">${p}</div>
            `;
            item.addEventListener('click', () => this.goToPage(p));
            list.appendChild(item);
        }

        // Lazy render thumbs
        if (this.thumbObserver) {
            try { this.thumbObserver.disconnect(); } catch (e) { /* ignore */ }
        }

        this.thumbObserver = new IntersectionObserver((entries) => {
            entries.forEach(entry => {
                if (!entry.isIntersecting) return;
                const el = entry.target;
                const pageNumber = parseInt(el.getAttribute('data-page') || '0', 10);
                if (!pageNumber || this.thumbRendered.has(pageNumber)) return;
                this.thumbRendered.add(pageNumber);
                this.renderThumbnail(el, pageNumber);
            });
        }, {
            root: list,
            rootMargin: '300px'
        });

        list.querySelectorAll('.pdfThumbItem').forEach(el => this.thumbObserver.observe(el));
        this.updateIndicators();
    }

    async renderThumbnail(thumbItemEl, pageNumber) {
        try {
            const page = await this.getPage(pageNumber);
            if (!page) return;

            const canvas = thumbItemEl.querySelector('canvas');
            if (!canvas) return;

            const desiredWidth = 140;
            const original = page.getViewport({ scale: 1 });
            const cssScale = desiredWidth / original.width;
            const viewport = page.getViewport({ scale: cssScale });

            const outputScale = window.devicePixelRatio || 1;
            canvas.width = Math.floor(viewport.width * outputScale);
            canvas.height = Math.floor(viewport.height * outputScale);
            canvas.style.width = `${Math.floor(viewport.width)}px`;
            canvas.style.height = `${Math.floor(viewport.height)}px`;

            const ctx = canvas.getContext('2d');
            const transform = outputScale !== 1 ? [outputScale, 0, 0, outputScale, 0, 0] : null;

            const task = page.render({
                canvasContext: ctx,
                transform,
                viewport
            });

            await task.promise;
        } catch (e) {
            // Ignore thumb failures
        }
    }

    async buildOutline() {
        const elem = this.mediaElement;
        if (!elem || !this.book || this.outlineBuilt) return;

        const outlineContainer = elem.querySelector('.pdfOutlineList');
        if (!outlineContainer) return;

        outlineContainer.innerHTML = '<div class="pdfSidebarEmpty">Loading outline…</div>';

        try {
            const outline = await this.book.getOutline();
            if (!outline || outline.length === 0) {
                outlineContainer.innerHTML = '<div class="pdfSidebarEmpty">No outline found.</div>';
                this.outlineBuilt = true;
                return;
            }

            outlineContainer.innerHTML = '';
            const list = document.createElement('div');
            list.className = 'pdfOutlineTree';
            outlineContainer.appendChild(list);

            const addItems = (items, parent, depth) => {
                items.forEach(it => {
                    const row = document.createElement('div');
                    row.className = 'pdfOutlineItem';
                    row.style.paddingLeft = `${8 + depth * 14}px`;
                    row.textContent = it.title || 'Untitled';

                    row.addEventListener('click', async () => {
                        const pageNum = await this.resolveDestinationToPage(it.dest);
                        if (pageNum) {
                            this.goToPage(pageNum);
                            this.sidebarOpen = true;
                            this.applySidebarState();
                        }
                    });

                    parent.appendChild(row);

                    if (it.items && it.items.length) {
                        addItems(it.items, parent, depth + 1);
                    }
                });
            };

            addItems(outline, list, 0);
            this.outlineBuilt = true;
        } catch (err) {
            outlineContainer.innerHTML = '<div class="pdfSidebarEmpty">Failed to load outline.</div>';
            this.outlineBuilt = true;
        }
    }

    async resolveDestinationToPage(dest) {
        if (!this.book || !dest) return null;

        try {
            let destination = dest;
            if (typeof dest === 'string') {
                destination = await this.book.getDestination(dest);
            }
            if (!destination) return null;

            const ref = destination[0];
            const index = await this.book.getPageIndex(ref);
            return index + 1;
        } catch (e) {
            return null;
        }
    }


    updateSearchClearVisibility() {
        const elem = this.mediaElement;
        const input = this._txtSearch || (elem ? elem.querySelector('.txtPdfSearch') : null);
        const btn = this._btnSearchClear || (elem ? elem.querySelector('.btnPdfSearchClear') : null);
        if (!input || !btn) return;

        const hasText = (input.value || '').trim().length > 0;
        btn.classList.toggle('is-hidden', !hasText);
    }

    startSearch() {
        const elem = this.mediaElement;
        if (!elem || !this.book) return;

        const input = elem.querySelector('.txtPdfSearch');
        const query = (input && input.value ? input.value : '').trim();

        this.activeSearchQuery = query;
        this.updateSearchClearVisibility();
        this.applySidebarState();
        this.setSidebarTab('search');

        if (!query) {
            this.clearSearch();
            return;
        }

        this.performSearch(query);
        // Ensure text layer shows for highlight
        this.renderMainPage(this.currentPageNumber);
    }

    clearSearch() {
        const elem = this.mediaElement;
        if (!elem) return;

        const input = elem.querySelector('.txtPdfSearch');
        if (input) input.value = '';
        this.updateSearchClearVisibility();

        this.activeSearchQuery = '';
        this.searchToken++;

        const status = elem.querySelector('.pdfSearchStatus');
        const results = elem.querySelector('.pdfSearchResults');

        if (status) status.textContent = '';
        if (results) results.innerHTML = '';

        this.renderMainPage(this.currentPageNumber);
    }

    async performSearch(query) {
        const elem = this.mediaElement;
        if (!elem || !this.book) return;

        const token = ++this.searchToken;
        const q = query.toLowerCase();
        const total = this.duration();

        const status = elem.querySelector('.pdfSearchStatus');
        const results = elem.querySelector('.pdfSearchResults');

        if (status) status.textContent = 'Searching…';
        if (results) results.innerHTML = '';

        const hits = [];

        for (let p = 1; p <= total; p++) {
            if (this.cancellationToken || token !== this.searchToken) return;

            try {
                const page = await this.getPage(p);
                const textContent = await page.getTextContent();
                if (this.cancellationToken || token !== this.searchToken) return;

                const text = (textContent.items || []).map(i => i.str || '').join(' ');
                const lower = text.toLowerCase();

                let idx = lower.indexOf(q);
                while (idx !== -1) {
                    const start = Math.max(0, idx - 40);
                    const end = Math.min(lower.length, idx + q.length + 40);
                    const snippet = text.slice(start, end).replace(/\s+/g, ' ').trim();
                    hits.push({ page: p, snippet });
                    idx = lower.indexOf(q, idx + q.length);
                    if (hits.length >= 500) break; // hard cap
                }
            } catch (e) {
                // ignore page errors
            }

            if (p % 5 === 0 && status) {
                status.textContent = `Searching… (${p}/${total})`;
                await new Promise(r => setTimeout(r, 0));
            }
        }

        if (this.cancellationToken || token !== this.searchToken) return;

        if (status) status.textContent = hits.length ? `${hits.length} match(es)` : 'No matches';

        if (!results) return;

        results.innerHTML = '';
        hits.slice(0, 200).forEach((hit) => {
            const row = document.createElement('div');
            row.className = 'pdfSearchResult';
            row.innerHTML = `<div class="pdfSearchResultPage">Page ${hit.page}</div><div class="pdfSearchResultSnippet"></div>`;
            const snipEl = row.querySelector('.pdfSearchResultSnippet');
            if (snipEl) snipEl.textContent = hit.snippet;
            row.addEventListener('click', () => {
                this.goToPage(hit.page);
            });
            results.appendChild(row);
        });

        // Render highlights on current page
        this.renderMainPage(this.currentPageNumber);
    }

    canPlayMediaType(mediaType) {
        return (mediaType || '').toLowerCase() === 'book';
    }

    canPlayItem(item) {
        return item.Path ? item.Path.toLowerCase().endsWith('pdf') : false;
    }
}

export default PdfPlayer;

<h1 align="center">Jellyfin Web</h1>
<h3 align="center">Part of the <a href="https://jellyfin.org">Jellyfin Project</a></h3>

---

<p align="center">
<img alt="Logo Banner" src="https://raw.githubusercontent.com/jellyfin/jellyfin-ux/master/branding/SVG/banner-logo-solid.svg?sanitize=true"/>
<br/>
<br/>
<a href="https://github.com/jellyfin/jellyfin-web">
<img alt="GPL 2.0 License" src="https://img.shields.io/github/license/jellyfin/jellyfin-web.svg"/>
</a>
<a href="https://github.com/jellyfin/jellyfin-web/releases">
<img alt="Current Release" src="https://img.shields.io/github/release/jellyfin/jellyfin-web.svg"/>
</a>
<a href="https://translate.jellyfin.org/projects/jellyfin/jellyfin-web/?utm_source=widget">
<img src="https://translate.jellyfin.org/widgets/jellyfin/-/jellyfin-web/svg-badge.svg" alt="Translation Status"/>
</a>
<br/>
<a href="https://opencollective.com/jellyfin">
<img alt="Donate" src="https://img.shields.io/opencollective/all/jellyfin.svg?label=backers"/>
</a>
<a href="https://features.jellyfin.org">
<img alt="Feature Requests" src="https://img.shields.io/badge/fider-vote%20on%20features-success.svg"/>
</a>
<a href="https://matrix.to/#/+jellyfin:matrix.org">
<img alt="Chat on Matrix" src="https://img.shields.io/matrix/jellyfin:matrix.org.svg?logo=matrix"/>
</a>
<a href="https://www.reddit.com/r/jellyfin">
<img alt="Join our Subreddit" src="https://img.shields.io/badge/reddit-r%2Fjellyfin-%23FF5700.svg"/>
</a>
</p>

Jellyfin Web is the frontend used for most of the clients available for end users, such as desktop browsers, Android, and iOS. We welcome all contributions and pull requests! If you have a larger feature in mind please open an issue so we can discuss the implementation before you start. Translations can be improved very easily from our <a href="https://translate.jellyfin.org/projects/jellyfin/jellyfin-web">Weblate</a> instance. Look through the following graphic to see if your native language could use some work!

## Roadmap

### PDF Player (best “reader-like” features)

- Page thumbnails sidebar
- Outline / TOC (PDF bookmarks)
- Search inside PDF
- Zoom controls (fit width / fit page + manual zoom)
- Text selection layer (pdf.js text layer)

### Comics Player (best “comic-reader” features)

- Smart crop / panel mode (guided view)
- Better zoom + pan gestures (double-tap zoom, pinch zoom that feels native)
- Prefetch tuning (performance on huge archives)
- Per-book settings (remember single vs double-page, LTR/RTL per series)

### Book Player (EPUB)

It’s already the most “complete,” but good upgrades are:

- Font family + line height + margins
- Theme customization (true sepia / true black)
- Better TOC UX (search within TOC, current chapter highlight)

### Book library type icon instead of Play Button

- changes the triangle “Play” overlay to a book icon and changes the tooltip to “Read” (or “Resume” if there’s a saved position).

### More book custimazation

- For items that are Type=Book/ComicBook/Magazine (or MediaType=Book):

Tooltip/text: Play → Read (or Continue reading when resumable)

Icon swaps based on file format:

PDF → picture_as_pdf

EPUB → auto_stories

CBZ/CBR/CBT/CB7 → collections_bookmark

fallback → menu_book

- Where it applies

Card overlays (legacy cardBuilder.js and the newer React card overlay components)

Hover/fab overlay button

List view image action button

Item context menu (including “Play from here” → “Read from here”)

Item details page play button tooltip + icon

Experimental details page Play/Resume button

## Build Process

### Dependencies

- [Node.js](https://nodejs.org/en/download)
- npm (included in Node.js)

### Getting Started

1. Clone or download this repository.

   ```sh
   git clone https://github.com/jellyfin/jellyfin-web.git
   cd jellyfin-web
   ```

2. Install build dependencies in the project directory.

   ```sh
   npm install
   ```

3. Run the web client with webpack for local development.

   ```sh
   npm start
   ```

4. Build the client with sourcemaps available.

   ```sh
   npm run build:development
   ```

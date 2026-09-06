# VidSnatch

A powerful Manifest V3 browser extension for Chrome and Brave that detects and downloads videos from any webpage, including HLS/TS streams.

## Features

- **Universal Video Detection:** Scans DOM, Shadow DOM, and intercepts network requests to find video files (`.mp4`, `.webm`, etc.).
- **HLS/TS Stream Merging:** Detects `.m3u8` playlists and `.ts` segments, downloads all segments, and merges them into a single playable file.
- **Mux Player Support:** Specifically traverses Shadow DOM to detect Mux web components (`<mux-player>`) and extracts stream URLs.
- **Direct Downloads:** Downloads videos directly to your computer with progress tracking.
- **Format Selection:** Choose between MP4 and WebM (or TS for streams) before downloading.
- **Sleek Dark UI:** Modern, responsive popup interface with progress bars and metadata badges.

## Installation

### Load Unpacked (Developer Mode)

1. Download the latest release `.zip` file from the [Releases](../../releases) page and extract it, or clone this repository.
2. Open your Chromium-based browser (Chrome, Brave, Edge) and navigate to the extensions page (e.g., `chrome://extensions/` or `brave://extensions/`).
3. Enable **Developer mode** (usually a toggle in the top right corner).
4. Click **Load unpacked**.
5. Select the `VidSnatch` folder.

## Usage

1. Pin the VidSnatch extension to your browser toolbar for easy access.
2. Navigate to a webpage containing a video.
3. The extension icon will display a badge with the number of detected videos.
4. Click the extension icon to open the popup.
5. Select your desired output format from the dropdown.
6. Click **Save to Computer** (or **Merge & Save** for streams).
7. Wait for the download and/or merging process to complete.

## Limitations

- The extension can only download directly accessible video URLs and streams served over HTTP.
- It **cannot** download DRM-protected content (e.g., Netflix, Hulu, Disney+) due to encryption.

## License

MIT License

# Changelog

## [1.1.13] - 2026-09-04

### Highlights

- Improved Android keyboard behavior so the composer stays visible and the keyboard send action submits once.
- Added native mobile upload handling for images, text/code, PDF, Office/OpenDocument documents and EPUB/MOBI ebooks.
- Added image follow-up context and automatic text/image model fallback without replaying a request after partial output.
- Improved WebSocket streaming reliability with heartbeat, stall detection, REST fallback and safer cancellation.
- Added account isolation, generation guards and multi-conversation concurrency protections.
- Added shared image-provider concurrency control with FIFO queueing, cancellation and bounded retry for upstream 429 concurrency errors.
- Added administrator/user management, model discovery and server-side API-key protection updates.
- Added public-facing documentation, contribution guidance and GitHub issue forms.

### Verification

- `npm run verify` passed.
- `npm run build` passed.
- Mobile: 12 test files / 44 tests passed.
- Gateway: 7 test files / 58 tests passed.

### Upgrade notes

- Read [`docs/DEPLOYMENT.md`](./docs/DEPLOYMENT.md) before deploying to production.
- Preserve `SERVER_MASTER_KEY` when upgrading an existing database; changing it makes encrypted provider keys unreadable.
- Do not publish the LAN test APK as a public production build. Public downloads should use a signed GitHub Release asset or a trusted HTTPS/Range-capable CDN.

## Previous versions

Earlier versions are available in the Git history. Binary installation packages should be distributed through GitHub Releases rather than committed to the repository.

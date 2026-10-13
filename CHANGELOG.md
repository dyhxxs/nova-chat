# Changelog

## [1.1.27] - 2026-10-13

### Highlights

- Add AI companions with editable personality, speaking style, user-managed memory and appearance.
- Introduce the v8 default character: an adult female sophomore with a distinct voice, short everyday replies and mood carried through conversation context.
- Preserve custom persona fields when upgrading exact legacy defaults; retain memories and reference photos.
- Add reference-face character photos, appearance upload/cropping and recovery from failed photo requests.
- Separate regular chat, companion chat and companion image providers, with administrator model discovery, searchable selection and explicit save.
- Keep provider addresses and keys write-only; require a replacement key when changing destinations.
- Refresh the app with warm white and muted green, separate companion conversations and clearer character settings.
- Publish updated Chinese/English introductions, a product hero and companion setup documentation.

### Features included since the last main-branch release

- Personal knowledge library with document extraction, PDF page references, source excerpts and account-scoped drafts.
- Built-in time, weather, calculation, unit/date/currency conversion, search and public-webpage tools.
- Chat pinning, archiving, history search, bookmarks, persistent drafts, independent conversation branches and backups.
- Custom assistant templates and separate assistant backups.
- Device speech playback controls, account session management and connection diagnostics.
- Native SQLite snapshot storage with guarded migrations, retained recovery archives and account/gateway isolation.
- Durable generation recovery, safer request cancellation and release metadata validation.

### Verification and scope

- 437 mobile, 287 gateway and 58 script checks pass (782 total).
- Workspace typechecks, lint, builds and release metadata validation pass.
- Android installation, real companion conversations and character photos verified in MuMu.
- Native iOS installation and broader physical-device coverage remain to be verified.
- This is a source update; available APKs are determined by actual GitHub Release assets.
- See [1.1.27 release notes](docs/RELEASE_1.1.27.md).

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

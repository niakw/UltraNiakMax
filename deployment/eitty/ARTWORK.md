# Artwork optimization policy — Eitty modern Ultra MAX overlay

The production overlay supports safe, content-addressed storage for Nuvio collection images. Source credentials and personal layouts stay out of this public repository.

## Formats

- **Static images:** WebP quality 82 by default; maximum edge 2560 pixels; preserves transparency, orientation and aspect ratio. Already-smaller WebP files are retained.
- **Animated images:** animation-aware WebP quality 78 when a verified encoder preserves every frame and the output is not larger. GIF compatibility fallback remains when animated WebP is unsafe, unavailable or heavier.
- **Other formats:** PWA install icons remain PNG for compatibility. Dynamic TMDB images and arbitrary third-party client artwork are not silently transcoded by this pipeline.

## Runtime

Content-hash image names are stored under the persistent Docker data volume and delivered on a dedicated path. Only hash-based artwork URLs are cacheable for one year; manifest, configuration and user JSON routes must stay no-store and noindex. There is no public arbitrary-URL image proxy.

## Privacy and rollback

Only public HTTPS images from a strict allowlist can be fetched for migration. Private user settings are loaded via authenticated API calls; source URLs and secret tokens are not written into the public repository. The private migration takes a root-only rollback copy, validates every staged image by HTTP, and compares the entire collection layout after save.

## Operational tests

Static alpha, resizing, file signatures, animation and unsafe URL handling are tested with synthetic fixtures. Live per-asset availability, Content-Type and immutable-cache headers are checked separately without exposing user configuration.

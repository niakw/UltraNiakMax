# Ultra MAX — niakw fork

Community fork of [Ultra MAX](https://github.com/PaRaN01a-hash/ultra-max-addon), a metadata, discovery and catalog addon for **Stremio** and **Nuvio**. This repository is separate from the official hosted service at [ultramax.vip](https://ultramax.vip/).

> **Not a hosted addon:** GitHub only stores the source. To install *this fork*, run its Node server behind HTTPS. The official ultramax.vip installer still points to the upstream addon, not this fork.

## Changes in this fork

- [Issue #29](https://github.com/PaRaN01a-hash/ultra-max-addon/issues/29): TMDB Season **0 / Specials** now appears in series metadata, including configured and unconfigured paths.
- Season/episode handling is shared by the two metadata handlers, preserves Stremio episode IDs (e.g. `tt123:0:1`), sorts episodes, tolerates failed seasons and uses at most four concurrent TMDB season requests per show.
- API requests have a bounded 5-minute LRU cache (1,000 entries), coalesce simultaneous duplicates and separate Trakt cache entries by client key.
- New configuration tokens have 128 bits of randomness; passwords use salted scrypt hashes. Existing SHA-256 hashes can still be verified and are upgraded when the configuration is saved.
- Configuration writes use an atomic file replacement, with a configurable storage path.
- Docker self-hosting no longer depends on the original developer's server paths or dev-only files.
- The fork has its own Stremio/Nuvio manifest IDs, so it does not replace the official installation.

The source comes from the upstream public repository, **not** necessarily the latest version of the upstream hosted service. Live-site-only features may be missing from this snapshot.

## Security-pinned dependency overlay

The modern Eitty Docker build now applies `deployment/eitty/security-dependency-overrides.cjs` to the pinned 8.1.4 upstream source, regenerates its lockfile, then runs `npm ci`. This keeps security fixes in the auditable overlay rather than altering the original repository. The paired `niakw/eitty-web` production audit reached zero npm production advisories on 6 November 2026. UI image optimization uses the separately mirrored `optimize-web-artwork.cjs` and excludes client install icons.

## Modern full-site overlay (Ultra MAX self-host 8.1.4)

The full modern UI and backend used by the Eitty integration are built reproducibly from the pinned upstream [UltraMax self-host source](https://github.com/PaRaN01a-hash/UltraMax) plus the public files in [deployment/eitty](deployment/eitty). This modern overlay is **distinct from the legacy Node server and Compose instructions below**; the repository-root Compose does not automatically deploy the 8.1.4 UI.

**Modern Eitty overlay updates:** secure password-gated device profile listing; 128-bit randomly generated tokens for new installs with legacy 8-character token compatibility; non-destructive catalog import with a merge-first UI; and privacy-preserving Nuvio artwork migration. The deployed overlay files in `deployment/eitty/` are intentionally mirrored from `niakw/eitty-web/projects-site/ultra-max/` and a CI parity check prevents drift. See [Artwork policy](deployment/eitty/ARTWORK.md). The root legacy server is unaffected.

The modern setup page includes **Importer un manifeste**: an end user can paste **their own** HTTPS `/manifest.json` URL, preview the exposed catalog names and IDs, then **merge recognized catalogs without clearing existing configuration** or explicitly replace only the catalog selection. The import endpoint safely fetches public HTTPS manifests with DNS/private-address checks, size and time limits, and rate limiting. The source URL and its access token are not committed, echoed back or saved with the new setup. **This is not a full configuration backup:** provider API keys, passwords and private collections are not recoverable from a manifest alone.

For public deployments, each user supplies their own source link in the UI. Never hard-code someone else's old manifest token in a distributed image, README, sample `.env`, or JavaScript bundle. A publicly accessible instance requires a valid HTTPS host, a configured TMDB key and a deployed backend—not just a GitHub fork.

## Self-host with Docker Compose

Prerequisites: Docker/Compose and your own [TMDB API key](https://www.themoviedb.org/settings/api). Add a domain and HTTPS reverse proxy for remote Stremio/Nuvio clients.

```bash
git clone https://github.com/niakw/UltraNiakMax.git
cd UltraNiakMax
cp .env.example .env
# Set TMDB_KEY in .env
docker compose up -d --build
```

The server listens on `127.0.0.1:7000` by default. Check `http://127.0.0.1:7000/health` and `http://127.0.0.1:7000/configure`. To change its local port, set `HOST_PORT` in `.env`. Proxy the local port through HTTPS before installing from a remote device.

Configurations are stored in the persistent Docker volume `ultramax-data` (`/app/data/configs.json`). Images, if added to the deployment, use `ultramax-images`. Don't remove these volumes when redeploying.

For direct Node execution (Node.js 24 recommended): `npm ci`, configure `.env`, then `npm start`. The default file storage path in this mode is `./configs.json`, or set `CONFIGS_FILE` to another writable path.

## Install the fork in Stremio or Nuvio

1. Deploy the fork to a publicly reachable **HTTPS** origin, for example `https://ultramax.example.com`.
2. Visit `https://ultramax.example.com/configure`, choose catalogs and create a configuration. The editor provides the token and manifest URL.
3. Install the appropriate URL in your client:

| Client | Manifest URL |
| --- | --- |
| Stremio | `https://ultramax.example.com/c/YOUR_TOKEN/manifest.json` |
| Nuvio | `https://ultramax.example.com/n/YOUR_TOKEN/manifest.json` |

Replace the example domain and token with the **actual deployed origin and generated token**. Neither URL works just by forking the repository. A Stremio deep link can be formed as `stremio://ultramax.example.com/c/YOUR_TOKEN/manifest.json` after deployment.

**Important:** the old official hosted URL is not linked to this fork, and creating a GitHub fork does not configure DNS or start a server.

## Testing

```bash
npm ci
npm test
```

The Node test suite covers Season 0/special episodes, episode ordering, IDs and partial TMDB failures. The `/health` endpoint checks that the server is reachable; actual Stremio/Nuvio playback and artwork behavior must still be validated on client devices.

## Search indexing and privacy

The legacy Node server sends `X-Robots-Tag: noindex, nofollow, noarchive, nosnippet, noimageindex` on **all responses**, including manifests, media and error responses. Its configuration HTML includes a matching robots meta tag. The `/robots.txt` endpoint allows crawlers to read these directives; blocking crawlers with `Disallow` could leave URL-only search results. The modern Eitty integration independently enforces the same exclusion at Nginx and during its HTML build. Neither mechanism authenticates visitors: installation tokens and credentials must still be handled privately. This **public GitHub repository itself can be indexed**.

## Security and compatibility notes

- Treat each configuration URL/token as a **secret**: older configs may include provider API keys, and the configuration API currently returns saved settings to callers with that token. Prefer new tokens (16 random bytes), HTTPS and private sharing.
- Existing **8-character** tokens created before this fork remain usable but are weaker. Re-create those configurations if they were shared.
- Use a trusted reverse proxy for TLS. Set `TRUST_PROXY_HOPS=1` only when there is exactly one proxy in front of Node; otherwise leave it at `0`.
- TMDB is required; MDBList, Trakt and AI services are optional and require their own keys. No third-party keys are bundled.
- Some image assets and product links in the historical configuration UI still reference the upstream site's public assets. This source snapshot does not include the entire production asset library.

## Upstream

Original project: [PaRaN01a-hash/ultra-max-addon](https://github.com/PaRaN01a-hash/ultra-max-addon). Official documentation: [ultramax.vip/about.html](https://ultramax.vip/about.html). This fork is independently maintained and does not change the official hosted addon.

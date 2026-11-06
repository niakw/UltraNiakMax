# UltraNiakMax security review — 2026-11-06

## Scope and evidence

This review covers the legacy Node server at the repository root and the shared
modern Eitty overlay in `deployment/eitty/`. The modern Eitty deployment uses a
separate pinned 8.1.4 upstream source; do not confuse a green legacy test with a
production rollout.

Evidence is obtained from the `Fork regression and privacy checks`, `Security
inventory and dependency gate`, and Eitty integration workflows. The inventory
reads the open CodeQL alert list, reports each rule and path, and audits all
installed npm dependencies. A passing CodeQL analysis run does **not** by itself
mean the alert count is zero.

## Remediation completed

- Unused historical Stremio SDK dependency graph removed; lockfile regenerated.
  Latest complete npm audit observed **0** low, moderate, high or critical findings.
- External manifest / stream fetching uses public HTTPS only, rejects literal
  addresses and reserved DNS ranges, pins the resolved vetted IPv4 address into
  the TLS connection, disables proxies and redirects, and caps time and bytes.
  Dedicated tests reject metadata and private addresses before the network call
  and verify DNS pinning and redirect refusal.
- TMDB remote calls restrict destination, path, input length and request time.
- Profile configuration retrieval separates public, redacted settings from
  password-authenticated full settings. Collection writes and private diagnostics
  require a password. Secret values are not placed into the query string.
- Token lookups reject reserved names and require own properties, nested input
  rejects prototype-polluting keys, and persisted top-level configurations have
  a null prototype.
- Catalog URL and query parsing is bounded; vulnerable complex regular
  expressions removed. User-supplied UI strings are HTML escaped or rendered via
  text nodes.
- Explicit Express rate limits apply to administration, remote probes, AI,
  and static-file routes. Artwork directory reads run at startup and in scheduled
  refreshes, not for each HTTP request.
- All newly issued password hashes use random salted scrypt. Legacy hashes are
  upgraded to scrypt on successful authenticated profile actions.
- Web application and manifest routes have noindex protection. This does not
  authorize a claim that the public GitHub repository is excluded from search.

## Reviewed compatibility and scanner limitations

**Historical password hashes:** legacy accounts used a fixed-salt SHA-256 hash.
Keeping a verification-only compatibility path allows those profiles to be
unlocked and upgraded without losing access. This legacy verification is
weaker against offline guessing if the restricted configuration storage is
stolen. Unlike newly created or successfully migrated accounts, an unused old
account cannot be rehashed without its plaintext password. Remove the
compatibility path only when legacy profiles have been migrated or an
administrator-approved password reset mechanism is available.

**Public addon SSRF scanner:** fetching arbitrary user-configured public HTTPS
manifests is necessary for the import feature. The static analyzer may still
flag the user-selected URL even though the runtime validates the destination,
rejects private DNS answers, pins the IP and refuses redirects. Do not bypass
the validation or dismiss the alert without rechecking the source and the
negative DNS-pinning tests.

**GitHub alert permissions:** the workflow token can enumerate CodeQL alerts,
but attempts to enumerate Dependabot and secret-scanning alerts returned HTTP
403. Thus a green `npm audit` does not prove every GitHub Dependabot or secret
scanning alert is closed. Those categories need separate authorized access.

## Operational release gate

1. Validate `npm ci`, `npm test`, `npm audit`, JavaScript syntax, CodeQL
   and Eitty overlay parity after every change.
2. Check the *open* CodeQL alerts after analysis completes; inventory output
   may temporarily reflect a previous commit during GitHub indexing.
3. Never copy personal manifests, tokens or profiles into source code or CI logs.
4. Do not deploy the legacy root package over the pinned modern Eitty runtime,
   or replace its persistent Docker volumes.
5. A zero scanner count must never be manufactured by indiscriminate alert
   dismissals. Document residual trade-offs and close reviewed findings only
   with a defensible reason.

## Latest verification references

- Legacy fork regression and privacy tests (including malicious JSON,
  guarded stream fetch, and scrypt migration): workflow run
  [42287084788](https://github.com/niakw/UltraNiakMax/actions/runs/42287084788).
- Full npm dependency audit and CodeQL inventory: workflow run
  [42287084698](https://github.com/niakw/UltraNiakMax/actions/runs/42287084698).
- Production Eitty integration, including the mirrored hardened public fetcher
  and fail-closed analytics script filter: workflow run
  [42285477759](https://github.com/niakw/eitty-web/actions/runs/42285477759).
- The CodeQL scan of the most recent prototype-correction commit completed
  after that inventory; a subsequent inventory is required for an up-to-date
  count of remaining open alerts.

## Verified open-alert disposition — 2026-11-06 20:19 UTC

After completion of the latest CodeQL analysis, the [independent inventory run
42287337902](https://github.com/niakw/UltraNiakMax/actions/runs/42287337902)
reported **2 open CodeQL alerts**, reduced from the initial 40, and
**0 npm audit vulnerabilities** (all severities). The two remaining alerts
are **not dismissed**:

1. **#41 — critical, `js/request-forgery`, `deployment/eitty/public-fetch.cjs`.**
   The HTTP destination is supplied by an end-user manifest URL, which is an
   intentional feature. Runtime controls enforce public HTTPS, reject IP
   literals and non-public DNS records, pin the audited IPv4 into the HTTPS
   agent, disable proxy use and redirects, and limit response size/time.
   Synthetic tests demonstrate both private-DNS rejection and public-IP
   pinning. CodeQL does not currently recognize those safeguards, so a
   separate reviewed false-positive disposition may be appropriate; it has
   **not** been silently suppressed.

2. **#9 — high, `js/insufficient-password-hash`, `utils/auth.js`.**
   Verification of old fixed-salt SHA-256 hashes remains for users who have
   not yet signed in since migration. All new passwords use salted scrypt.
   Successful authorized profile operations upgrade the stored legacy hash,
   and tests verify that migration. Removing the fallback immediately would
   lock existing users out of their configurations; a staged retirement
   requires confirming their migration or providing an approved reset path.

Dependabot and secret-scanning alert details remain outside the permissions
of this CI inventory (HTTP 403), and this document therefore does **not**
claim those categories have zero open alerts. The audited npm dependency tree
itself has zero reported vulnerabilities.

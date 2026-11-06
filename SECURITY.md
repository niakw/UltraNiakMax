# Security policy — UltraNiakMax

## Supported software

The root Node/Express server is the independently maintained **legacy 7.x**
fork. The Eitty-hosted app is a **separate, pinned modern UltraMax 8.1.4**
build with a synchronized overlay in `deployment/eitty/` and
`niakw/eitty-web/projects-site/ultra-max/`. The root server's updates do not
automatically deploy to Eitty.

## Reporting vulnerabilities

Please use GitHub's private vulnerability reporting feature when available,
or contact the repository owner privately. Never include install tokens,
provider credentials, password hashes, user manifests, or account data in a
public GitHub issue or pull request.

## Legacy passwords and CodeQL review

New profile passwords use salted scrypt. Profiles imported with historical
64-hex-digit SHA-256 verifiers are **atomically migrated on first load** to
`legacy-scrypt:<random-salt>:<scrypt-digest>`; the original fast digest is
removed from the stored JSON, and every other profile field and install token
remains unchanged. A successful authenticated request then upgrades that
profile to direct `scrypt:<random-salt>:<scrypt-digest>` derived from the
actual password. Raw historical SHA-256 hashes are **never accepted directly**
by `verifyPassword`.

To preserve existing account passwords during the transition, a *transient*
SHA-256 digest is computed solely as an input to scrypt for
`legacy-scrypt` authentication. The digest is not stored or used as the
final password verifier. CodeQL's `js/insufficient-password-hash` rule may
report this intermediate conversion even though the stored credential is
scrypt-hardened; an inline rule-specific review annotation documents this
limited compatibility exception. Do not suppress the rule elsewhere.

## Remote HTTP boundaries

Server-side manifest fetches accept public HTTPS domains only, require a
public IPv4 DNS result, pin the socket to that validated address and use
certificate-verified HTTPS with the original hostname as the TLS identity.
No proxies or redirects are followed. Requests are time- and byte-limited,
and compressed responses are rejected rather than transparently inflating
untrusted data. Unit tests exercise DNS rebinding, redirect refusal, TLS/SNI
target selection and response-size limits.

A passing CI run is not proof of a successful production deployment. The Eitty
Coolify application is released explicitly and verified separately, including
other hosted services and search-engine exclusion.

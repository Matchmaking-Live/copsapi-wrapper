# Changelog

## 1.0.0

First release, covering the Critical Ops Public API v2.0.0:

- Profiles, server status, match history, match scoreboards, weapon stats and leaderboards.
- Autohost: create, poll, control, `host()` in one call, and `AutohostWatcher` with live events.
- Quota tracking from the rate-limit headers, a reserve for Autohost traffic, and waiting instead of `429`s.
- Retries for network errors, timeouts and gateway pages that are safe for `POST` requests.
- Automatic batching, isolation of unknown players, caching with pluggable stores, and collapsing of duplicate requests.
- Catalog of hostable game modes and maps, label tables and stat helpers.
- Every user supplies their own token; it is checked up front. `verifyToken()` and `autohost.isAvailable()` report what a token can do. Hosting calls with a token that lacks `Autohost` fail with a clear `insufficient_permissions` error, without spending more quota.
- `copsapi` command line tool.

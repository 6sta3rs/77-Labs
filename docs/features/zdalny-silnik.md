# Connecting to your own server

**Ustawienia → Sieć i dostęp → Zdalny silnik** (Settings → Network and access →
Remote engine; also opened from the **Zdalny silnik** pill in the top bar) can connect the studio to
the engine API on your own compatible server. Text, references and media used by a
remote operation are sent to that server. GPU availability, models and applicable
terms depend on the server. The transport test does not perform synthesis.

## Connecting and returning to local mode

The test reads `/health`, exchanges the key for a session through
`/api/auth/session` and checks the protected `/system/info` endpoint. It does
not change the active mode. Only **Połącz i używaj zdalnego silnika** (Connect
and use the remote engine) switches operations to the server. A failed remote
request is not automatically retried on the local computer.

**Użyj lokalnego silnika** (Use the local engine) restores local transport and
clears the stored session. Revoking that session on the server may fail if the
server is unavailable. After restarting the process, enable the connection
explicitly. Reloading only the window synchronizes its state with the running
bridge.

The administrator key is used to obtain a session and is not stored in browser
memory. The expiring session uses the backend's secret store. Changing servers,
session expiration or revoked access may require signing in again.
Use HTTPS for connections that leave the trusted loopback interface.

## Transport limitations

The proxy supports uploads, downloads, SSE and a separate WebSocket ticket.
It does not forward local Cookie, Origin or Authorization values as arbitrary
headers. Redirects are rejected, the reverse proxy path prefix is preserved,
and private `/next/*` routes are not exposed as a remote API. Switching servers
is blocked while transfers are still in progress. When a session expires,
requests remain blocked without silently switching to another backend.

The connection does not import server profiles or files into the local database.
It is not a data migration mechanism or a restoration of historical GPU workers.

## Files and checks

- `src/lib/settings/pages/NetworkPage.svelte` — settings and explicit actions.
- `src/lib/platform/remote-backend.ts`, `src/lib/platform/remote-state.ts`, `src/lib/platform/remote-routing.ts` — state.
- `scripts/runtime/remote_backend.py` — session and proxy.
- `src/lib/platform/api.ts`, `src/lib/tools/dictation/dictation.ts` — transport selection for operations.

Regression checks: `scripts/runtime/test_remote_backend.py`, run in an isolated
environment. A controlled loopback server does not validate a public deployment,
reverse proxy authentication or inference. See [data protection](../../SECURITY.md)
and [verification status](../verification/weryfikacja.md).

[CLOSED] ngpt https reset

- Session ID: ngpt-https-reset
- Date: 2026-06-09
- Symptom:
  - Browser console shows intermittent `net::ERR_CONNECTION_RESET` for `https://ngpt.chat/api/db/chat-updated-at`, `/api/db/sync-meta`, `/api/db/models/latest`.
  - Same site can sometimes load, IP access works, domain access is unstable from the user's environment.
- Scope:
  - Runtime debugging only; no business logic changes before evidence is collected.
- Hypotheses:
  1. The user's local proxy/VPN intermittently intercepts or resets TLS connections for `ngpt.chat`, while direct IP access bypasses that path.
  2. BaoTa/nginx serves the main page successfully, but some follow-up API requests over HTTPS are being reset before reaching nginx due to local or upstream network policy.
  3. Site/database changes made for BaoTa SSL reminder introduced a mismatch in host/site routing, so some requests are routed differently than the main page.
  4. A server-side rate-limit, firewall, or reverse-proxy timeout resets specific API requests, and the browser only surfaces that as `ERR_CONNECTION_RESET`.
  5. Browser cache, HSTS, or mixed proxy rules cause only domain-based API calls to fail while direct IP access and some page assets still succeed.
- Evidence to collect:
  - Current frontend code paths issuing these API calls.
  - Server access/error logs around the failing timestamps.
  - Local reproduction via direct curl with and without proxy.
  - Current BaoTa/nginx vhost and certificate configuration for `ngpt.chat`.

- Findings:
  - Frontend calls to `/api/db/chat-updated-at`, `/api/db/sync-meta`, `/api/db/models/latest` are expected sync traffic, not standalone business logic bugs.
  - During the unstable period, BaoTa nginx on the server still listened on `80/443`, but upstream `127.0.0.1:3000` returned `connection refused`; the production `nextchat` container was not running.
  - After redeploying with `./scripts/deploy-production-no-proxy.sh`, container `nextchat` returned to `healthy`, container-local `127.0.0.1:3000` returned `200`, and server-local `curl -k -I -H "Host: ngpt.chat" https://127.0.0.1/` returned `HTTP/2 200`.
  - External-network TLS still showed a separate symptom: `openssl s_client -connect 42.193.15.117:443 -servername ngpt.chat -brief` could be reset while non-SNI IP TLS succeeded, which indicates an external path / SNI-layer reset rather than an app-internal crash.

- Resolution:
  - Server-side app outage has been fixed by redeploying the production container.
  - Remaining domain-only instability, if any, should be investigated as external network / operator / 443-SNI path rather than NextChat application logic.

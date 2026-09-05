# Account authentication

## Authority
- canonical store → `~/.gaia/accounts.json` · mode `0600`
- migration backup → `~/.gaia/accounts.json.bak-20260905` · never overwritten
- runtime caches → `~/.gaia/pi-accounts/account-<sha256(account-id)[0:16]>/auth.json`
- cache direction → canonical seed → provider refresh → canonical write-back
- ambient stores → migration recovery candidates only; matching provider account id required

## OAuth credential schema

OpenAI Codex:
```json
{"type":"oauth","access":"…","refresh":"…","expires":"<epoch-ms>","accountId":"…"}
```

Anthropic:
```json
{"type":"oauth","access":"…","refresh":"…","expires":"<epoch-ms>"}
```

Optional OpenAI field → `idToken` · Codex CLI compatibility only.
Forbidden legacy aliases after migration → `accessToken`, `refreshToken`, `oauthToken`.

## Health metadata
- `authStatus` → `ok | needs-reauth | error | unknown`
- `authCheckedAt` → ISO timestamp
- `authFailure` → redacted reason; absent on success
- API surface → metadata only; credential bag never crosses HTTP

## Shared paths
- boot → normalize + refresh + provider check + write-back
- runner spawn → same reconcile descriptor; `needs-reauth` fails loudly
- runner turn-end/error → runtime cache read-back
- `gaia auth status|refresh` → same account-auth service
- Accounts UI → status + per-account **Reauthorize** → existing account id replaced in place

## Provider checks
- Anthropic → `GET /api/oauth/usage`
- OpenAI Codex → `GET /backend-api/wham/usage`
- `401/403` → forced provider-owned OAuth refresh → one retry
- rejected refresh → `needs-reauth`
- network/provider fault → `error`; never mislabeled as reauth

# instatic-railway

A Railway-tuned wrapper image around [Instatic](https://github.com/CoreBunch/Instatic),
the self-hosted CMS with an integrated visual editor. It is the upstream image
with four Railway-specific fixes baked in, published as
`ghcr.io/bon5co/instatic-railway:latest`.

Upstream is well built — this wrapper changes no product behaviour. What it
changes is what happens when Instatic is put behind a public URL, on a platform
that redeploys containers and terminates TLS at a shared edge.

## 1. The instance is claimed before it is reachable

`POST /admin/api/cms/setup` is dispatched ahead of every auth handler and is
guarded only by "has anyone run setup yet?" (`server/handlers/cms/setup.ts`).
Until the deployer finishes the in-app wizard, any stranger with the link can
create the `owner` account — verified against the stock image as an anonymous,
cookie-less, `Origin`-less POST returning `201`, an immediate `200` login as the
attacker, and a permanent `409 Setup already complete` for the real deployer.
There is no environment variable anywhere in the source that closes that window.

`railway-seed.ts` runs to completion in a separate process before the server
binds, creating the owner from `INSTATIC_ADMIN_PASSWORD` and a starter homepage.
Seeding after the listener exists would leave the same gap, which is why it is
not done that way. The container refuses to boot on an empty password, and a
redeploy never touches an existing owner.

## 2. Per-IP rate limits that actually key on the client

Instatic reads `X-Forwarded-For` only when the socket peer is inside
`TRUSTED_PROXY_CIDRS`, which is unset by default. On Railway every request then
looks like it came from the edge, so the per-IP login limiter and the public
form limiters become one bucket shared by the entire internet: 70 requests from
70 distinct clients measured 60 × pass, 10 × `429`. This image sets the CIDRs,
and additionally keys on the *leftmost* forwarded address rather than upstream's
nearest-untrusted walk, because Railway's own edge hop rotates between addresses
from request to request. The same 70 requests measure 70 × pass here. Railway
replaces any inbound `X-Forwarded-For`, so the leftmost entry cannot be spoofed.

## 3. Published pages keep their JavaScript across a redeploy

The runtime dependency cache defaults to a directory under `/tmp` and is only
ever populated at publish time — nothing rebuilds it on a visitor request. After
a redeploy, a published page importing a site npm dependency serves `404` for
its modules until the owner republishes (reproduced: `200`, wipe, `404`).
`RUNTIME_CACHE_DIR` is baked onto the volume; the same asset measures `200`
before and after a container recreate here.

## 4. Pinned, and unprivileged

Upstream retags `latest` on every release — fourteen in the first fifty-one days
— while migrations run forward on boot and rebuild tables. This image pins
`0.0.14`, so a redeploy is a redeploy. It also repairs the root-owned Railway
volume as root and then `setpriv`s down to the image's own `bun` user (uid 1000)
before anything else runs, instead of running the whole CMS as root via
`RAILWAY_RUN_UID=0`.

## Configuration

Everything the image can know is baked in (`STATIC_DIR`, `UPLOADS_DIR`,
`DATABASE_URL`, `RUNTIME_CACHE_DIR`, `TRUSTED_PROXY_CIDRS`,
`INSTATIC_ADMIN_EMAIL`). `PORT` is deliberately not baked: Railway injects it and
its healthcheck dials the injected port. Three variables belong to the deployer:

| Variable | Purpose |
| --- | --- |
| `INSTATIC_ADMIN_PASSWORD` | Password for the seeded owner account (min 12 chars). |
| `INSTATIC_SECRET_KEY` | Base64 32-byte master key encrypting AI provider keys and TOTP seeds. |
| `PUBLIC_ORIGIN` | The site's public origin, used for the CSRF origin check. |

Mount a volume at `/app/storage`.

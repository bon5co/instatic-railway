## Railway-tuned Instatic.
#
# Pinned to a release tag rather than `latest`: upstream retags `latest` on
# every release (14 in the first 51 days), `server/index.ts` runs migrations
# forward on boot, and those migrations rebuild tables (`drop table data_rows`
# in migrations-sqlite.ts). An unpinned redeploy is therefore an unrequested,
# one-way upgrade of a 0.0.x app.
FROM ghcr.io/corebunch/instatic:0.0.14

USER root

COPY railway-seed.ts /app/railway-seed.ts
COPY patch-client-ip.mjs /tmp/patch-client-ip.mjs
COPY railway-entrypoint.sh /usr/local/bin/railway-entrypoint.sh
RUN chmod +x /usr/local/bin/railway-entrypoint.sh \
 && bun /tmp/patch-client-ip.mjs \
 && rm /tmp/patch-client-ip.mjs \
 && chown bun:bun /app/railway-seed.ts /app/server/auth/security.ts

# Baked, NOT published as template variables: templateGenerate drops a variable
# whose default is a literal and republishes it as a blank REQUIRED field on the
# deploy form. Only values that genuinely belong to the deployer stay variables,
# and those are Railway expressions (${{secret(n)}}, ${{RAILWAY_PUBLIC_DOMAIN}}).
#
# STATIC_DIR is the admin SPA bundle inside the image and must stay there.
# UPLOADS_DIR carries the media library AND the published static artefacts
# (<uploadsDir>/published/{a,b} with a `current` symlink), so it belongs on the
# volume. RUNTIME_CACHE_DIR defaults to a directory under /tmp: the runtime
# dependency cache is only ever written at publish time and is never rebuilt on
# a visitor request, so on the stock config every published page that imports a
# site npm dependency serves 404 for its modules after a redeploy.
#
# TRUSTED_PROXY_CIDRS gates whether X-Forwarded-For is read at all. Unset — the
# vendor's config — every visitor is attributed to Railway's edge, so the
# per-IP login and public-form limiters are one bucket shared by the entire
# internet. Railway's edge reaches the container from 100.64.0.0/10; the
# private ranges cover local runs and any future internal hop. Entries are
# parsed at boot and an invalid one throws, so keep them well-formed.
#
# PORT is deliberately absent. The image bakes ENV PORT=3001, but Railway
# injects its own PORT into every service and its HTTP healthcheck dials the
# INJECTED port, not the domain's target port — pinning the listener back to
# 3001 fails the healthcheck even while the public URL serves 200.
ENV STATIC_DIR=/app/dist \
    UPLOADS_DIR=/app/storage/uploads \
    DATABASE_URL=sqlite:/app/storage/data/cms.db \
    RUNTIME_CACHE_DIR=/app/storage/runtime-cache \
    TRUSTED_PROXY_CIDRS=100.64.0.0/10,10.0.0.0/8,172.16.0.0/12,192.168.0.0/16 \
    INSTATIC_ADMIN_EMAIL=admin@example.com

# The entrypoint repairs the root-owned mount as root and then setpriv's down
# to the image's own `bun` user (uid 1000) before anything else runs, so the
# CMS itself never executes as root and RAILWAY_RUN_UID is not needed.
ENTRYPOINT ["/usr/local/bin/railway-entrypoint.sh"]
CMD ["bun", "run", "server/index.ts"]

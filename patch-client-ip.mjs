/**
 * Build-time patch: key the per-IP rate limiters on the FIRST address in
 * X-Forwarded-For rather than the nearest untrusted one.
 *
 * Railway's edge writes `X-Forwarded-For: <client>, <edge>` and the edge hop
 * ROTATES per request (measured across five consecutive requests from one
 * client: .164, .161, .164, .161, .162). Upstream walks the chain right-to-left
 * and returns the nearest address that is not a configured trusted proxy — on
 * Railway that is the rotating edge hop, so every per-IP bucket is either
 * shared by the whole internet or reshuffled every few requests, and the
 * limiter never fires. Railway REPLACES any inbound X-Forwarded-For, so the
 * leftmost entry is the real client and cannot be spoofed.
 *
 * Applied with an exact-match assertion: if upstream ever rewrites this block
 * the build fails loudly instead of silently shipping the stock behaviour.
 */
import { readFileSync, writeFileSync } from 'node:fs'

const FILE = '/app/server/auth/security.ts'
const BEFORE = `    for (let i = chain.length - 1; i >= 0; i--) {
      const candidate = chain[i]
      if (!candidate || !parseIpAddress(candidate)) continue
      if (!isTrustedProxyPeer(candidate)) return normalizeIpLiteral(candidate)
    }`
const AFTER = `    for (let i = 0; i < chain.length; i++) {
      const candidate = chain[i]
      if (!candidate || !parseIpAddress(candidate)) continue
      return normalizeIpLiteral(candidate)
    }`

const src = readFileSync(FILE, 'utf8')
if (!src.includes(BEFORE)) {
  console.error('[patch-client-ip] anchor not found in ' + FILE + ' — upstream changed, refusing to build')
  process.exit(1)
}
writeFileSync(FILE, src.replace(BEFORE, AFTER))
console.log('[patch-client-ip] clientIp now keys on the leftmost X-Forwarded-For entry')

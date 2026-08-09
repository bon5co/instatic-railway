// Runs once per boot, before `bun run server/index.ts` binds the port.
//
// Instatic's first-run wizard (`POST /admin/api/cms/setup`) is dispatched ahead
// of every auth handler and is guarded only by "has anyone claimed this yet?".
// On a public Railway URL that means the window between the domain going live
// and the deployer finishing the wizard is open to the entire internet: an
// anonymous POST creates the `owner` account, and the deployer then gets a 409
// forever. Seeding after the server starts is not sufficient — the listener
// would answer during the gap (the AzuraCast lesson) — so the seed runs to
// completion in this separate process first.
//
// Importing the app's own db client runs the same migrations `server/index.ts`
// runs, so this works against an empty volume on first boot and against an
// existing database on every later redeploy.
import { createDbClient } from './server/db'
import { runMigrations } from './server/db/runMigrations'
import { syncSystemRoles } from './server/repositories/roles'
import { getSetupStatus, createSite } from './server/repositories/setup'
import { createUser } from './server/repositories/users'
import { hashPassword } from './server/auth/tokens'
import { createDataRow } from './server/repositories/data'
import { createNode } from '@core/page-tree'
import { pageToCells } from './src/core/data/pageFromRow'
import type { Page } from '@core/page-tree'
import { nanoid } from 'nanoid'

const password = (process.env.INSTATIC_ADMIN_PASSWORD ?? '').trim()
const email = (process.env.INSTATIC_ADMIN_EMAIL || 'admin@example.com').trim().toLowerCase()
const siteName = (process.env.INSTATIC_SITE_NAME || 'My Site').trim()

if (!password) {
  console.error(
    '[railway] INSTATIC_ADMIN_PASSWORD is empty. Refusing to boot: an unclaimed Instatic ' +
      'on a public URL can be taken over by any stranger with the link, who then becomes ' +
      'its owner and locks the deployer out. Set the variable and redeploy.',
  )
  process.exit(1)
}
if (password.length < 12) {
  console.error('[railway] INSTATIC_ADMIN_PASSWORD must be at least 12 characters. Refusing to boot.')
  process.exit(1)
}

const databaseUrl = process.env.DATABASE_URL ?? 'sqlite:/app/storage/data/cms.db'
const { db, migrations } = createDbClient(databaseUrl)
await runMigrations(db, migrations)
await syncSystemRoles(db)

const status = await getSetupStatus(db)
if (!status.needsSetup) {
  // The deployer owns this install already. Never touch their account or
  // their site row — a redeploy must not reset either.
  console.log('[railway] setup already complete; leaving the existing owner alone')
  process.exit(0)
}

await db.transaction(async (tx) => {
  await createSite(tx, siteName, {})
  const owner = await createUser(tx, {
    id: nanoid(),
    email,
    displayName: 'Owner',
    passwordHash: await hashPassword(password),
    roleId: 'owner',
    allowOwnerRole: true,
  })
  // Mirror the wizard's starter homepage so the admin lands on a usable site
  // rather than an empty page list.
  const rootNode = createNode('base.body')
  const homePage: Page = {
    id: nanoid(),
    title: 'Home',
    slug: 'index',
    nodes: { [rootNode.id]: rootNode },
    rootNodeId: rootNode.id,
  }
  await createDataRow(
    tx,
    { id: homePage.id, tableId: 'pages', cells: pageToCells(homePage), slug: homePage.slug },
    owner.id,
    null,
    { collabInternal: true },
  )
})

console.log(`[railway] seeded owner '${email}' and site '${siteName}'`)
process.exit(0)

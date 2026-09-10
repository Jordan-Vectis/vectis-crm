// Custom Next.js server with Socket.IO for live auction support
const { createServer } = require('http')
const { parse }        = require('url')
const next             = require('next')
const { Server }       = require('socket.io')
const { Pool }         = require('pg')
const { setupAuctionSocket } = require('./lib/auction-socket')
const { setupTrainerSocket } = require('./lib/trainer-socket')
require('dotenv').config()

const dev  = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT || '3000', 10)
const app  = next({ dev })
const handle = app.getRequestHandler()

// Run pending Prisma migrations on startup.
// Some migrations were previously applied via `prisma db push` so the column
// already exists but the migration isn't recorded — we resolve those first so
// migrate deploy doesn't choke on them.
async function runMigrations() {
  const { execSync } = require('child_process')

  // Migrations to mark as applied without running (column already exists from db push)
  const preResolve = [
    '20260506090000_warehouse_tote_catalogued',
  ]

  for (const name of preResolve) {
    try {
      execSync(`npx prisma migrate resolve --applied "${name}"`, { timeout: 15000, stdio: 'pipe' })
      console.log(`> Resolved migration: ${name}`)
    } catch {
      // Already resolved or not in failed state — safe to ignore
    }
  }

  try {
    execSync('npx prisma migrate deploy', { timeout: 30000, stdio: 'inherit' })
    console.log('> Migrations applied')
  } catch (e) {
    console.warn('> prisma migrate deploy failed or timed out — server will start anyway:', e.message)
  }
}

// On startup, reset any stale ACTIVE/PAUSED live auctions to PENDING.
// The in-memory state is always lost on restart, so the public site
// must not show a live banner until a clerk explicitly presses Start.
async function resetStaleLiveAuctions() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
  // Same guard as lib/auction-socket.js: a connection dying while idle emits
  // 'error' on the pool, and unheard it would crash the boot.
  pool.on('error', (err) => {
    console.warn(`> Stale-live-auction reset pool: idle connection lost (${err.code || 'no code'}): ${err.message}`)
  })
  try {
    const { rowCount } = await pool.query(
      `UPDATE "LiveAuction" SET status = 'PENDING', "updatedAt" = NOW()
       WHERE status IN ('ACTIVE', 'PAUSED')`
    )
    if (rowCount > 0) console.log(`> Reset ${rowCount} stale live auction(s) to PENDING`)
  } catch (e) {
    console.warn('> Could not reset stale live auctions:', e.message)
  } finally {
    await pool.end()
  }
}

app.prepare().then(async () => {
  // Both of these write to whatever DATABASE_URL points at, and .env on a dev
  // machine points at the SHARED Neon database — not a local copy. So they are
  // gated to a real deployment: a local boot would otherwise push migrations
  // outside the deliberate Run Migrations button, and reset a genuinely live
  // auction to PENDING, dropping the live banner off the public site mid-sale.
  // Railway is NODE_ENV=production, so nothing changes there.
  if (dev) {
    console.log('> Dev mode — skipping migrations + stale-live-auction reset (they target the shared DB)')
  } else {
    await runMigrations()
    await resetStaleLiveAuctions()
  }

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  })

  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  })

  setupAuctionSocket(io)
  // Saleroom Trainer test mode — in-memory practice rooms only, never a real sale.
  setupTrainerSocket(io)

  // Make io accessible to API routes via globalThis
  globalThis._io = io

  httpServer.listen(port, () => {
    console.log(`> Vectis Hub ready on http://localhost:${port}`)
    console.log(`> Socket.IO live auction server active`)

    // When this process started — the Status Centre's "The Hub" light shows it, so a
    // restart (a crash, or a deploy) is visible after the fact.
    globalThis._bootedAt = Date.now()

    // The loops below drive real integrations: they back up the shared DB to R2
    // and turn real IT@vectis.co.uk / condition-report emails into records. On a
    // dev machine they no-op only because CRON_SECRET happens to be absent from
    // .env — that accident is not worth relying on, since copying the Railway
    // variables across to run locally would have the mailbox polls processing
    // live mail 90 seconds later. Railway is NODE_ENV=production and schedules
    // them exactly as before.
    if (dev) {
      console.log('> Dev mode — background cron loops not scheduled')
      return
    }

    // Background warehouse sync — runs every 12 hours.
    // First run is delayed 2 minutes to let Next.js finish initialising.
    const SYNC_INTERVAL_MS = 12 * 60 * 60 * 1000
    const SYNC_INITIAL_DELAY_MS = 2 * 60 * 1000
    function runWarehouseSync() {
      const secret = process.env.CRON_SECRET
      if (!secret) { console.warn('[cron] CRON_SECRET not set — skipping warehouse sync') ; return }
      console.log('[cron/bc-warehouse] starting background sync')
      fetch(`http://localhost:${port}/api/cron/bc-warehouse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      })
        .then(r => r.json())
        .then(d => console.log('[cron/bc-warehouse] complete', JSON.stringify(d.results ?? {})))
        .catch(e => console.warn('[cron/bc-warehouse] error:', e.message))
    }
    setTimeout(() => {
      runWarehouseSync()
      setInterval(runWarehouseSync, SYNC_INTERVAL_MS)
    }, SYNC_INITIAL_DELAY_MS)

    // Full warehouse re-sync — 05:00 UK, an hour after the overnight BC macro finishes.
    //
    // ⚠⚠ WHY THIS EXISTS SEPARATELY FROM THE 12-HOURLY RUN. That one is INCREMENTAL: it only asks
    // Business Central for rows BC says have changed, and BC does not always say. A lot given its
    // number in BC does not get its SystemModifiedAt bumped, which is how 94 lots sat with no lot
    // number until a top-up was bolted on. Only a full walk closes that class of gap.
    //
    // ⚠ Scheduled in EUROPE/LONDON and re-armed after every run, not on a fixed 24-hour interval.
    // A fixed interval drifts an hour each way at the clock changes, and the 12-hourly job's
    // "every N ms from boot" means its timing follows whenever Railway last deployed.
    function msUntilLondonHour(hour) {
      const now = new Date()
      // What time is it in London right now, as plain numbers.
      const parts = new Intl.DateTimeFormat('en-GB', {
        timeZone: 'Europe/London', hour12: false,
        hour: '2-digit', minute: '2-digit', second: '2-digit',
      }).formatToParts(now).reduce((a, p) => (a[p.type] = p.value, a), {})
      const h = Number(parts.hour) % 24, m = Number(parts.minute), sec = Number(parts.second)
      const secsNow    = h * 3600 + m * 60 + sec
      const secsTarget = hour * 3600
      const delta = secsTarget - secsNow
      return (delta > 0 ? delta : delta + 24 * 3600) * 1000
    }
    function runFullWarehouseSync() {
      const secret = process.env.CRON_SECRET
      if (!secret) { console.warn('[cron] CRON_SECRET not set — skipping full warehouse sync') ; return }
      console.log('[cron/bc-warehouse] starting FULL sync')
      fetch(`http://localhost:${port}/api/cron/bc-warehouse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
        body: JSON.stringify({ full: true }),
      })
        .then(r => r.json())
        .then(d => console.log('[cron/bc-warehouse] FULL complete', JSON.stringify(d.results ?? d)))
        .catch(e => console.warn('[cron/bc-warehouse] FULL error:', e.message))
        .finally(() => setTimeout(runFullWarehouseSync, msUntilLondonHour(5)))
    }
    {
      const wait = msUntilLondonHour(5)
      console.log(`[cron/bc-warehouse] next FULL sync in ${Math.round(wait / 1000 / 60)} minutes`)
      setTimeout(runFullWarehouseSync, wait)
    }

    // Daily database backup — runs once at midnight UTC, then every 24 hours.
    function runDbBackup() {
      const secret = process.env.CRON_SECRET
      if (!secret) { console.warn('[cron] CRON_SECRET not set — skipping db backup') ; return }
      console.log('[cron/db-backup] starting daily backup')
      fetch(`http://localhost:${port}/api/cron/db-backup`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${secret}` },
      })
        .then(r => r.json())
        .then(d => console.log('[cron/db-backup] complete:', d.filename, `(${d.sizeBytes} bytes)`))
        .catch(e => console.warn('[cron/db-backup] error:', e.message))
    }
    const now = new Date()
    const nextMidnightUTC = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1, 0, 0, 0))
    const msUntilMidnight = nextMidnightUTC - now
    console.log(`[cron/db-backup] next backup in ${Math.round(msUntilMidnight / 1000 / 60)} minutes`)
    setTimeout(() => {
      runDbBackup()
      setInterval(runDbBackup, 24 * 60 * 60 * 1000)
    }, msUntilMidnight)

    // Auto Pipeline queue — works through the queued sales overnight so a run no
    // longer needs the browser tab left open. Each tick does about nine minutes
    // of work and returns; the next one carries on from the same lot. Ticking
    // every 30s keeps the gap between slices small, and a tick is a cheap no-op
    // whenever a slice is already in flight or the queue is empty.
    const PIPELINE_TICK_MS = 30 * 1000
    let pipelineTickBusy = false
    function runPipelineQueue() {
      const secret = process.env.CRON_SECRET
      if (!secret) return   // silent: this loop ticks constantly, unlike the others
      // A slice outlives the tick interval, so guard here as well as in the DB.
      if (pipelineTickBusy) return
      pipelineTickBusy = true
      fetch(`http://localhost:${port}/api/cron/pipeline-queue`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      })
        .then(r => r.json())
        .then(d => { if (d && d.ran) console.log(`[cron/pipeline-queue] ${d.code}: ${d.message} (${d.done}/${d.total}, ${d.stage})`) })
        .catch(e => console.warn('[cron/pipeline-queue] error:', e.message))
        .finally(() => { pipelineTickBusy = false })
    }
    setTimeout(() => {
      runPipelineQueue()
      setInterval(runPipelineQueue, PIPELINE_TICK_MS)
    }, 60 * 1000)

    // IT mailbox poll — turns new IT@vectis.co.uk emails into Job Board jobs.
    // Every 5 minutes, first run delayed 90s. No-op until the mailbox is connected.
    const IT_MAILBOX_INTERVAL_MS = 5 * 60 * 1000
    function runITMailboxSync() {
      const secret = process.env.CRON_SECRET
      if (!secret) return
      fetch(`http://localhost:${port}/api/cron/it-mailbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      })
        .then(r => r.json())
        .then(d => { if (d && d.created) console.log(`[cron/it-mailbox] created ${d.created} job(s)`) })
        .catch(e => console.warn('[cron/it-mailbox] error:', e.message))
    }
    setTimeout(() => {
      runITMailboxSync()
      setInterval(runITMailboxSync, IT_MAILBOX_INTERVAL_MS)
    }, 90 * 1000)

    // Condition-reports mailbox poll — turns new condition-report emails into
    // Condition Reports. Every 5 minutes, first run delayed 100s. No-op until
    // the mailbox is connected and CONDITION_MAILBOX is set.
    const CONDITION_MAILBOX_INTERVAL_MS = 5 * 60 * 1000
    function runConditionMailboxSync() {
      const secret = process.env.CRON_SECRET
      if (!secret) return
      fetch(`http://localhost:${port}/api/cron/condition-mailbox`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${secret}` },
      })
        .then(r => r.json())
        .then(d => { if (d && d.created) console.log(`[cron/condition-mailbox] created ${d.created} report(s)`) })
        .catch(e => console.warn('[cron/condition-mailbox] error:', e.message))
    }
    setTimeout(() => {
      runConditionMailboxSync()
      setInterval(runConditionMailboxSync, CONDITION_MAILBOX_INTERVAL_MS)
    }, 100 * 1000)

    // 🚦 Status Centre — checks every outside service the Hub relies on and records the
    // result, so /admin/status can answer "is it us or a supplier?" and the admin bell can
    // say when something breaks or recovers. Each tick runs only the checks that are due.
    //
    // ⚠ PRODUCTION ONLY. On staging and sandbox it would wake their Neon branches every tick
    // (the database check opens ~28 connections) and ring bells about test copies of
    // production's data. There, the page's "Check now" runs the same checks on demand.
    // ⚠ Not gated on CRON_SECRET like the loops above: each check is read-only (no emails,
    // no orders, no AI generation, no probe rows), and it proves itself to its own route
    // with a token made fresh at boot and held only in this process.
    globalThis._statusToken = require('crypto').randomBytes(24).toString('hex')
    const STATUS_INTERVAL_MS = 5 * 60 * 1000
    let statusBusy = false
    function runStatusChecks() {
      if (process.env.RAILWAY_ENVIRONMENT_NAME !== 'production') return
      if (statusBusy) return
      statusBusy = true
      fetch(`http://localhost:${port}/api/status/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-status-token': globalThis._statusToken },
        body: '{}',
      })
        .then(r => r.json())
        .then(d => { if (d && d.changed && d.changed.length) console.log(`[status] changed: ${d.changed.join(', ')}`) })
        .catch(e => console.warn('[status] error:', e.message))
        .finally(() => { statusBusy = false })
    }
    setTimeout(() => {
      runStatusChecks()
      setInterval(runStatusChecks, STATUS_INTERVAL_MS)
    }, 2 * 60 * 1000)
  })
})

// Custom Next.js server with Socket.IO for live auction support
const { createServer } = require('http')
const { parse }        = require('url')
const next             = require('next')
const { Server }       = require('socket.io')
const { Pool }         = require('pg')
const { setupAuctionSocket } = require('./lib/auction-socket')
require('dotenv').config()

const dev  = process.env.NODE_ENV !== 'production'
const port = parseInt(process.env.PORT || '3000', 10)
const app  = next({ dev })
const handle = app.getRequestHandler()

// On startup, reset any stale ACTIVE/PAUSED live auctions to PENDING.
// The in-memory state is always lost on restart, so the public site
// must not show a live banner until a clerk explicitly presses Start.
async function resetStaleLiveAuctions() {
  const pool = new Pool({ connectionString: process.env.DATABASE_URL })
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
  await resetStaleLiveAuctions()

  const httpServer = createServer((req, res) => {
    const parsedUrl = parse(req.url, true)
    handle(req, res, parsedUrl)
  })

  const io = new Server(httpServer, {
    cors: { origin: '*', methods: ['GET', 'POST'] },
    transports: ['websocket', 'polling'],
  })

  setupAuctionSocket(io)

  // Make io accessible to API routes via globalThis
  globalThis._io = io

  httpServer.listen(port, () => {
    console.log(`> Vectis Hub ready on http://localhost:${port}`)
    console.log(`> Socket.IO live auction server active`)
  })
})

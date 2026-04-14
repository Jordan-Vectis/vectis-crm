import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

export async function GET() {
  // Read live auction state from in-memory Socket.IO server
  const io = (globalThis as any)._io
  if (!io) {
    return NextResponse.json({ auction: null, currentLot: null, lots: [], onlineCount: 0 })
  }

  // Access the shared state exported by auction-socket.js via globalThis
  const state = (globalThis as any)._liveState
  if (!state) {
    return NextResponse.json({ auction: null, currentLot: null, lots: [], onlineCount: 0 })
  }

  return NextResponse.json(state)
}

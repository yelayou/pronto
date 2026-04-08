import { NextResponse } from 'next/server'

export async function GET() {
  return NextResponse.json(
    {
      status: 'ok',
      service: 'pronto',
      timestamp: new Date().toISOString(),
    },
    { status: 200 }
  )
}

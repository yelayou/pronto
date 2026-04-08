import { NextRequest, NextResponse } from 'next/server'
import { calculateFare } from '@/lib/fare/calculator'
import type { FareInput } from '@/types'

export async function POST(request: NextRequest) {
  let body: FareInput

  try {
    body = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { distanceKm, durationMin, serviceType, timeOfDay, heavyTraffic } = body

  if (
    typeof distanceKm !== 'number' ||
    typeof durationMin !== 'number' ||
    !serviceType ||
    !timeOfDay ||
    typeof heavyTraffic !== 'boolean'
  ) {
    return NextResponse.json(
      { error: 'Missing required fields: distanceKm, durationMin, serviceType, timeOfDay, heavyTraffic' },
      { status: 400 }
    )
  }

  const result = calculateFare(body)

  return NextResponse.json(result, { status: 200 })
}

import { NextRequest, NextResponse } from 'next/server'
import { calculateFare } from '@/lib/fare/calculator'
import { FareInputSchema } from '@/lib/validation/schemas'
import { logger } from '@/lib/logger'

export async function POST(request: NextRequest) {
  let raw: unknown

  try {
    raw = await request.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const parsed = FareInputSchema.safeParse(raw)
  if (!parsed.success) {
    logger.warn('Invalid request payload', { issues: parsed.error.issues.map(i => i.message) })
    return NextResponse.json(
      { error: 'Invalid input', issues: parsed.error.issues },
      { status: 400 }
    )
  }

  const result = calculateFare(parsed.data)
  return NextResponse.json(result, { status: 200 })
}

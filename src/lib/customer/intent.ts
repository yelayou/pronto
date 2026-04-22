import Anthropic from '@anthropic-ai/sdk'
import type { Tool, ToolUseBlock } from '@anthropic-ai/sdk/resources/beta/tools/messages'
import { ConversationState, ServiceType, PackageSize, PaymentMethod } from '@/types'

// ─── Intent extraction result types ────────────────────────────────────────────

export interface IntentResult {
  // Extracted fields (all optional — only what was found)
  serviceType?: ServiceType
  pickupAddress?: string
  dropoffAddress?: string
  passengerCount?: number
  packageSize?: PackageSize
  fragile?: boolean
  recipientName?: string
  paymentMethod?: PaymentMethod

  // Disambiguation flag — set when pickup or dropoff matches a known ambiguous landmark
  needsDisambiguation?: boolean
  disambiguationField?: 'pickup' | 'dropoff'  // which field needs disambiguation
  landmarkId?: string  // e.g. 'pearson', 'union_station', 'billy_bishop'

  // What to ask the customer next (for the missing required field)
  nextPrompt?: string

  // Whether customer is confirming/cancelling an existing summary
  confirmationIntent?: 'confirm' | 'cancel' | 'correction'
}

// ─── Tool schema for Claude tool_use ──────────────────────────────────────────

const EXTRACTION_TOOL: Tool = {
  name: 'extract_booking_fields',
  description:
    'Extract structured booking fields from customer WhatsApp message for Pronto ride/delivery service',
  input_schema: {
    type: 'object' as const,
    properties: {
      serviceType: {
        type: 'string',
        enum: ['ride', 'package'],
        description: 'Service type: ride for passengers, package for delivery'
      },
      pickupAddress: {
        type: 'string',
        description: 'Pickup address or location. May be ambiguous (e.g. "airport", "union station")'
      },
      dropoffAddress: {
        type: 'string',
        description: 'Drop-off address or location'
      },
      passengerCount: {
        type: 'integer',
        minimum: 1,
        maximum: 6,
        description: 'Number of passengers (ride only)'
      },
      packageSize: {
        type: 'string',
        enum: ['small', 'large'],
        description: 'Package size (package delivery only)'
      },
      fragile: {
        type: 'boolean',
        description: 'Whether package contains fragile items (package delivery only)'
      },
      recipientName: {
        type: 'string',
        description: 'Recipient name for package delivery'
      },
      paymentMethod: {
        type: 'string',
        enum: ['cash', 'etransfer'],
        description: 'Payment method: cash or e-transfer'
      },
      ambiguousLandmark: {
        type: 'string',
        description:
          'If pickup or dropoff matches a known ambiguous landmark, set this to the landmark ID: "pearson" (Pearson airport), "union_station" (Union Station), or "billy_bishop" (Billy Bishop Island airport)'
      },
      confirmationIntent: {
        type: 'string',
        enum: ['confirm', 'cancel', 'correction'],
        description:
          'If customer is confirming ("yes", "book it"), cancelling ("no", "nevermind"), or asking to correct, set this'
      }
    }
  }
}

// ─── Landmark detection patterns ──────────────────────────────────────────────

const LANDMARK_PATTERNS: Record<
  string,
  { keywords: string[]; landmarkId: string }
> = {
  pearson: {
    keywords: ['airport', 'pearson', 'yyz', 'international airport', 'lester b pearson'],
    landmarkId: 'pearson'
  },
  union_station: {
    keywords: ['union station', 'union', 'downtown'],
    landmarkId: 'union_station'
  },
  billy_bishop: {
    keywords: ['billy bishop', 'island airport', 'ytz', 'billy bishop airport'],
    landmarkId: 'billy_bishop'
  }
}

// ─── Confirmation intent patterns ─────────────────────────────────────────────

const CONFIRM_KEYWORDS = ['yes', 'yep', 'yeah', 'sure', 'confirm', 'book', 'ok', 'okay', 'perfect']
const CANCEL_KEYWORDS = ['no', 'cancel', 'nevermind', 'never mind', 'nope']
const CORRECTION_KEYWORDS = ['change', 'wrong', 'correct', 'fix', 'update']

// ─── Required fields by service type ──────────────────────────────────────────

const REQUIRED_FIELDS: Record<ServiceType, (keyof Omit<ConversationState, 'customerPhone' | 'stage' | 'updatedAt' | 'pickupLat' | 'pickupLng' | 'dropoffLat' | 'dropoffLng' | 'notes' | 'fareResult'>)[]> = {
  ride: ['serviceType', 'pickupAddress', 'dropoffAddress', 'passengerCount', 'paymentMethod'],
  package: ['serviceType', 'pickupAddress', 'dropoffAddress', 'packageSize', 'recipientName', 'paymentMethod']
}

// ─── Helper: detect landmark in address ───────────────────────────────────────

function detectLandmark(address: string): { landmarkId: string } | null {
  if (!address) return null

  const normalized = address.toLowerCase()
  for (const { keywords, landmarkId } of Object.values(LANDMARK_PATTERNS)) {
    if (keywords.some((kw) => normalized.includes(kw))) {
      return { landmarkId }
    }
  }
  return null
}

// ─── Helper: detect confirmation intent ───────────────────────────────────────

function detectConfirmationIntent(
  message: string
): 'confirm' | 'cancel' | 'correction' | null {
  const normalized = message.toLowerCase().trim()

  if (CONFIRM_KEYWORDS.some((kw) => normalized.includes(kw))) {
    // But check if it's not a negation like "no, but yes..." → fallback to Claude
    if (!CANCEL_KEYWORDS.some((kw) => normalized.startsWith(kw))) {
      return 'confirm'
    }
  }

  if (CANCEL_KEYWORDS.some((kw) => normalized.startsWith(kw))) {
    return 'cancel'
  }

  if (CORRECTION_KEYWORDS.some((kw) => normalized.includes(kw))) {
    return 'correction'
  }

  return null
}

// ─── Helper: merge extracted fields with conversation state ──────────────────

function mergeWithConversation(
  extracted: Record<string, unknown>,
  convo: ConversationState
): Partial<ConversationState> {
  const merged: Partial<ConversationState> = { ...convo }

  if (extracted.serviceType) merged.serviceType = extracted.serviceType as ServiceType
  if (extracted.pickupAddress) merged.pickupAddress = extracted.pickupAddress as string
  if (extracted.dropoffAddress) merged.dropoffAddress = extracted.dropoffAddress as string
  if (extracted.passengerCount !== undefined && extracted.passengerCount !== null) {
    merged.passengerCount = extracted.passengerCount as number
  }
  if (extracted.packageSize) merged.packageSize = extracted.packageSize as PackageSize
  if (extracted.fragile !== undefined && extracted.fragile !== null) {
    merged.fragile = extracted.fragile as boolean
  }
  if (extracted.recipientName) merged.recipientName = extracted.recipientName as string
  if (extracted.paymentMethod) merged.paymentMethod = extracted.paymentMethod as PaymentMethod

  return merged
}

// ─── Helper: compute next prompt based on missing required fields ─────────────

function computeNextPrompt(
  merged: Partial<ConversationState>,
  customerName?: string
): string {
  const serviceType = merged.serviceType

  // If service type not yet known, ask for it
  if (!serviceType) {
    const greeting = customerName ? ` Hi ${customerName},` : ''
    return `${greeting} are you looking for a ride or package delivery?`
  }

  const required = REQUIRED_FIELDS[serviceType]
  for (const field of required) {
    if (!merged[field]) {
      // Return natural next question based on what's missing
      switch (field) {
        case 'pickupAddress':
          return "Where are we picking up from?"
        case 'dropoffAddress':
          return "And where are we dropping off?"
        case 'passengerCount':
          return "How many passengers?"
        case 'packageSize':
          return "Is this a small or large package?"
        case 'recipientName':
          return "What's the recipient's name?"
        case 'paymentMethod':
          return "Will you be paying in cash or by e-transfer?"
        default:
          return "Got it. What else do you need?"
      }
    }
  }

  // All required fields present; ask for confirmation
  return "Ready to confirm your booking?"
}

// ─── Main extraction function ─────────────────────────────────────────────────

export async function extractIntent(
  message: string,
  convo: ConversationState,
  customerName?: string
): Promise<IntentResult> {
  try {
    const client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })

    // Check for quick confirmation intent first
    const quickConfirm = detectConfirmationIntent(message)
    if (quickConfirm) {
      return {
        confirmationIntent: quickConfirm,
        nextPrompt: computeNextPrompt(convo, customerName)
      }
    }

    // Call Claude with tool_use to extract fields (tool use is in beta in SDK 0.21)
    const response = await client.beta.tools.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 1024,
      tools: [EXTRACTION_TOOL],
      messages: [
        {
          role: 'user',
          content: `Extract booking information from this Pronto customer message (GTA ride/delivery service).

Current conversation state:
- Service type: ${convo.serviceType || 'not yet selected'}
- Pickup: ${convo.pickupAddress || 'not yet provided'}
- Dropoff: ${convo.dropoffAddress || 'not yet provided'}
- Passengers: ${convo.passengerCount || 'N/A'}
- Package size: ${convo.packageSize || 'N/A'}
- Recipient: ${convo.recipientName || 'N/A'}
- Payment: ${convo.paymentMethod || 'not yet selected'}
- Customer name: ${customerName || 'unknown'}

Message: "${message}"

Extract only the fields that are present or clearly stated in the message. Preserve existing conversation state for fields not mentioned. Detect ambiguous landmarks in addresses.`
        }
      ]
    })

    // Extract tool use block — response.content is ToolsBetaContentBlock[] (TextBlock | ToolUseBlock)
    let extractedFields: Record<string, unknown> = {}
    for (const block of response.content) {
      const toolBlock = block as ToolUseBlock
      if (toolBlock.type === 'tool_use' && toolBlock.name === 'extract_booking_fields') {
        extractedFields = toolBlock.input as Record<string, unknown>
        break
      }
    }

    // Merge with conversation state
    const merged = mergeWithConversation(extractedFields, convo)

    // Check for landmark disambiguation needs
    let needsDisambiguation = false
    let disambiguationField: 'pickup' | 'dropoff' | undefined
    let landmarkId: string | undefined

    if (merged.pickupAddress) {
      const landmark = detectLandmark(merged.pickupAddress)
      if (landmark) {
        needsDisambiguation = true
        disambiguationField = 'pickup'
        landmarkId = landmark.landmarkId
      }
    }

    if (!needsDisambiguation && merged.dropoffAddress) {
      const landmark = detectLandmark(merged.dropoffAddress)
      if (landmark) {
        needsDisambiguation = true
        disambiguationField = 'dropoff'
        landmarkId = landmark.landmarkId
      }
    }

    // Compute next prompt based on what's missing
    const nextPrompt = computeNextPrompt(merged, customerName)

    return {
      serviceType: merged.serviceType,
      pickupAddress: merged.pickupAddress,
      dropoffAddress: merged.dropoffAddress,
      passengerCount: merged.passengerCount,
      packageSize: merged.packageSize,
      fragile: merged.fragile,
      recipientName: merged.recipientName,
      paymentMethod: merged.paymentMethod,
      needsDisambiguation,
      disambiguationField,
      landmarkId,
      nextPrompt,
      confirmationIntent: quickConfirm || undefined
    }
  } catch (error) {
    // Graceful error fallback
    console.error('Intent extraction error:', error)
    return {
      nextPrompt: "Sorry, I didn't catch that — could you try again?"
    }
  }
}

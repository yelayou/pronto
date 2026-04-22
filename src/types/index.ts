// ─── Service types ────────────────────────────────────────────────────────────

export type ServiceType = 'ride' | 'package'
export type PackageSize = 'small' | 'large'
export type TimeOfDay = 'normal' | 'peak' | 'late'
export type PaymentMethod = 'cash' | 'etransfer'
export type BookingStatus =
  | 'pending'
  | 'confirmed'
  | 'en_route'
  | 'arrived'
  | 'complete'
  | 'declined'
  | 'noshow'
  | 'cancelled'

// ─── Fare types ───────────────────────────────────────────────────────────────

export interface FareInput {
  distanceKm: number
  durationMin: number
  serviceType: ServiceType
  timeOfDay: TimeOfDay
  heavyTraffic: boolean
  packageSize?: PackageSize
  fragile?: boolean
}

export interface FareResult {
  total: number          // HST included — what customer pays
  preHST: number         // before HST
  hst: number            // HST amount
  rangeL: number         // lower bound (total * 0.95)
  rangeH: number         // upper bound (total * 1.05)
  winner: 'time' | 'distance' | 'minimum'
  timeCost: number
  distCost: number
  tripBase: number
  surcharges: {
    traffic: number
    package: number
    fragile: number
  }
  multiplier: number
  breakdown: Array<{ label: string; value: string }>
}

// ─── Booking types ────────────────────────────────────────────────────────────

export interface BookingRecord {
  id: string
  queueNumber: number        // short human-readable queue ID, e.g. 3 → displayed as #3
  customerPhone: string
  serviceType: ServiceType
  pickupAddress: string
  dropoffAddress: string
  pickupLat?: number
  pickupLng?: number
  dropoffLat?: number
  dropoffLng?: number
  fare: number
  fareBreakdown: FareResult
  status: BookingStatus
  paymentMethod: PaymentMethod
  passengerCount?: number
  packageSize?: PackageSize
  fragile?: boolean
  recipientName?: string
  notes?: string
  createdAt: string
  updatedAt: string
}

// ─── Customer types ───────────────────────────────────────────────────────────

export interface CustomerRecord {
  phone: string
  name?: string
  bookingCount: number
  incidentCount: number
  lastSeen: string
}

// ─── Dispatcher state ─────────────────────────────────────────────────────────

export interface DispatcherState {
  dutyStatus: 'on' | 'off'
  currentZone: string | null
  currentLat?: number
  currentLng?: number
  updatedAt: string
}

// ─── Incident types ───────────────────────────────────────────────────────────

export type IncidentType = 'noshow' | 'cancel'

export interface IncidentRecord {
  id: string
  customerPhone: string
  bookingId: string
  type: IncidentType
  feeAmount: number
  createdAt: string
}

// ─── Conversation state (stored in Supabase per customer) ─────────────────────

export type ConversationStage =
  | 'idle'
  | 'awaiting_name'       // first-time customers only — collect name before service menu
  | 'awaiting_service'
  | 'awaiting_pickup'
  | 'awaiting_dropoff'
  | 'awaiting_landmark'   // customer named an ambiguous landmark — waiting for sub-location choice
  | 'awaiting_pax'
  | 'awaiting_pkg_size'
  | 'awaiting_recipient'
  | 'awaiting_payment'
  | 'awaiting_confirm'
  | 'confirmed'

/**
 * Stored while the customer is choosing a sub-location for an ambiguous landmark
 * (e.g. "Pearson" → which terminal?). Cleared once resolved or if they share a pin.
 */
export interface PendingLandmark {
  /** Which booking field is being disambiguated */
  field: 'pickup' | 'dropoff'
  /** Matches a key in the LANDMARKS map — e.g. 'pearson' | 'union_station' | 'billy_bishop' */
  landmarkId: string
}

export interface ConversationState {
  customerPhone: string
  stage: ConversationStage
  serviceType?: ServiceType
  pickupAddress?: string
  pickupLat?: number
  pickupLng?: number
  dropoffAddress?: string
  dropoffLat?: number
  dropoffLng?: number
  passengerCount?: number
  packageSize?: PackageSize
  fragile?: boolean
  recipientName?: string
  notes?: string
  paymentMethod?: PaymentMethod
  fareResult?: FareResult
  /** Set while waiting for the customer to pick a landmark sub-location. Stored as JSONB in Supabase. */
  pendingLandmark?: PendingLandmark
  updatedAt: string
}

// ─── Twilio webhook payload ───────────────────────────────────────────────────

export interface TwilioWebhookPayload {
  From: string       // e.g. whatsapp:+14165550123
  To: string         // your Twilio number
  Body: string       // message text
  MessageSid: string
  AccountSid: string
  NumMedia?: string
  Latitude?: string  // if customer shares location
  Longitude?: string
}

// ─── Maps types ───────────────────────────────────────────────────────────────

export interface LatLng {
  lat: number
  lng: number
}

export interface RouteResult {
  distanceKm: number
  durationMin: number          // with live traffic
  durationMinNoTraffic: number // baseline
  heavyTraffic: boolean        // true if traffic adds >20% to duration
}

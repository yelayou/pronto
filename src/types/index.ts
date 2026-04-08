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
  | 'awaiting_service'
  | 'awaiting_pickup'
  | 'awaiting_dropoff'
  | 'awaiting_pax'
  | 'awaiting_pkg_size'
  | 'awaiting_recipient'
  | 'awaiting_payment'
  | 'awaiting_confirm'
  | 'confirmed'

export interface ConversationState {
  customerPhone: string
  stage: ConversationStage
  serviceType?: ServiceType
  pickupAddress?: string
  dropoffAddress?: string
  passengerCount?: number
  packageSize?: PackageSize
  fragile?: boolean
  recipientName?: string
  notes?: string
  paymentMethod?: PaymentMethod
  fareResult?: FareResult
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

/**
 * Smart greeting system for Pronto customers.
 *
 * Generates deterministic, context-aware greetings based on:
 * - Customer status (returning vs first-time)
 * - Time of day (morning, afternoon, evening, late night)
 * - Day of week (Monday, Friday, weekend)
 * - Canadian public holidays (computed dynamically)
 * - Season (winter, spring, summer, fall)
 *
 * Determinism guarantee: The same customer on the same day always receives
 * the same greeting variant, computed via hash(phone + dateString) % variants.length.
 * This prevents repetitive copy while maintaining predictability.
 */

// ─── Helper: Easter calculation (Computus algorithm) ───────────────────────────
function getEasterDate(year: number): Date {
  const a = year % 19
  const b = Math.floor(year / 100)
  const c = year % 100
  const d = Math.floor(b / 4)
  const e = b % 4
  const f = Math.floor((b + 8) / 25)
  const g = Math.floor((b - f + 1) / 3)
  const h = (19 * a + b - d - g + 15) % 30
  const i = Math.floor(c / 4)
  const k = c % 4
  const l = (32 + 2 * e + 2 * i - h - k) % 7
  const m = Math.floor((a + 11 * h + 22 * l) / 451)
  const month = Math.floor((h + l - 7 * m + 114) / 31)
  const day = ((h + l - 7 * m + 114) % 31) + 1
  return new Date(year, month - 1, day)
}

// ─── Helper: Get specific holidays for a given year/month/day ──────────────────
interface Holiday {
  name: string
  date: Date
}

function getCanadianHolidays(year: number): Holiday[] {
  const holidays: Holiday[] = []

  // Fixed-date holidays
  holidays.push({
    name: 'New Year\'s Day',
    date: new Date(year, 0, 1),
  })
  holidays.push({
    name: 'Canada Day',
    date: new Date(year, 6, 1),
  })
  holidays.push({
    name: 'Remembrance Day',
    date: new Date(year, 10, 11),
  })
  holidays.push({
    name: 'Christmas',
    date: new Date(year, 11, 25),
  })
  holidays.push({
    name: 'Boxing Day',
    date: new Date(year, 11, 26),
  })

  // Family Day (3rd Monday of February, Ontario)
  {
    let day = 1
    let count = 0
    while (count < 3) {
      const d = new Date(year, 1, day)
      if (d.getDay() === 1) count++
      if (count === 3) {
        holidays.push({ name: 'Family Day', date: new Date(year, 1, day) })
        break
      }
      day++
    }
  }

  // Good Friday (Friday before Easter)
  {
    const easter = getEasterDate(year)
    const goodFriday = new Date(easter)
    goodFriday.setDate(goodFriday.getDate() - 2)
    holidays.push({ name: 'Good Friday', date: goodFriday })
  }

  // Victoria Day (Monday before May 25)
  {
    let day = 24
    while (day >= 18) {
      const d = new Date(year, 4, day)
      if (d.getDay() === 1) {
        holidays.push({ name: 'Victoria Day', date: d })
        break
      }
      day--
    }
  }

  // Civic Holiday (1st Monday of August)
  {
    let day = 1
    let count = 0
    while (count < 1) {
      const d = new Date(year, 7, day)
      if (d.getDay() === 1) {
        holidays.push({ name: 'Civic Holiday', date: d })
        count++
      }
      day++
    }
  }

  // Labour Day (1st Monday of September)
  {
    let day = 1
    let count = 0
    while (count < 1) {
      const d = new Date(year, 8, day)
      if (d.getDay() === 1) {
        holidays.push({ name: 'Labour Day', date: d })
        count++
      }
      day++
    }
  }

  // Thanksgiving (2nd Monday of October)
  {
    let day = 1
    let count = 0
    while (count < 2) {
      const d = new Date(year, 9, day)
      if (d.getDay() === 1) count++
      if (count === 2) {
        holidays.push({ name: 'Thanksgiving', date: new Date(year, 9, day) })
        break
      }
      day++
    }
  }

  return holidays
}

// ─── Helper: Check if today is a holiday ───────────────────────────────────────
function isHolidayToday(now: Date): string | null {
  const holidays = getCanadianHolidays(now.getFullYear())
  for (const holiday of holidays) {
    if (
      holiday.date.getFullYear() === now.getFullYear() &&
      holiday.date.getMonth() === now.getMonth() &&
      holiday.date.getDate() === now.getDate()
    ) {
      return holiday.name
    }
  }
  return null
}

// ─── Helper: Deterministic hash for variant rotation ──────────────────────────
function simpleHash(str: string): number {
  let hash = 5381
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) + hash + str.charCodeAt(i)
  }
  return Math.abs(hash)
}

// ─── Helper: Get time of day ───────────────────────────────────────────────────
function getTimeOfDay(hour: number): 'morning' | 'afternoon' | 'evening' | 'late_night' {
  if (hour >= 5 && hour < 12) return 'morning'
  if (hour >= 12 && hour < 18) return 'afternoon'
  if (hour >= 18 && hour < 22) return 'evening'
  return 'late_night' // 22–4
}

// ─── Helper: Get season ────────────────────────────────────────────────────────
function getSeason(month: number): 'winter' | 'spring' | 'summer' | 'fall' {
  if (month >= 11 || month < 2) return 'winter'
  if (month >= 2 && month < 5) return 'spring'
  if (month >= 5 && month < 8) return 'summer'
  return 'fall'
}

// ─── Helper: Get day name ─────────────────────────────────────────────────────
function getDayName(dayOfWeek: number): string {
  const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
  return days[dayOfWeek]
}

// ─── Greeting templates per scenario ───────────────────────────────────────────

type GreetingContext = {
  timeOfDay: 'morning' | 'afternoon' | 'evening' | 'late_night'
  dayOfWeek: string
  isWeekend: boolean
  season: 'winter' | 'spring' | 'summer' | 'fall'
  holiday: string | null
  isReturning: boolean
  name?: string
}

function getGreetingVariants(ctx: GreetingContext): string[] {
  const { timeOfDay, dayOfWeek, isWeekend, season, holiday, isReturning, name } = ctx

  // ─── Holiday-specific greetings ────────────────────────────────────────────
  if (holiday === 'New Year\'s Day') {
    return isReturning
      ? [
          `Welcome back, ${name}! 🎆 Happy New Year — fresh start vibes!`,
          `Hey ${name}! 🌟 New year, new journeys with Pronto.`,
          `${name}! 🎉 Welcome back on this auspicious day.`,
        ]
      : [
          "Hi! Welcome to Pronto 👋 Happy New Year! 🎆 Fresh start, reliable rides.",
          "Welcome aboard! 🌟 Starting the year right with Pronto.",
          "Happy New Year! 🎉 Let's get you moving in 2026.",
        ]
  }

  if (holiday === 'Family Day') {
    return isReturning
      ? [
          `Welcome back, ${name}! 👨‍👩‍👧‍👦 Hope you're enjoying Family Day!`,
          `Hey ${name}! ❤️ Family Day — let us handle your travels.`,
          `${name}! 👪 Welcome back for Family Day.`,
        ]
      : [
          "Hi! Welcome to Pronto 👋 Family Day on us — let's get you there.",
          "Welcome! 👨‍👩‍👧‍👦 Family Day awaits — we'll get you where you need to be.",
          "Family Day greetings! ❤️ Pronto's here to help.",
        ]
  }

  if (holiday === 'Good Friday') {
    return isReturning
      ? [
          `Welcome back, ${name}! 🙏 Wishing you a peaceful Good Friday.`,
          `Hey ${name}! 🌸 Good Friday — count on Pronto.`,
          `${name}! 💚 Welcome back this Good Friday.`,
        ]
      : [
          "Hi! Welcome to Pronto 👋 Good Friday blessings.",
          "Welcome aboard! 🙏 Reliable rides, always.",
          "Good Friday greetings! 🌸 Pronto's here for you.",
        ]
  }

  if (holiday === 'Victoria Day') {
    return isReturning
      ? [
          `Welcome back, ${name}! 🇨🇦 Victoria Day long weekend starts now!`,
          `Hey ${name}! 🌺 Weekend vibes — let's get you out.`,
          `${name}! 🎆 Welcome back for the long weekend.`,
        ]
      : [
          "Hi! Welcome to Pronto 👋 Long weekend, here we go! 🇨🇦",
          "Welcome! 🌺 Victoria Day — your ride awaits.",
          "Long weekend begins! 🎆 Pronto's ready.",
        ]
  }

  if (holiday === 'Canada Day') {
    return isReturning
      ? [
          `Welcome back, ${name}! 🇨🇦 Happy Canada Day! 🍁`,
          `Hey ${name}! 🎇 Canada Day — celebrate in style.`,
          `${name}! 🔥 Welcome back on Canada's day.`,
        ]
      : [
          "Hi! Welcome to Pronto 👋 Happy Canada Day! 🇨🇦 🍁",
          "Welcome aboard! 🎆 Canada Day — let's get rolling.",
          "Happy Canada Day! 🔥 Pronto's here to help.",
        ]
  }

  if (holiday === 'Civic Holiday') {
    return isReturning
      ? [
          `Welcome back, ${name}! 🎉 Civic Holiday — time off!`,
          `Hey ${name}! ☀️ Enjoy your long weekend.`,
          `${name}! 🌟 Welcome back for the August long weekend.`,
        ]
      : [
          "Hi! Welcome to Pronto 👋 Civic Holiday — let's get moving!",
          "Welcome! ☀️ Long weekend vibes starting now.",
          "Civic Holiday greetings! 🎉 Pronto's ready.",
        ]
  }

  if (holiday === 'Labour Day') {
    return isReturning
      ? [
          `Welcome back, ${name}! 💼 Labour Day — well-deserved rest!`,
          `Hey ${name}! 🌅 End of summer long weekend incoming.`,
          `${name}! 🎊 Welcome back for Labour Day.`,
        ]
      : [
          "Hi! Welcome to Pronto 👋 Labour Day — enjoy your break!",
          "Welcome aboard! 💼 Long weekend mode: activated.",
          "Labour Day greetings! 🌅 Pronto's here.",
        ]
  }

  if (holiday === 'Thanksgiving') {
    return isReturning
      ? [
          `Welcome back, ${name}! 🦃 Happy Thanksgiving!`,
          `Hey ${name}! 🍂 Grateful for your bookings.`,
          `${name}! 🥧 Thanksgiving vibes — let us get you home.`,
        ]
      : [
          "Hi! Welcome to Pronto 👋 Happy Thanksgiving! 🦃",
          "Welcome! 🍂 Grateful you're here.",
          "Thanksgiving greetings! 🥧 Let's get you there.",
        ]
  }

  if (holiday === 'Remembrance Day') {
    return isReturning
      ? [
          `Welcome back, ${name}! 🕯️ Remembrance Day.`,
          `Hey ${name}! 🇨🇦 We remember and honor.`,
          `${name}! 🎗️ Welcome back this solemn day.`,
        ]
      : [
          "Hi! Welcome to Pronto 👋 🕯️ Lest we forget.",
          "Welcome. 🇨🇦 Remembrance Day.",
          "Respect and honor. 🎗️ Pronto's here.",
        ]
  }

  if (holiday === 'Christmas') {
    return isReturning
      ? [
          `Welcome back, ${name}! 🎄 Merry Christmas! 🎅`,
          `Hey ${name}! 🎅 Spreading festive cheer — let's get you home.`,
          `${name}! 🎁 Christmas magic is here.`,
        ]
      : [
          "Hi! Welcome to Pronto 👋 Merry Christmas! 🎄 🎅",
          "Welcome aboard! 🎁 Festive rides, reliable service.",
          "Christmas greetings! 🎅 Let's get you there.",
        ]
  }

  if (holiday === 'Boxing Day') {
    return isReturning
      ? [
          `Welcome back, ${name}! 🎁 Boxing Day — more cheer!`,
          `Hey ${name}! 🎉 Post-Christmas vibes continue.`,
          `${name}! 🌟 Welcome back for Boxing Day.`,
        ]
      : [
          "Hi! Welcome to Pronto 👋 Boxing Day — deals and more! 🎁",
          "Welcome! 🎉 Let's keep the holiday spirit rolling.",
          "Boxing Day greetings! 🌟 Pronto's ready.",
        ]
  }

  // ─── Day-of-week specific (non-holiday) ────────────────────────────────────
  if (dayOfWeek === 'Monday' && !holiday) {
    return isReturning
      ? [
          `Good morning, ${name}! ☀️ Let's get your Monday started right.`,
          `Hey ${name}! 💪 Monday energy — let's go!`,
          `${name}! 🌅 Welcome back to kick off the week.`,
        ]
      : [
          "Hi! Welcome to Pronto 👋 Let's power through Monday together.",
          "Welcome aboard! 💪 Monday mission starts now.",
          "Monday greetings! ☀️ Reliable rides await.",
        ]
  }

  if (dayOfWeek === 'Friday' && !holiday) {
    return isReturning
      ? [
          `Welcome back, ${name}! 🎉 Friday at last! Weekend vibes incoming.`,
          `Hey ${name}! 🌞 Finally Friday — let's make it count.`,
          `${name}! 🎊 Friday magic — you earned this.`,
        ]
      : [
          "Hi! Welcome to Pronto 👋 It's Friday! 🎉 Weekend starts here.",
          "Welcome! 🎊 Friday energy — let's get moving.",
          "Friday greetings! 🌞 Pronto's ready for your weekend.",
        ]
  }

  if (isWeekend && dayOfWeek !== 'Friday' && !holiday) {
    return isReturning
      ? [
          `Welcome back, ${name}! 😎 Weekend warrior mode activated.`,
          `Hey ${name}! 🌴 Living your best weekend life.`,
          `${name}! 🎯 Weekend plans — we'll get you there.`,
        ]
      : [
          "Hi! Welcome to Pronto 👋 Weekend mode: ON 😎",
          "Welcome! 🌴 Enjoy your weekend — we're here for the rides.",
          "Weekend greetings! 🎯 Let's make it count.",
        ]
  }

  // ─── Time-of-day and seasonal combinations ──────────────────────────────────
  if (timeOfDay === 'morning') {
    if (season === 'winter') {
      return isReturning
        ? [
            `Good morning, ${name}! ❄️ Frosty start to the day.`,
            `Hey ${name}! 🌨️ Winter morning — warm ride ahead.`,
            `${name}! ☕ Chilly morning, but we'll get you there.`,
          ]
        : [
            "Good morning! ☀️ Winter vibes — let's get going.",
            "Welcome to Pronto! ❄️ Morning ride, warm service.",
            "Rise and shine! 🌨️ We're here to help.",
          ]
    }
    if (season === 'spring') {
      return isReturning
        ? [
            `Good morning, ${name}! 🌱 Spring is springing!`,
            `Hey ${name}! 🌸 Beautiful spring morning ahead.`,
            `${name}! 🦋 New beginnings, new journeys.`,
          ]
        : [
            "Good morning! 🌱 Spring energy — let's go!",
            "Welcome to Pronto! 🌸 Fresh spring start.",
            "Morning greetings! 🦋 Spring rides await.",
          ]
    }
    if (season === 'summer') {
      return isReturning
        ? [
            `Good morning, ${name}! ☀️ Summer sun is rising!`,
            `Hey ${name}! 🏖️ Beach season mornings are here.`,
            `${name}! 🌊 Golden summer morning energy.`,
          ]
        : [
            "Good morning! ☀️ Summer is HERE — let's ride!",
            "Welcome to Pronto! 🏖️ Sunrise and good vibes.",
            "Morning greetings! 🌊 Summer awaits.",
          ]
    }
    if (season === 'fall') {
      return isReturning
        ? [
            `Good morning, ${name}! 🍂 Fall foliage mornings!`,
            `Hey ${name}! 🌰 Autumn air — crisp and fresh.`,
            `${name}! 🎨 Golden hour mornings are back.`,
          ]
        : [
            "Good morning! 🍂 Fall energy — crisp and clear.",
            "Welcome to Pronto! 🌰 Beautiful autumn start.",
            "Morning greetings! 🎨 Fall rides begin.",
          ]
    }
  }

  if (timeOfDay === 'afternoon') {
    if (season === 'winter') {
      return isReturning
        ? [
            `${name}! ❄️ Afternoon chill — cozy ride incoming.`,
            `Hey ${name}! 🧊 Midday winter hustle.`,
            `Welcome back, ${name}! 🌨️ Afternoon ride, warm company.`,
          ]
        : [
            "Hi! ❄️ Winter afternoon — Pronto's here.",
            "Welcome to Pronto! 🧊 Afternoon ride service.",
            "Afternoon greetings! 🌨️ Let's get moving.",
          ]
    }
    if (season === 'spring') {
      return isReturning
        ? [
            `${name}! 🌱 Spring afternoon glow.`,
            `Hey ${name}! 🌼 Pleasant spring vibes.`,
            `Welcome back, ${name}! 🦋 Afternoon adventure awaits.`,
          ]
        : [
            "Hi! 🌱 Spring afternoon — let's go!",
            "Welcome to Pronto! 🌼 Lovely afternoon rides.",
            "Afternoon greetings! 🦋 Spring journeys.",
          ]
    }
    if (season === 'summer') {
      return isReturning
        ? [
            `${name}! ☀️ Summer afternoon heat — AC ride ready.`,
            `Hey ${name}! 🏖️ Midday summer hustle.`,
            `Welcome back, ${name}! 🌊 Afternoon beach trip?`,
          ]
        : [
            "Hi! ☀️ Hot summer afternoon — cool ride ahead.",
            "Welcome to Pronto! 🏖️ Summer rides all day.",
            "Afternoon greetings! 🌊 Let's beat the heat.",
          ]
    }
    if (season === 'fall') {
      return isReturning
        ? [
            `${name}! 🍂 Crisp fall afternoon vibes.`,
            `Hey ${name}! 🌰 Mid-autumn adventures.`,
            `Welcome back, ${name}! 🎨 Colorful afternoon ahead.`,
          ]
        : [
            "Hi! 🍂 Fall afternoon — let's ride!",
            "Welcome to Pronto! 🌰 Autumn afternoons.",
            "Afternoon greetings! 🎨 Fall journeys await.",
          ]
    }
  }

  if (timeOfDay === 'evening') {
    if (season === 'winter') {
      return isReturning
        ? [
            `${name}! ❄️ Winter evening — cozy night ahead.`,
            `Hey ${name}! 🌙 Snowy evenings have arrived.`,
            `Welcome back, ${name}! 💫 Dark winter night, warm ride.`,
          ]
        : [
            "Hi! ❄️ Winter evening — Pronto's lit.",
            "Welcome to Pronto! 🌙 Evening rides, safe journey.",
            "Evening greetings! 💫 Let's get home.",
          ]
    }
    if (season === 'spring') {
      return isReturning
        ? [
            `${name}! 🌱 Spring evenings are lengthening.`,
            `Hey ${name}! 🌸 Beautiful evening light.`,
            `Welcome back, ${name}! 🌅 Golden hour spring magic.`,
          ]
        : [
            "Hi! 🌱 Spring evening — gorgeous ride ahead.",
            "Welcome to Pronto! 🌸 Evening springtime.",
            "Evening greetings! 🌅 Enjoy the view.",
          ]
    }
    if (season === 'summer') {
      return isReturning
        ? [
            `${name}! ☀️ Summer's perfect evening time.`,
            `Hey ${name}! 🌅 Sunset vibes incoming.`,
            `Welcome back, ${name}! 🏖️ Long summer evening ahead.`,
          ]
        : [
            "Hi! ☀️ Summer evening — let's ride!",
            "Welcome to Pronto! 🌅 Beautiful summer night.",
            "Evening greetings! 🏖️ Enjoy the twilight.",
          ]
    }
    if (season === 'fall') {
      return isReturning
        ? [
            `${name}! 🍂 Autumn evening coolness.`,
            `Hey ${name}! 🌙 Fall nights are lovely.`,
            `Welcome back, ${name}! 🌃 Cozy fall evening.`,
          ]
        : [
            "Hi! 🍂 Fall evening — perfect ride weather.",
            "Welcome to Pronto! 🌙 Autumn evening awaits.",
            "Evening greetings! 🌃 Let's get there.",
          ]
    }
  }

  if (timeOfDay === 'late_night') {
    return isReturning
      ? [
          `${name}! 🌙 Late night out — safe ride home guaranteed.`,
          `Hey ${name}! 💤 Getting home safe and sound.`,
          `Welcome back, ${name}! 🛣️ We're here for late-night runs.`,
        ]
      : [
          "Hi! 🌙 Late night — Pronto's here, always.",
          "Welcome to Pronto! 💤 24/7 reliable service.",
          "Night owls welcome! 🛣️ Let's get you home.",
        ]
  }

  // ─── Fallback (should rarely hit) ──────────────────────────────────────────
  return isReturning
    ? [
        `Welcome back, ${name}! 👋 Let's get moving.`,
        `Hey ${name}! 🚀 Ready to roll?`,
        `${name}! ✨ Great to see you again.`,
      ]
    : [
        "Hi! Welcome to Pronto 👋 Let's get you where you need to go.",
        "Welcome aboard! 🚀 Ready to book a ride or delivery?",
        "Welcome! ✨ We're here 24/7 to help.",
      ]
}

/**
 * Build a greeting message for a customer.
 *
 * @param name - Customer's name (optional). If provided, customer is treated as returning.
 * @param phone - Customer's phone number (used for deterministic variant rotation).
 * @returns A personalized, deterministic greeting string.
 */
export function buildGreeting(name: string | undefined, phone: string): string {
  const now = new Date()
  const hour = now.getHours()
  const dayOfWeek = now.getDay()
  const month = now.getMonth()

  const timeOfDay = getTimeOfDay(hour)
  const dayName = getDayName(dayOfWeek)
  const isWeekend = dayOfWeek === 0 || dayOfWeek === 6
  const season = getSeason(month)
  const holiday = isHolidayToday(now)

  const ctx: GreetingContext = {
    timeOfDay,
    dayOfWeek: dayName,
    isWeekend,
    season,
    holiday,
    isReturning: !!name,
    name,
  }

  const variants = getGreetingVariants(ctx)

  // Deterministic variant selection: hash(phone + date) % count
  const dateString = now.toISOString().split('T')[0] // YYYY-MM-DD
  const hashInput = phone + dateString
  const variantIndex = simpleHash(hashInput) % variants.length

  return variants[variantIndex]
}

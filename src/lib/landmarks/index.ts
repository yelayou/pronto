export interface LandmarkOption {
  label: string;        // e.g. "Terminal 1", "Front St entrance"
  shortLabel: string;   // e.g. "T1", "Front St" — used in confirmation summary
  lat: number;
  lng: number;
}

export interface Landmark {
  id: string;                    // e.g. 'pearson', 'union_station', 'billy_bishop'
  name: string;                  // Full display name
  triggers: string[];            // Lowercase keywords that trigger this landmark
  prompt: string;                // WhatsApp message to send asking for sub-location
  options: LandmarkOption[];
}

export const LANDMARKS: Record<string, Landmark> = {
  pearson: {
    id: 'pearson',
    name: 'Toronto Pearson International Airport',
    triggers: ['airport', 'pearson', 'yyz', 'pearson airport', 'toronto airport', 'toronto pearson'],
    prompt: 'Which terminal at Pearson? 1️⃣ Terminal 1 or 2️⃣ Terminal 3\n\nOr share your 📍 location pin for a precise spot.',
    options: [
      {
        label: 'Terminal 1',
        shortLabel: 'T1',
        lat: 43.6777,
        lng: -79.6248,
      },
      {
        label: 'Terminal 3',
        shortLabel: 'T3',
        lat: 43.6826,
        lng: -79.6160,
      },
    ],
  },
  union_station: {
    id: 'union_station',
    name: 'Union Station',
    triggers: ['union station', 'union', 'go station', 'via rail', 'via rail station'],
    prompt: 'Which entrance at Union Station?\n\n1️⃣ Front St entrance\n2️⃣ Bay St entrance\n3️⃣ GO/VIA concourse\n\nOr share your 📍 location pin.',
    options: [
      {
        label: 'Front St entrance',
        shortLabel: 'Front St',
        lat: 43.6452,
        lng: -79.3806,
      },
      {
        label: 'Bay St entrance',
        shortLabel: 'Bay St',
        lat: 43.6451,
        lng: -79.3797,
      },
      {
        label: 'GO/VIA concourse',
        shortLabel: 'GO concourse',
        lat: 43.6448,
        lng: -79.3808,
      },
    ],
  },
  billy_bishop: {
    id: 'billy_bishop',
    name: 'Billy Bishop Toronto City Airport',
    triggers: ['billy bishop', 'island airport', 'ytz', 'city airport', 'porter', 'toronto city airport'],
    prompt: 'Billy Bishop — arriving by ferry or already at the terminal?\n\n1️⃣ Passenger terminal (on the island)\n2️⃣ Ferry terminal (Bathurst St, mainland)\n\nOr share your 📍 location pin.',
    options: [
      {
        label: 'Passenger terminal',
        shortLabel: 'Terminal',
        lat: 43.6281,
        lng: -79.3958,
      },
      {
        label: 'Ferry terminal (mainland)',
        shortLabel: 'Ferry',
        lat: 43.6413,
        lng: -79.3756,
      },
    ],
  },
};

/**
 * Returns the matching landmark if the text contains any trigger keyword, else null.
 * For 'union', only matches if it's a standalone word or part of 'union station'.
 */
export function findLandmark(text: string): Landmark | null {
  const lowerText = text.toLowerCase();

  for (const landmark of Object.values(LANDMARKS)) {
    for (const trigger of landmark.triggers) {
      if (trigger === 'union') {
        // Special handling for 'union' to avoid matching 'union ave' etc.
        // Match if it appears as a standalone word or part of 'union station'
        const wordBoundary = /\bunion\b/;
        if (wordBoundary.test(lowerText)) {
          return landmark;
        }
      } else if (lowerText.includes(trigger)) {
        return landmark;
      }
    }
  }

  return null;
}

/**
 * Returns a specific option by landmark id + option index (0-based).
 */
export function getLandmarkOption(landmarkId: string, optionIndex: number): LandmarkOption | null {
  const landmark = LANDMARKS[landmarkId];
  if (!landmark) {
    return null;
  }

  if (optionIndex < 0 || optionIndex >= landmark.options.length) {
    return null;
  }

  return landmark.options[optionIndex];
}

import { logFailure } from './errors.js';
export function isWeatherQuery(text) {
  return /(?:\b(weather|temperature|forecast|rain|climate|mausam|tapman|barish)\b|मौसम|तापमान|बारिश)/i.test(
    text || ''
  );
}

/**
 * Extracts location from a weather message or conversation history
 */
export function extractWeatherLocation(message, history) {
  const query = (message || '').trim();

  // Check if previous bot message was asking for city/zip code (English, Hinglish or Hindi Devanagari)
  const isFollowUpToLocationPrompt =
    Array.isArray(history) &&
    history.length > 0 &&
    (() => {
      const lastBotMessage = [...history].reverse().find((h) => h && h.sender === 'bot');
      return (
        lastBotMessage &&
        /(which city or zip\/pin code should i check|kaunsi city ya pin code ka mausam dekhna hai|कौन सी सिटी या पिन कोड)/i.test(
          lastBotMessage.text
        )
      );
    })();

  if (isFollowUpToLocationPrompt) {
    return query.replace(/[?.!]+$/, '').trim();
  }

  // Prepositional match: "weather in Noida", "temperature for 201310", "weather of Delhi", "mausam in Delhi", "मौसम दिल्ली में"
  const prepMatch = query.match(
    /\b(?:in|at|for|near|of|mein|me|ka|ki)\s+([a-zA-Z0-9\s,\-\p{sc=Devanagari}]+?)(?:\s+today|\s+now|\s+tomorrow|\s+ka|\s+ki|\s+mausam|\s+weather|\?|\.|$)/iu
  );
  if (prepMatch && prepMatch[1]) {
    const loc = prepMatch[1].trim();
    if (!/^(today|now|tomorrow|tonight|this week|current|aaj|abhi|kaisa|kya hai)$/i.test(loc)) {
      return loc;
    }
  }

  // Reverse Hindi / Hinglish match: "Delhi ka mausam", "Noida mein weather", "Mumbai ka tapman", "दिल्ली का मौसम"
  const hindiLocMatch = query.match(
    /^([a-zA-Z0-9\s,\-\p{sc=Devanagari}]+?)\s+(?:ka|ki|me|mein|ke|का|की|में|के)\s+(?:mausam|weather|temperature|tapman|मौसम|तापमान|बारिश)/iu
  );
  if (hindiLocMatch && hindiLocMatch[1]) {
    const loc = hindiLocMatch[1].trim();
    if (!/^(aaj|kal|today|current|tell me|batao|kya hai|kaisa hai|आज|कल|बताओ)/i.test(loc)) {
      return loc;
    }
  }

  // ZIP / PIN code match: e.g. 201310, 110001, 90210
  const pinMatch = query.match(/\b\d{5,6}\b/);
  if (pinMatch) {
    return pinMatch[0];
  }

  // City followed by weather: "Noida weather", "Delhi weather"
  const cityMatch = query.match(/^([a-zA-Z\s]+?)\s+(?:weather|mausam)/i);
  if (cityMatch && cityMatch[1]) {
    const loc = cityMatch[1].trim();
    if (!/^(today|current|tell me|what is the|how is the|aaj|kaisa)/i.test(loc)) {
      return loc;
    }
  }

  return null;
}

/**
 * Fetches verified real-time weather from wttr.in
 */
export async function fetchLiveWeather(location) {
  try {
    const cleanLoc = encodeURIComponent(
      location.trim().replace(/^(in|at|for|near|of)\s+/i, '')
    );
    const res = await fetch(`https://wttr.in/${cleanLoc}?format=j1`, {
      headers: { 'User-Agent': 'curl/7.88.1' },
      signal: AbortSignal.timeout(6000),
    });
    if (!res.ok) return null;
    const data = await res.json();
    const current = data.current_condition?.[0];
    const nearest = data.nearest_area?.[0];
    if (!current) return null;

    const areaName = nearest?.areaName?.[0]?.value || location;
    const region = nearest?.region?.[0]?.value || '';
    const country = nearest?.country?.[0]?.value || '';
    const condition = current.weatherDesc?.[0]?.value || 'Clear';
    const tempC = current.temp_C;
    const tempF = current.temp_F;
    const feelsLikeC = current.FeelsLikeC;
    const humidity = current.humidity;
    const windSpeedKmph = current.windspeedKmph;

    const locationName = [areaName, region, country].filter(Boolean).join(', ');

    return {
      queryLocation: location,
      resolvedLocation: locationName || location,
      condition,
      tempC,
      tempF,
      feelsLikeC,
      humidity,
      windSpeedKmph,
      source: 'Live Weather Observation',
    };
  } catch (err) {
    logFailure('weather', err);
    return null;
  }
}

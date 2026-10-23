/**
 * Checks if the user's message matches any local predefined answers.
 * Returns the canned answer string if matched, or null if it should be delegated to Gemini.
 *
 * @param {string} userInput - The text sent by the user
 * @returns {string|null} - The local bot reply, or null if unrecognized
 */
export function getLocalBotResponse(userInput, timeZone) {
  const query = userInput.trim().toLowerCase();

  // 1. Bot identity check (English, Hinglish & Hindi Devanagari)
  if (
    query === 'what is your name' ||
    query === "what's your name" ||
    query === 'who are you' ||
    /^(what('?s| is) your name|who are you|tumhara naam kya hai|aapka naam kya hai|naam kya hai|kya naam hai|तुम्हारा नाम क्या है|आप कौन हैं|तुम कौन हो)\??$/i.test(query)
  ) {
    if (/[\u0900-\u097F]/.test(query)) {
      return 'मैं आपका React चैटबॉट हूँ।';
    }
    return /tumhara|aapka|naam/i.test(query)
      ? 'Main aapka React chatbot hoon.'
      : "I'm your React chatbot.";
  }

  // 2. Creator and Owner check (English, Hinglish & Hindi Devanagari)
  if (
    /^(who\s+(builds|built|made|created)\s+you|who\s+is\s+your\s+(creator|builder|developer))\??$/i.test(query) ||
    /^(who\s+owns\s+you|who\s+is\s+your\s+owner)\??$/i.test(query) ||
    /^(tumhe|aapko)\s+kisne\s+banaya(\s+hai)?\??$/i.test(query) ||
    /^(tumhara|aapka)\s+(creator|malik|owner)\s+kaun\s+hai\??$/i.test(query) ||
    /^(owner|creator)\s+kaun\s+hai\??$/i.test(query) ||
    /^(तुम्हें|आपको)\s+(किसने\s+बनाया|कौन\s+बनाया)(\s+है)?\??$/i.test(query) ||
    /^(तुम्हारा|आपका)\s+(मालिक|निर्माता)\s+कौन\s+है\??$/i.test(query)
  ) {
    return 'Mr. Aman Mishra';
  }

  // 3. Bot condition / status check (English, Hinglish & Hindi Devanagari)
  if (
    query === 'how are you' ||
    query === 'how are you doing' ||
    /^how are you( doing)?\??$/i.test(query) ||
    /^(kaise ho|kya haal hai|aap kaise ho|sab kaisa hai|kya haal chaal|कैसे हो|क्या हाल है|आप कैसे हैं)\??$/i.test(query)
  ) {
    if (/[\u0900-\u097F]/.test(query)) {
      return 'मैं बढ़िया हूँ! मैं आपकी क्या मदद कर सकता हूँ?';
    }
    return /kaise|haal/i.test(query)
      ? 'Main badhiya hoon! Main aapki kya madad kar sakta hoon?'
      : "I'm doing great! How can I help you?";
  }

  // 4. Dynamic date intent check (e.g. "date", "today's date", "aaj ki date", "आज की तारीख")
  // Anchored regexes prevent false matches on unrelated queries mentioning dates
  const isDateIntent =
    /^(please\s+)?(can\s+you\s+)?(tell\s+me\s+|get\s+me\s+|give\s+me\s+|show\s+me\s+)?(what('?s|\s+is)\s+)?(the\s+|today'?s\s+|current\s+)?date([?.! ]*)$/i.test(query) ||
    /^(today'?s\s+date|current\s+date|date|aaj ki date|aaj ki tareekh|आज की तारीख|आज क्या तारीख है)([?.! ]*)$/i.test(query);

  // Location-qualified requests (e.g. "what time is it in Tokyo", "date in London")
  // must delegate to Gemini instead of returning the browser's local timezone.
  const hasLocationModifier = /\bin\s+[a-z]/i.test(query);

  if (!hasLocationModifier && isDateIntent) {
    const today = new Date();
    const formattedDate = today.toLocaleDateString('en-US', {
      ...(timeZone ? { timeZone } : {}),
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      year: 'numeric',
    });
    if (/[\u0900-\u097F]/.test(query)) {
      return `आज की तारीख ${formattedDate} है।`;
    }
    return /aaj/i.test(query) ? `Aaj ${formattedDate} hai.` : `Today is ${formattedDate}.`;
  }

  // 5. Dynamic time intent check (e.g. "time", "what time is it?", "kya time hua hai", "समय क्या हुआ है")
  const isTimeIntent =
    !hasLocationModifier &&
    (/^(please\s+)?(can\s+you\s+)?(tell\s+me\s+|get\s+me\s+|give\s+me\s+|show\s+me\s+)?(what('?s|\s+is)\s+)?(the\s+|current\s+)?time([?.! ]*)$/i.test(query) ||
      /^(please\s+)?(what\s+time\s+is\s+it|what'?s\s+the\s+time)([?.! ]*)$/i.test(query) ||
      /^(current\s+time|time|kya time hua hai|kitna time hua hai|kitne baje hai|समय क्या हुआ है|कितने बजे हैं)([?.! ]*)$/i.test(query));

  if (isTimeIntent) {
    const now = new Date();
    const formattedTime = now.toLocaleTimeString('en-US', {
      ...(timeZone ? { timeZone } : {}),
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
    });
    if (/[\u0900-\u097F]/.test(query)) {
      return `अभी ${formattedTime} बजे हैं।`;
    }
    return /kya time|kitna|kitne/i.test(query)
      ? `Abhi ${formattedTime} baje hain.`
      : `The current time is ${formattedTime}.`;
  }

  // 6. Greetings (English, Hinglish & Hindi Devanagari)
  const isGreetingOnly =
    /^(hello|hi|hey|namaste|namaskar|pranam|kya haal|नमस्ते|नमस्कार|प्रणाम)(\s+(there|chatbot|bot|friend|ji|bhai))?[!?.]*$/i.test(query);

  if (isGreetingOnly) {
    if (/[\u0900-\u097F]/.test(query)) {
      return 'नमस्ते! मैं आपकी क्या मदद कर सकता हूँ?';
    }
    return /namaste|namaskar|pranam/i.test(query)
      ? 'Namaste! Main aapki kya madad kar sakta hoon?'
      : 'Hello! How can I help you?';
  }

  // 7. Weather inquiry without location: prompt user for city or ZIP/PIN code
  const isWeatherQuery =
    /(?:\b(weather|temperature|forecast|mausam|tapman|barish)\b|मौसम|तापमान|बारिश)/i.test(query);
  const hasWeatherLocation =
    /\b(in|at|for|near|of|mein|me|ka)\s+([a-zA-Z0-9\p{sc=Devanagari}]+)/iu.test(query) ||
    /([a-zA-Z0-9\p{sc=Devanagari}]+)\s+(?:का|की|में|के)\s+(?:मौसम|तापमान|बारिश)/iu.test(query) ||
    /\b\d{5,6}\b/.test(query);

  if (isWeatherQuery && !hasWeatherLocation) {
    if (/\p{sc=Devanagari}/u.test(query)) {
      return 'ज़रूर! कौन सी सिटी या पिन कोड का मौसम देखना है?';
    }
    return /mausam|tapman/i.test(query)
      ? 'Zaroor! Kaunsi city ya PIN code ka mausam dekhna hai?'
      : 'Sure! Which city or ZIP/PIN code should I check the weather for?';
  }

  // Unrecognized locally -> delegate to Gemini
  return null;
}

/**
 * Fallback response helper
 */
export function getBotResponse(userInput) {
  const local = getLocalBotResponse(userInput);
  return local || "Sorry, I don't understand that yet.";
}

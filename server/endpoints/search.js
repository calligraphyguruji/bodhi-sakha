import { logFailure } from '../../lib/server/errors.js';

/**
 * Live Web Search Orchestrator
 * Performs real-time external searches with query sanitization,
 * snippet extraction, and fallback mechanisms.
 */

/**
 * Strips HTML tags and decodes common entities
 */
function cleanSnippetText(rawHtml) {
  if (!rawHtml) return '';
  return rawHtml
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Searches the web using DuckDuckGo HTML endpoint with strict timeout and fallback
 * @param {string} query - The search query
 * @param {number} [maxResults=4] - Max number of snippets to extract
 * @returns {Promise<{ results: Array<{ title: string, snippet: string, url: string }>, contextText: string }>}
 */
export async function searchWeb(query, maxResults = 4) {
  const cleanQuery = (query || '').trim();
  if (!cleanQuery) {
    return { results: [], contextText: '' };
  }

  const results = [];

  try {
    const encoded = encodeURIComponent(cleanQuery);
    const res = await fetch(`https://html.duckduckgo.com/html/?q=${encoded}`, {
      headers: {
        'User-Agent':
          'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36',
        Accept: 'text/html,application/xhtml+xml',
      },
      signal: AbortSignal.timeout(5000),
    });

    if (res.ok) {
      const html = await res.text();
      // Match DuckDuckGo search result blocks
      const blockRegex =
        /<h2 class="result__title">[\s\S]*?<a[^>]*href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;

      let match;
      while ((match = blockRegex.exec(html)) !== null && results.length < maxResults) {
        let url = match[1]?.trim() || '';
        // Decode DDG redirect URL if present
        if (url.includes('duckduckgo.com/l/?uddg=')) {
          const rawUrl = url.split('uddg=')[1]?.split('&')[0];
          if (rawUrl) url = decodeURIComponent(rawUrl);
        }

        const title = cleanSnippetText(match[2]);
        const snippet = cleanSnippetText(match[3]);

        if (snippet && !results.some((r) => r.snippet === snippet)) {
          results.push({ title, snippet, url });
        }
      }

      // Secondary regex fallback if blockRegex missed
      if (results.length === 0) {
        const snippetOnlyRegex = /<a class="result__snippet"[^>]*>([\s\S]*?)<\/a>/g;
        while ((match = snippetOnlyRegex.exec(html)) !== null && results.length < maxResults) {
          const snippet = cleanSnippetText(match[1]);
          if (snippet && !results.some((r) => r.snippet === snippet)) {
            results.push({ title: 'Web Search Result', snippet, url: '' });
          }
        }
      }
    }
  } catch (err) {
    logFailure('search', err);
  }

  let contextText = '';
  if (results.length > 0) {
    contextText = results
      .map(
        (r, idx) =>
          `[Web Source ${idx + 1}${r.url ? ` (${r.url})` : ''}]: ${r.title ? `**${r.title}** - ` : ''}${r.snippet}`
      )
      .join('\n\n');
  }

  return {
    results,
    contextText,
  };
}

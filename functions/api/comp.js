// Cloudflare Pages Function: POST /api/comp
// Calls Anthropic Claude API server-side using Worker secret ANTHROPIC_API_KEY.
// Rate limits per-IP and globally via KV namespace RATE_LIMITS.

const SYSTEM_PROMPT = [
  "You are a literary scout for indie authors using Amazon KDP. Given a book description, suggest 5 published comp titles that share specific concrete elements - subgenre, tropes, tone, pacing, setting, target reader.",
  "",
  "Strict rules:",
  "- Only suggest books published 2015 or later (older books dilute Amazon algorithm signal)",
  "- Prefer mid-list and recent breakouts (5K-500K Goodreads ratings); avoid mega-bestsellers (1M+ ratings) unless directly subgenre-relevant",
  "- Never invent a book - if you are not confident a title and author are real, omit it. Five strong is better than seven shaky.",
  "- Each \"why\" must name 2+ specific overlapping elements (tropes, setting, tone, structure) - never generic phrases like \"fans of\" or \"perfect for\"",
  "",
  "Format your response as markdown:",
  "",
  "## 5 comp titles",
  "1. **Title** by Author (Year) - Why: [2+ specific overlaps]",
  "2. **Title** by Author (Year) - Why: [2+ specific overlaps]",
  "3. **Title** by Author (Year) - Why: [2+ specific overlaps]",
  "4. **Title** by Author (Year) - Why: [2+ specific overlaps]",
  "5. **Title** by Author (Year) - Why: [2+ specific overlaps]",
  "",
  "IMPORTANT: do NOT put blank lines between the numbered items - they must be on consecutive lines.",
  "",
  "## Use these in",
  "- Amazon book description: \"for readers who loved X and Y\"",
  "- Amazon Ads: paste author names into the Authors targeting field",
  "- Query letters and back-cover copy",
  "",
  "Always verify titles on Amazon before publishing - AI can get details wrong."
].join("\n");

const MIN_DESC_LEN = 30;
const MAX_DESC_LEN = 2000;
const MAX_GENRE_LEN = 60;
const PER_IP_DAILY_LIMIT = 5;
const GLOBAL_DAILY_LIMIT = 2000;
const DEFAULT_MODEL = "claude-sonnet-4-5";

export async function onRequestPost({ request, env }) {
  // Parse JSON
  let body;
  try {
    body = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid request format." }, 400);
  }

  const description = String(body.description || "").trim();
  const genre = String(body.genre || "").trim().slice(0, MAX_GENRE_LEN);

  if (description.length < MIN_DESC_LEN) {
    return jsonResponse({ error: "Please paste at least a paragraph (30+ characters) describing your book." }, 400);
  }
  if (description.length > MAX_DESC_LEN) {
    return jsonResponse({ error: "Description too long (max " + MAX_DESC_LEN + " characters)." }, 400);
  }

  // Configuration check
  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "Service is being configured. Try again in a few minutes." }, 503);
  }
  if (!env.RATE_LIMITS) {
    return jsonResponse({ error: "Service is being configured (rate limiter not bound). Try again shortly." }, 503);
  }

  // Rate limiting
  const ip = request.headers.get("CF-Connecting-IP") || "unknown";
  const today = new Date().toISOString().slice(0, 10);
  const ipKey = "rate:" + today + ":" + ip;
  const globalKey = "global:" + today;

  const ipCountStr = await env.RATE_LIMITS.get(ipKey);
  const ipCount = parseInt(ipCountStr || "0", 10);
  if (ipCount >= PER_IP_DAILY_LIMIT) {
    return jsonResponse({
      error: "Daily free limit reached (" + PER_IP_DAILY_LIMIT + " searches per visitor). Come back tomorrow.",
      remaining: 0
    }, 429);
  }

  const globalCountStr = await env.RATE_LIMITS.get(globalKey);
  const globalCount = parseInt(globalCountStr || "0", 10);
  if (globalCount >= GLOBAL_DAILY_LIMIT) {
    return jsonResponse({ error: "Service temporarily unavailable (daily capacity reached). Try again tomorrow." }, 503);
  }

  // Build user message
  const userMsg = "Book description:\n" + description + (genre ? "\n\nGenre: " + genre : "");

  // Call Anthropic
  let anthropicRes;
  try {
    anthropicRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || DEFAULT_MODEL,
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMsg }]
      })
    });
  } catch (e) {
    return jsonResponse({ error: "Could not reach AI service. Try again." }, 502);
  }

  if (!anthropicRes.ok) {
    let detail = "";
    try {
      const errBody = await anthropicRes.json();
      detail = (errBody.error && errBody.error.message) || "";
    } catch {}
    return jsonResponse({
      error: "AI service returned an error. Please try again." + (detail ? " (" + detail.substring(0, 120) + ")" : "")
    }, 502);
  }

  const anthropicData = await anthropicRes.json();
  const text = (anthropicData.content && anthropicData.content[0] && anthropicData.content[0].text) || "";

  if (!text) {
    return jsonResponse({ error: "AI returned an empty response. Try a more detailed synopsis." }, 502);
  }

  // Increment counters AFTER successful response (so failed requests don't count)
  const newIpCount = ipCount + 1;
  const newGlobalCount = globalCount + 1;
  // 2-day TTL for safe day rollovers
  await env.RATE_LIMITS.put(ipKey, String(newIpCount), { expirationTtl: 172800 });
  await env.RATE_LIMITS.put(globalKey, String(newGlobalCount), { expirationTtl: 172800 });

  return jsonResponse({
    text: text,
    remaining: Math.max(0, PER_IP_DAILY_LIMIT - newIpCount)
  });
}

// Cloudflare Pages routes POST -> onRequestPost; everything else hits onRequest.
export async function onRequest() {
  return jsonResponse({ error: "Method not allowed. Use POST." }, 405);
}

function jsonResponse(data, status) {
  return new Response(JSON.stringify(data), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "no-store"
    }
  });
}
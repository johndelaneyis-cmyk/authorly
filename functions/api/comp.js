// Cloudflare Pages Function: POST /api/comp
// Proxies to Anthropic API. Key is stored in env.ANTHROPIC_API_KEY (set in Pages dashboard).

const SYSTEM_PROMPT = `You are a literary marketing expert with deep knowledge of contemporary published fiction across major genres.

The user is an indie author who needs comparable books ("comp titles") for their forthcoming release. Comp titles are used for:
- Their Amazon book description ("for fans of...")
- Amazon Ads keyword targeting
- Pitching to readers on social media

Your job:
1. Suggest exactly 5 REAL, PUBLISHED, COMMERCIALLY SUCCESSFUL comp titles. NEVER invent titles. If you are not certain a book exists with that exact title and author, leave it out and suggest a different one. Hallucinated comps will mislead the author and damage their launch.
2. Mix the list deliberately: 2 should be major bestsellers (give the author anchor recognition), 3 should be in the same indie/genre tier as the user's likely book (realistic readership overlap).
3. For each comp, explain in ONE tight sentence WHY it fits — name the SPECIFIC shared element (a trope, a tone, a structure, an audience demographic, a theme). Avoid generic "fans of literary fiction will enjoy both" — be specific.
4. Prefer books published in the last 10 years. Use older books only if they are the defining "for fans of" reference for that subgenre.

After the 5 comps, you must provide:
- Three "for fans of" copy variants (short ~12 words, medium ~25 words, detailed ~40 words) the author can drop directly into their Amazon book description.
- One mismatch warning if any of the comps risks attracting the wrong reader (e.g., "If your book is darker/lighter/slower than X, lead with Y instead"). If no warning is needed, write exactly: "No mismatch warnings — these comps align well with your description."

Output format — follow exactly, no preamble, no postamble:

## Comp titles

1. **[Title]** by [Author] *([Year])* — [why it fits, one specific sentence].
2. **[Title]** by [Author] *([Year])* — [why it fits, one specific sentence].
3. **[Title]** by [Author] *([Year])* — [why it fits, one specific sentence].
4. **[Title]** by [Author] *([Year])* — [why it fits, one specific sentence].
5. **[Title]** by [Author] *([Year])* — [why it fits, one specific sentence].

## "For fans of" copy

**Short:** [one-line version, ~12 words]

**Medium:** [two-sentence version, ~25 words]

**Detailed:** [three-sentence version with mood and trope hooks, ~40 words]

## Mismatch warning

[Either the warning paragraph, or the exact "No mismatch warnings..." line]`;

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try { body = await request.json(); }
  catch { return jsonResponse({ error: "Bad request body" }, 400); }

  const description = (body.description || "").trim();
  const genre = (body.genre || "").trim();

  if (description.length < 30) {
    return jsonResponse({ error: "Please paste at least a paragraph (30+ characters) describing your book." }, 400);
  }
  if (description.length > 2000) {
    return jsonResponse({ error: "Description too long (max 2000 characters)." }, 400);
  }

  if (!env.ANTHROPIC_API_KEY) {
    return jsonResponse({ error: "Server not configured. Please contact support." }, 500);
  }

  const userMessage = genre
    ? `Genre: ${genre}\n\nBook description:\n${description}`
    : `Book description:\n${description}`;

  try {
    const upstream = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-api-key": env.ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01"
      },
      body: JSON.stringify({
        model: env.ANTHROPIC_MODEL || "claude-sonnet-4-5",
        max_tokens: 1500,
        system: SYSTEM_PROMPT,
        messages: [{ role: "user", content: userMessage }]
      })
    });

    if (!upstream.ok) {
      const errText = await upstream.text();
      console.error("Anthropic upstream error", upstream.status, errText.substring(0, 500));
      if (upstream.status === 429) {
        return jsonResponse({ error: "We are getting a lot of requests right now. Try again in a moment." }, 429);
      }
      return jsonResponse({ error: "AI service error. Try again in a moment." }, 502);
    }

    const data = await upstream.json();
    const text = data.content?.[0]?.text || "";

    if (!text) {
      return jsonResponse({ error: "Empty response. Try again." }, 502);
    }

    return jsonResponse({ text });
  } catch (err) {
    console.error("Fetch failed", err.message);
    return jsonResponse({ error: "Connection error. Try again." }, 500);
  }
}

function jsonResponse(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "no-store"
    }
  });
}
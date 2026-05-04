# Authorly

Free tools for indie authors. Find real comp titles, write better blurbs, research KDP keywords.

Live at https://authorly.tools

## Stack

- Static frontend (HTML/CSS/JS), single page
- Cloudflare Pages hosting + Pages Functions for `/api/*`
- Anthropic Claude (Sonnet 4.5) for AI generation

## Project structure

```
authorly/
├── index.html               # landing page + comp finder UI
├── functions/
│   └── api/
│       └── comp.js          # POST /api/comp -> Anthropic proxy
├── _headers                 # security headers
├── .gitignore
└── README.md
```

## Setup (Cloudflare Pages)

1. Connect this repo to Cloudflare Pages (no build command, output directory `/`)
2. In project Settings -> Environment variables, add:
   - `ANTHROPIC_API_KEY` (production + preview)
   - `ANTHROPIC_MODEL` = `claude-sonnet-4-5` (optional, default fallback already in code)
3. Settings -> Custom domains -> add `authorly.tools` and `www.authorly.tools`

## Local dev

Open `index.html` directly in a browser to test the static UI. The `/api/comp` endpoint requires Cloudflare Pages or `wrangler pages dev .` to work.
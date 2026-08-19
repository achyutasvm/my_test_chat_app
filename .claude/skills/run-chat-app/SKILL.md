---
name: run-chat-app
description: >-
  Launch and verify the my_test_chat_app Next.js dev server, then confirm
  it's actually serving the app (not some unrelated process squatting on the
  port). Use when asked to run, start, test, or preview this chat app, or to
  confirm a code change works in the browser.
---

# Run chat-app

This is a Next.js 16 app (`npm run dev`) with one API route,
`app/api/chat/route.ts`, that calls the Gemini API. `GOOGLE_GENAI_API_KEY`
must be set in `.env.local` (see `.env.local.example`) or the API route
returns a 500.

## 1. Check for an existing, healthy server first

Don't assume port 3000 is free or that anything listening there is this app —
this machine runs other Node projects that also default to 3000/3001.

```bash
for p in 3000 3001 3002 3003 3004; do
  echo "--- $p ---"
  lsof -i :$p -sTCP:LISTEN 2>/dev/null
done
```

For any port with a listener, confirm it's actually *this* app before reusing
it — check the process's cwd matches this repo, and that hitting it returns
Next.js output, not something else's JSON 404:

```bash
lsof -p <PID> 2>/dev/null | grep cwd
curl -s -i http://localhost:<port>/ | head -5
```

If a port already has a healthy instance of this app running, use that URL
and skip straight to step 3.

## 2. Start the dev server on a free port

Pick the first port from the 3000-3004 scan above with no listener at all.
Launch explicitly on it (don't rely on Next's own port-bumping — it exits
with an error if 3000 is taken rather than always falling back cleanly):

```bash
npm run dev -- -p <free_port>
```

Run this in the background. Wait ~2-3s, then confirm it's actually up:

```bash
curl -s -o /dev/null -w "HTTP %{http_code}\n" http://localhost:<free_port>/
```

## 3. Drive it, don't just launch it

A page load alone doesn't prove the Gemini integration works. Smoke-test the
chat endpoint:

```bash
curl -s -X POST http://localhost:<free_port>/api/chat \
  -H "Content-Type: application/json" \
  -d '{"messages":[{"role":"user","content":"Reply with just: pong"}]}'
```

Expect `{"text":"pong"}` (or similar). A `{"error":"API key not configured"}`
means `.env.local` is missing or wasn't loaded (server needs restarting after
creating/editing it). A `{"error":"Failed to generate response"}` — check the
dev log for the real cause (invalid/deprecated model ID, quota exhausted,
bad key, etc.):

```bash
cat .next/dev/logs/next-development.log | tail -20
```

## 4. Report the URL

Tell the user the working `http://localhost:<port>` — don't assume they
already know it's not 3000, since that's the port documented in SETUP.md.

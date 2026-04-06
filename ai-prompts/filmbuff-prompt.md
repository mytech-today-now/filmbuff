# filmbuff generate-shot-list (Step 9) — Video Controls Implementation Spec

## Purpose

This document specifies the app-level changes required in the `filmbuff`
pipeline's **step 9 — `generate-shot-list`** command. It defines:

1. **What `filmbuff generate-shot-list` must output** — a `Video Controls`
   metadata block appended to every shot entry in the shot list.
2. **How those controls map** to the five standardized fields used by
   `ai-powered` to call a video-generation provider (Luma AI, etc.) via
   `POST /video` or `POST /batch`.
3. **Which earlier pipeline steps** supply the data that `generate-shot-list`
   reads to derive accurate per-shot values (especially `duration`).

Reference spec: `ai-prompts/common-vid-cntrl.md`

---

## Pipeline Position

`generate-shot-list` is **step 9** in the filmbuff multi-step pipeline. It
consumes artifacts produced by every earlier step and emits the shot list
(Markdown) that downstream `ai-powered` calls consume.

```
Step 1  – logline            →  logline.txt
Step 2  – beat-sheet         →  beat-sheet.txt
Step 3  – treatment          →  treatment.txt
Step 4  – screenplay         →  <project>.fountain   ← primary --input
Step 5  – script-breakdown   →  script-breakdown.txt
Step 6  – (project-specific)
Step 7  – (project-specific)
Step 8  – shooting-script    →  shooting-script.txt
Step 9  – generate-shot-list →  shot-list.md         ◀ THIS STEP
```

---

## Input Documents for `filmbuff generate-shot-list` (Step 9)

`generate-shot-list` reads the following artifacts from earlier pipeline steps
to extract precise shot timing, framing, and character information:

| Document | Source pipeline step | CLI flag / filename pattern |
|----------|-----------------------|-----------------------------|
| Fountain screenplay | step 4 – screenplay | `--input <project>.fountain` |
| Shooting script | step 8 – shooting-script | `shooting-script.txt` |
| Scene list / beat sheet | step 2 – beat-sheet | `beat-sheet.txt` |
| Treatment | step 3 – treatment | `treatment.txt` |
| Character descriptions | step 5 – script-breakdown | `script-breakdown.txt` |
| Logline | step 1 – logline | `logline.txt` |

Providing all available documents ensures `generate-shot-list` can derive
accurate per-shot `duration` values from scripted timing cues and scene
metadata.

---

## Video Control Schema (per shot)

Each shot in the generated shot list **MUST** include a `Video Controls` block
rendered as a Markdown table immediately after `Technical Details`:

```markdown
**Video Controls:**

| Control       | Value   | Notes                                      |
|---------------|---------|--------------------------------------------|
| Aspect Ratio  | Default |                                            |
| Resolution    | Default |                                            |
| Quality       | Default |                                            |
| Duration (s)  | <N>     | Derived from shot duration in script       |
| FPS           | Default |                                            |
```

### Field Rules

| Field | Type | Default | Override rule |
|-------|------|---------|---------------|
| `aspectRatio` | `string` | `"Default"` (provider decides) | Override to `"16:9"`, `"9:16"`, `"1:1"`, `"4:3"`, `"3:4"`, or `"21:9"` when the script explicitly describes the framing (e.g., portrait social-media shot → `"9:16"`; widescreen cinematic → `"16:9"`). |
| `resolution` | `string` | `"Default"` (provider decides) | Override to `"720p"`, `"1080p"`, or `"4k"` when the production brief specifies a delivery format. |
| `quality` | `"draft"` \| `"standard"` \| `"high"` | `"Default"` (maps to provider standard) | Override to `"high"` for hero/title shots; `"draft"` for rapid iteration or animatics. |
| `duration` | `number` (seconds, positive float) | **Required — derive from script** | Read from the shot's `Duration` field (e.g., `0:12` → `12`). If no scripted duration exists, estimate from action density (≈ 5 s for a simple cut, ≈ 10 s for complex action). |
| `fps` | `number` (positive integer) | `"Default"` (provider decides) | Override to `24`, `30`, or `60` when the production brief specifies a frame rate (e.g., `24` fps for film look). |

> **"Default"** means the value is omitted from the `ai-powered` API call; the
> video provider uses its own default. Only non-Default values are forwarded in
> the `POST /video` or `POST /batch` request body.

---

## Example — Shot with Video Controls Block

```markdown
### Shot 1

**Scene:**

| Property        | Value          |
|-----------------|----------------|
| Duration        | 0:12           |
| Shot Type       | establishing   |
| Camera Movement | pan            |
| Framing         | wide           |
| Visual Style    | Reality        |

**Set:**
EXT. COMMERCIAL WAREHOUSE - STORMY NIGHT

**Description:**
A drone glides low over an expansive flat industrial roof. Storm water pools
in wide black sheets. A membrane seam has split — a dark wound running six
feet across the surface.

**Technical Details:**
Shot Type: establishing. Camera Movement: pan. Framing: wide. Visual Style: Reality

**Video Controls:**

| Control       | Value   | Notes                                      |
|---------------|---------|--------------------------------------------|
| Aspect Ratio  | Default |                                            |
| Resolution    | Default |                                            |
| Quality       | Default |                                            |
| Duration (s)  | 12      | Derived from shot duration 0:12            |
| FPS           | Default |                                            |
```

---

## Provider, Model & API Key Selection

`filmbuff` owns the provider/model picker. It defines the available choices in
its own config, presents them to the user, and forwards the selection to
`ai-powered` at execution time. **API keys are never stored in the shot list
and are never sent from the browser** — they live exclusively in the proxy
server's environment variables.

### Supported Providers

| Provider ID | Display name | Video? | API key env var |
|-------------|--------------|--------|-----------------|
| `lumaai` | Luma AI (Ray-2) | ✅ yes | `LUMAAI_API_KEY` |
| `openai` | OpenAI | ❌ no | `OPENAI_API_KEY` |
| `anthropic` | Anthropic (Claude) | ❌ no | `ANTHROPIC_API_KEY` |
| `xai` | xAI / Grok | ❌ no | `XAI_API_KEY` |
| `venice` | Venice.ai | ❌ no | `VENICE_API_KEY` |
| `mock` | Mock (testing) | ✅ yes | *(none required)* |

> For video shot generation `lumaai` is the only production provider.
> Use `mock` for local development and CI without an API key.

### filmbuff Provider Config (example shape)

Define available providers in a filmbuff-owned config file (e.g.
`filmbuff.config.json` **in the filmbuff repo** — not in `ai-powered`).
`ai-powered` never reads this file; filmbuff reads it and forwards the user's
selection at request time.

```json
{
  "videoProviders": [
    { "id": "lumaai", "label": "Luma AI",           "models": ["ray-2", "ray-2-turbo"] },
    { "id": "mock",   "label": "Mock (no API calls)", "models": [] }
  ],
  "defaultProvider": "lumaai",
  "defaultModel":    "ray-2"
}
```

The filmbuff UI renders `videoProviders` as a `<select>` dropdown. The user's
chosen `id` and `model` are forwarded to `ai-powered` in every request.

### API Key Routing Rules

| Integration mode | Where the key lives | How it reaches `ai-powered` |
|-----------------|--------------------|-----------------------------|
| HTTP Proxy (`POST /video`, `POST /batch`) | Server env var (e.g. `LUMAAI_API_KEY`) | Resolved automatically by the proxy — **never in the request body** |
| Node.js library (`getAiClient`) | filmbuff's own env vars or secrets store | Passed as `apiKey` in `getAiClient()` overrides |
| Browser web module | Server env var (same as proxy) | Browser **never** holds the key — proxy resolves it |

---

## Using Video Controls with `ai-powered`

Once the shot list is generated (with `Video Controls` tables populated), any of
the three integration modes below can execute the shots against a video-generation
provider. All three share the same five JSON fields; omit a field entirely when
its value is `Default`.

### 1 — HTTP Proxy / Serve Mode (recommended for the UI website)

The proxy keeps API keys server-side. filmbuff's UI passes `provider` and
`model` in every request body; the proxy resolves the matching key from its
own environment. **The API key is never in the request.**

```bash
# On the machine running the proxy, set the key for whichever provider
# the filmbuff user may select. ai-powered picks the right one automatically.
export LUMAAI_API_KEY="luma-..."       # for Luma AI video generation
# export OPENAI_API_KEY="sk-..."       # if also supporting OpenAI modalities

# Start the proxy (filmbuff's server, not the user's browser)
ai-powered serve --port 3001

# Verify
curl http://localhost:3001/health
# → { "status": "ok" }
```

#### Single shot — `POST /video`

`provider` and `model` come from filmbuff's user selection:

```bash
# filmbuff reads its own filmbuff.config.json, gets provider="lumaai", model="ray-2"
# and injects them into the request body alongside the shot controls.
curl -X POST http://localhost:3001/video \
  -H "Content-Type: application/json" \
  -d '{
    "prompt":      "Drone glides low over an industrial roof.",
    "provider":    "lumaai",
    "model":       "ray-2",
    "duration":    12,
    "aspectRatio": "16:9",
    "quality":     "high"
  }'
# → { "data": "data:video/mp4;base64,…", "mimeType": "video/mp4", … }
```

> ⚠️ Do **not** include `apiKey` in the request body. The proxy resolves the key
> from `LUMAAI_API_KEY` on the server. The browser (and filmbuff's UI) never
> see or transmit the key.

#### Full shot list — `POST /batch` (NDJSON streaming)

Set `provider` and `model` once at batch level (from filmbuff's user selection);
individual items inherit them and may override `model` per-shot if needed:

```bash
curl -X POST http://localhost:3001/batch \
  -H "Content-Type: application/json" \
  -d '{
    "provider": "lumaai",
    "model":    "ray-2",
    "items": [
      {
        "modality": "video",
        "name":     "shot-01",
        "prompt":   "Drone glides low over an industrial roof.",
        "duration": 12
      },
      {
        "modality":    "video",
        "name":        "shot-02",
        "prompt":      "Roofer examines the membrane seam split under harsh work lights.",
        "duration":    8,
        "model":       "ray-2-turbo",
        "aspectRatio": "16:9",
        "quality":     "high"
      }
    ]
  }'
# Response: NDJSON — one JSON line per item as each completes
# { "index": 0, "name": "shot-01", "status": "ok", "result": { … } }
# { "index": 1, "name": "shot-02", "status": "ok", "result": { … } }
```

---

### 2 — Node.js Library (backend / server scripts)

Use the `ai-powered` npm package directly in a Node.js backend or build script
(the third repo's server layer, a `filmbuff` post-processor, etc.).

`filmbuff` reads its own config to get `provider`, `model`, and `apiKey`, then
passes them as overrides to `getAiClient()`. These values take the highest
precedence — they override any `~/.ai-powered/config.json` or `AI_*` env vars.

```typescript
import { getAiClient } from "ai-powered";
import { loadFilmbuffConfig } from "./filmbuff-config.js"; // filmbuff's own loader

// filmbuff loads its own config — ai-powered never reads this file
const fbConfig = await loadFilmbuffConfig(); // { provider, model, apiKey, … }

// Pass filmbuff's selections as highest-priority overrides.
// apiKey can come from filmbuff's own secrets store (env var, vault, etc.)
const client = await getAiClient("filmbuff-shot-runner", {
  provider: fbConfig.provider,          // e.g. "lumaai"
  model:    fbConfig.model ?? undefined, // e.g. "ray-2" (omit to use provider default)
  apiKey:   fbConfig.apiKey,            // e.g. process.env.FILMBUFF_LUMAAI_KEY
});

// Single shot — video controls come from the shot list's Video Controls table
const result = await client.generateVideo(
  "Drone glides low over an industrial roof.",
  { duration: 12, aspectRatio: "16:9", quality: "high" }
);
console.log(result.data);      // data URI or URL
console.log(result.cost);      // { totalUsd, isEstimate }
console.log(result.latencyMs); // number

// Batch — iterate the shot list and call generateVideo per item
const shots = [
  { name: "shot-01", prompt: "Drone glides low…", duration: 12 },
  { name: "shot-02", prompt: "Roofer examines…",  duration: 8, quality: "high" },
];

for (const shot of shots) {
  const { name, prompt, ...videoOptions } = shot;
  const res = await client.generateVideo(prompt, videoOptions);
  console.log(`${name}: ${res.data?.slice(0, 60)}…`);
}
```

> **Mock mode** (no API key needed — for local development and CI):
> ```typescript
> const client = await getAiClient("filmbuff-dev", { provider: "mock" });
> ```
>
> **Key precedence reminder**: `getAiClient` overrides win over env vars and
> config files. filmbuff should pass `provider`, `model`, and `apiKey` together
> so ai-powered never has to guess which provider's key to use.

---

### 3 — Browser / Web Module (the UI website)

The `ai-powered/web` entry point ships a browser-safe ESM + UMD bundle
(`dist-web/`). **Video generation requires proxy mode** — the browser never
holds or transmits a provider API key.

The filmbuff UI presents provider and model dropdowns (populated from
`filmbuff.config.json`). The selected `provider` and `model` values are sent
in every request body alongside the video controls. The proxy resolves the
corresponding API key from its own environment.

#### ESM (Vite / bundler)

```typescript
import { createWebClient } from "ai-powered/web";

const client = createWebClient({
  mode:     "proxy",
  proxyUrl: "http://localhost:3001",   // ai-powered serve
});
```

#### Passing provider, model, and video controls (raw `fetch` to proxy)

`WebAiClient.generateVideo()` accepts only a prompt string. Use a direct
`fetch` to the proxy to forward provider selection and video controls from the
filmbuff UI. **Never include `apiKey` here** — the proxy resolves it
server-side.

```javascript
async function generateShot({ prompt, provider, model, duration,
                               aspectRatio, resolution, quality, fps }) {
  // provider and model come from the filmbuff UI dropdowns.
  // API key is NOT included — the proxy resolves it from its env vars.
  const body = { prompt, provider, model };

  // Only include non-Default video controls
  if (duration)    body.duration    = duration;
  if (aspectRatio) body.aspectRatio = aspectRatio;
  if (resolution)  body.resolution  = resolution;
  if (quality)     body.quality     = quality;
  if (fps)         body.fps         = fps;

  const res  = await fetch("http://localhost:3001/video", {
    method:  "POST",
    headers: { "Content-Type": "application/json" },
    body:    JSON.stringify(body),
  });
  return res.json(); // { data: "data:video/mp4;base64,…", mimeType, … }
}

// Example: values wired from filmbuff's UI form
generateShot({
  prompt:      shotDescription,
  provider:    providerSelect.value,  // "lumaai"
  model:       modelSelect.value,     // "ray-2"
  duration:    parseFloat(durationInput.value),
  aspectRatio: aspectRatioSelect.value || undefined,
  quality:     qualitySelect.value    || undefined,
});
```

#### UMD (plain HTML — no build step)

```html
<script src="dist-web/ai-powered.umd.js"></script>
<script>
  // For full control over provider/model/videoOptions, use fetch directly
  // (see raw fetch example above). createWebClient is useful for text/image.
  const { createWebClient } = window.AiPowered;
  const client = createWebClient({ mode: "proxy", proxyUrl: "http://localhost:3001" });
</script>
```

#### Architecture for the third-repo website

```
filmbuff.config.json
  └─ videoProviders [ { id, label, models } ]   ← owned by filmbuff repo
         │  (user selects provider + model)
         ▼
   filmbuff UI / CLI
         │  request body: { provider, model, ...videoControls }
         │  ← NO apiKey in transit
         ▼
  ai-powered serve :3001
  (LUMAAI_API_KEY in server env)
         │  resolves key, calls Luma AI / OpenAI / etc.
         ├─── Node.js backend (getAiClient)
         │      batch runner for shot lists
         └─── Browser UI (fetch → /video or /batch)
                video control form + provider dropdown
```

---

## Implementation Requirements for `filmbuff generate-shot-list` (Step 9)

The `filmbuff generate-shot-list` command MUST implement the following
behavior when producing a shot list. These requirements define the app-level
contract for step 9 of the filmbuff pipeline:

1. **Read all input documents** listed in the Input Documents table above.
   Extract scripted shot durations (e.g., `Duration | 0:12`) from the
   shooting script, beat sheet, or existing shot entries and convert to whole
   seconds.

2. **Append a `Video Controls` table** to every shot section, immediately
   after `Technical Details`. This block must never be omitted from any shot.

3. **Duration is always concrete**: derive it from the script; never emit
   `Default` for `Duration (s)`. Minimum value is `3`; maximum is `60`.

4. **Override non-Default controls** only when the script or production brief
   explicitly justifies it (see Field Rules above). When in doubt, emit
   `Default`.

5. **Preserve all existing shot fields** — `generate-shot-list` must not
   remove or reorder `Scene`, `Set`, `Description`, `Characters`, `Actions`,
   `Dialogue`, `Blocking`, `SFX`, or `Technical Details`.

6. **JSON batch output**: when the step 9 shot list is forwarded to
   `ai-powered`'s `POST /batch` endpoint, `generate-shot-list` MUST include
   `provider` and `model` (from the filmbuff user's selection) in the batch
   envelope and map each shot's Video Controls table to the following JSON
   fields:

   ```json
   {
     "provider": "lumaai",
     "model":    "ray-2",
     "items": [
       {
         "modality": "video",
         "name":     "shot-01",
         "prompt":   "<shot description>",
         "duration": 12
       }
     ]
   }
   ```

   - Set `provider` and `model` at the batch envelope level (from the
     filmbuff user's selection); individual items may override `model` only.
   - Omit `aspectRatio`, `resolution`, `quality`, and `fps` keys entirely
     when their value is `Default`.
   - Never include `apiKey` in the JSON — the proxy resolves it server-side.


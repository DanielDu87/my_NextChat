[OPEN] draw-401-error

# Debug Session: draw-401-error

## Symptom
- Clicking the draw submit button triggers `POST /api/stability/v2beta/stable-image/generate/gpt-image-2`
- The request returns `401 Unauthorized`

## Current Evidence
- Browser console shows the draw request is sent from `draw.ts`
- The request path uses the Stability API route while the model name is `gpt-image-2`
- Recent sync logs show draw/model settings were refreshed before the failure

## Hypotheses
1. The draw page routes `gpt-image-2` through the Stability request path by mistake.
2. The selected provider and selected model are inconsistent after sync/hydration.
3. The server-side Stability route reads an empty or invalid API key.
4. Synced draw model metadata classifies `gpt-image-2` as a Stability model incorrectly.

## Plan
1. Trace the frontend draw request path and provider/model mapping.
2. Trace the server route handling for `/api/stability/...`.
3. Add minimal instrumentation only after the request path ambiguity is identified.
4. Reproduce and verify with runtime evidence before any fix.

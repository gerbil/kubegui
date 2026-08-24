# AI Assist Router (Bifrost-style)

This package provides a provider-agnostic AI router for KubeGUI issue assistance.

## What it does

- Routes one request shape to multiple providers (`openrouter`, `groq`, `openai`, `ollama`)
- Reads runtime settings from KubeGUI DB (`settings` table)
- Supports UI tasks:
  - `explain_event`
  - `suggest_fix`
  - `generate_yaml`
  - `explain_logs`

## Settings keys

Persisted in `settings` table:

- `aiallow` (`true`/`false`)
- `aitype` (provider)
- `aimodel`
- `aiendpoint`
- `aitoken`

Default provider/model is free OpenRouter model:

- `openrouter`
- `meta-llama/llama-3.1-8b-instruct:free`

## HTTP endpoints

Defined in `services/ai_http.go` and mounted in `bin/desktop/main.go`.

- `GET /api/v1/ai/settings`
- `PATCH /api/v1/ai/settings`
- `POST /api/v1/ai/assist`

## Quick test

From `kubegui/` root:

```bash
go test ./services/ai
```


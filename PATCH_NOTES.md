# Patch notes — community fork

This fork of [Natively](https://github.com/Natively-AI-assistant/natively-cluely-ai-assistant)
adds three focused changes. It is maintained for personal, non-commercial use under the original
[Natively Personal Use Source License v1.0](LICENSE).

> This project is based on Natively, originally developed by Natively AI Private Limited.

---

## 1. Recognise current Anthropic model IDs in the model pickers

**Problem.** With a valid Claude API key, only *Sonnet 4.6* showed up — Opus and Sonnet 5 never
appeared, even though the key had access to them.

**Cause.** Two spots assumed Anthropic's **old** model-id scheme (`claude-4-opus`,
`claude-3-5-sonnet`), where a version digit follows `claude-`. Anthropic's current IDs are
**family-first** (`claude-opus-4-8`, `claude-sonnet-5`), so they were silently filtered out.

**Fix.**
- `electron/utils/modelFetcher.ts` — the "Fetch Models" filter now matches both the family-first
  (`claude-<family>-<major>[-<minor>]`) and the legacy version-first schemes.
- `src/utils/modelUtils.ts` — `STANDARD_CLOUD_MODELS.claude` lists the full current lineup
  (Sonnet 5/4.6/4.5, Opus 4.8/4.7/4.6/4.5/4.1, Haiku 4.5, Fable 5) so the top **Active Model**
  picker shows every model directly, not just the built-in default + one fetched "preferred".

Runtime was already safe for any `claude-*` id (`modelCapabilities.isCloudIdentifier`), so no other
change was needed.

## 2. Windows dev-launch fix (IPv4 / `wait-on`)

`npm start` could hang forever before the Electron window ever opened: Vite bound to IPv6 (`::1`)
while `wait-on` polled IPv4 (`127.0.0.1`). `package.json` now pins the dev server to
`--host 127.0.0.1` and points `wait-on` at the same address so the launch completes on
IPv6-first localhosts.

## 3. Partial Russian UI localisation with an EN/RU switch

A lightweight in-house i18n layer (no new dependency):

- `src/i18n.tsx` — `LanguageProvider` + `useT()`; `t('English text')` returns the Russian string
  when the language is `ru` (falling back to English for untranslated phrases). Choice persists in
  `localStorage` and syncs across windows via the `storage` event.
- An **EN/RU** switch in the Settings sidebar footer (instant, no restart).
- Translated key screens: the settings menu, General settings, AI Providers, Audio / Local Whisper,
  the launcher home and the search placeholder. Abbreviations (API, AI, STT, URL) are left as-is.

**Status:** partial by design — some description subtexts and a few buttons are still English.
Extending coverage is just adding entries to the `RU` dictionary in `src/i18n.tsx` and wrapping more
strings in `t(...)`.

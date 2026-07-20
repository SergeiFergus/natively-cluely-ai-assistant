# premium/ — open re-implementations (personal fork)

Upstream Natively keeps this directory as a **private git submodule**
(`natively-premium`) containing the closed-source paid modules. That submodule
is inaccessible without a licence, so on this fork every
`require('../premium/electron/...')` in the app threw and Profile Intelligence
(résumé/JD grounding, company research) was silently disabled.

The files here are **clean-room open re-implementations** written from scratch
against the public call-sites in `electron/ipcHandlers.ts` and
`electron/main.ts`. They contain **no proprietary code** and depend only on the
owner's own API keys (LLM + embeddings). They restore, on this personal
non-commercial fork:

- `knowledge/KnowledgeOrchestrator.ts` — résumé/JD ingestion → structured facts
  → semantic grounding of live "What to answer" responses.
- `knowledge/KnowledgeDatabaseManager.ts` — SQLite persistence (`oss_knowledge_*`).
- `knowledge/CompanyResearchEngine.ts` + `TavilySearchProvider.ts` — company
  dossiers (Tavily-grounded when a key is set, else LLM-only).
- `knowledge/types.ts`, `NegotiationConversationTracker.ts`,
  `NativelySearchProvider.ts` — supporting types/stubs the app requires.
- `services/LicenseManager.ts` — local personal-use licence stand-in.

The submodule registration (`.gitmodules`) and the `/premium` `.gitignore` line
were removed so this fork is self-contained and builds from a fresh clone.

Permitted under the Natively Personal Use Source License (local, non-commercial
modification). Not for redistribution as a product.

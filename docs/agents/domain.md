# Domain Docs

This repository uses a single-context domain layout.

## Before exploring

- Read root `CONTEXT.md`.
- Read relevant decisions under `docs/adr/`.
- If either is absent, proceed without creating placeholders.

## Vocabulary

Use canonical terms from `CONTEXT.md`. Avoid synonyms that the glossary explicitly rejects. If a required concept is missing, flag the domain gap instead of silently inventing terminology.

## ADR conflicts

Surface any conflict with an existing ADR explicitly rather than silently overriding it.

## Layout

```text
/
├── CONTEXT.md
├── docs/
│   └── adr/
└── src/
```

# Test domain, UI, filesystem, and WebMCP separately

Vitest will cover schemas and domain invariants; an in-memory filesystem adapter will make file integration deterministic; Playwright will cover human interface flows; and a direct harness will invoke registered WebMCP tools. At least one manual acceptance run must use a real selected folder and the deployed application.

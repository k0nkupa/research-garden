## Agent skills

### Implement workflow

When the user says `implement`, use the Matt Pocock `implement` skill at
`/Users/tony/.agents/skills/implement/SKILL.md`: execute the implementation
with a `worker` agent (Luna/High), review the completed diff with a
`code-reviewer` agent (Sol/High), then commit the completed work on the
current branch.

### Issue tracker

Issues and specs are tracked as Local Markdown under `.scratch/`. See `docs/agents/issue-tracker.md`.

### Triage labels

Use the default five-role triage vocabulary. See `docs/agents/triage-labels.md`.

### Domain docs

This repository uses a single-context domain layout. See `docs/agents/domain.md`.

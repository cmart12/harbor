# Release notes template

This is the canonical layout for `whim` GitHub Release notes. `generate-notes.js`
emits this structure (minus the human-written summary). Keep sections in this order
and omit any section that has no entries.

```markdown
## Summary

<!-- 1–2 sentences: what this release is about and why a user should care. -->

### Features
- Short, user-facing description of the change ([#NN](https://github.com/patniko/whim/pull/NN)) (abc1234)

### Fixes
- Short description of the fix ([#NN](https://github.com/patniko/whim/pull/NN)) (abc1234)

### Other
- Anything that isn't a feat/fix (chores, refactors, docs, build) (abc1234)

**Full changelog:** https://github.com/patniko/whim/compare/vPREV...vNEW
```

## Conventions

- **Summary** is written by a human (or the agent running the skill); never ship the
  placeholder comment.
- Entries are grouped by Conventional Commit type: `feat` → **Features**, `fix` →
  **Fixes**, everything else → **Other**.
- Each entry keeps the short commit hash for traceability and links the PR when the
  commit references one (`#NN`).
- Drop noise: version-bump commits (`vX.Y.Z`) and merge commits are excluded — their
  content is already represented by the underlying commits.
- Always end with the compare link so readers can see the full diff.

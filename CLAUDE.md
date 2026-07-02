# mst-cli — Claude context

See [AGENTS.md](./AGENTS.md) for full project context, architecture, storage layout, and rules.

## Claude-specific constraints

- **No Graph API** — do not suggest or use `@microsoft/microsoft-graph-client` or any Graph endpoint
- **Spec-first** — before implementing any feature, a spec must exist in `docs/superpowers/specs/`. Check the TODO list in README.md for what's next.

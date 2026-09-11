# Frontend features

Feature-oriented slices for the user-facing layer. Each feature owns its
routes, components, hooks, and styling, but **imports only from shared
infra (`src/infra/**`), shared domains (`src/domains/contracts/**`), or
peer features through an explicit public entry**.

Avoid a flat `src/components/`, `src/hooks/`, `src/utils/` mega-folder.

Initial features (planned for post-Foundation sprints, not implemented yet):

- `portfolio` - works and projects shown on the public site
- `content` - editorial content rendering (CMS-backed)
- `tools` - embedded Tools registry
- `projects` - long-form project write-ups
- `activity` - timeline / changelog
- `integrations` - external system status / sync

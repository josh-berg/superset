# Superset Monorepo Guide

Guidelines for agents and developers working in this repository.

## Structure

Bun + Turbo monorepo with:
- **Apps**:
  - `apps/desktop` - Electron desktop application
- **Packages**:
  - `packages/chat` - Chat UI components (slash command discovery via `.claude/commands`)
  - `packages/desktop-mcp` - Desktop MCP server
  - `packages/host-service` - Host service (process management layer)
  - `packages/local-db` - Local SQLite database (Drizzle ORM)
  - `packages/macos-process-metrics` - macOS native process metrics
  - `packages/panes` - Pane layout management
  - `packages/shared` - Shared utilities and constants
  - `packages/ui` - Shared UI components (shadcn/ui + TailwindCSS v4)
    - Add components: `bunx shadcn@latest add <component>` (run in `packages/ui/`)
  - `packages/workspace-client` - Workspace tRPC client and React hooks
  - `packages/workspace-fs` - Workspace filesystem operations
- **Tooling**:
  - `tooling/typescript` - Shared TypeScript configs

## Tech Stack

- **Package Manager**: Bun (no npm/yarn/pnpm)
- **Build System**: Turborepo
- **Framework**: Electron + electron-vite
- **Database**: Drizzle ORM + local SQLite (`packages/local-db`)
- **UI**: React + TailwindCSS v4 + shadcn/ui
- **IPC**: tRPC via `trpc-electron` (use `observable` pattern for subscriptions — async generators are not supported)
- **Code Quality**: Biome (formatting + linting at root)

## Common Commands

```bash
# Development
bun dev                    # Start all dev servers
bun test                   # Run tests
bun build                  # Build all packages

# Code Quality
bun run lint               # Check for lint issues (no changes)
bun run lint:fix           # Fix auto-fixable lint issues
bun run format             # Format code only
bun run format:check       # Check formatting only (CI)
bun run typecheck          # Type check all packages

# Maintenance
bun run clean              # Clean root node_modules
bun run clean:workspaces   # Clean all workspace node_modules
```

## Code Quality

**Biome runs at root level** (not per-package) for speed:
- `biome check --write --unsafe` = format + lint + organize imports + fix all auto-fixable issues
- `biome check` = check only (no changes)
- `biome format` = format only
- Use `bun run lint:fix` to fix all issues automatically

## Agent Rules
1. **Type safety** - avoid `any` unless necessary
2. **Prefer `gh` CLI** - when performing git operations (PRs, issues, checkout, etc.), prefer the GitHub CLI (`gh`) over raw `git` commands where possible
3. **Shared command source** - keep command definitions in `.agents/commands/` only. `.claude/commands` should be a symlink to `../.agents/commands`. (`packages/chat` discovers slash commands from `.claude/commands`.)
4. **Workspace MCP config** - keep shared MCP servers in `.mcp.json`.
5. **Mastra dependencies** - use the published upstream `mastracode` and `@mastra/*` packages. Do not add fork tarball overrides or custom patch steps unless explicitly requested.
6. **Package age security policy** - global `npm`, `bun`, `pnpm`, and `uv` configs enforce a 7-day minimum release age, and `npm` also has `ignore-scripts=true`. If package install/update/add commands fail because a version is too new or a lifecycle script is blocked, do not keep retrying, disable the policy, or suggest bypass flags. Choose an older version that satisfies the policy, or stop and surface the blocked dependency clearly.


---

## Project Structure

All projects in this repo should be structured like this:

```
app/
├── page.tsx
├── dashboard/
│   ├── page.tsx
│   ├── components/
│   │   └── MetricsChart/
│   │       ├── MetricsChart.tsx
│   │       ├── MetricsChart.test.tsx      # Tests co-located
│   │       ├── index.ts
│   │       └── constants.ts
│   ├── hooks/                             # Hooks used only in dashboard
│   │   └── useMetrics/
│   │       ├── useMetrics.ts
│   │       ├── useMetrics.test.ts
│   │       └── index.ts
│   ├── utils/                             # Utils used only in dashboard
│   │   └── formatData/
│   │       ├── formatData.ts
│   │       ├── formatData.test.ts
│   │       └── index.ts
│   ├── stores/                            # Stores used only in dashboard
│   │   └── dashboardStore/
│   │       ├── dashboardStore.ts
│   │       └── index.ts
│   └── providers/                         # Providers for dashboard context
│       └── DashboardProvider/
│           ├── DashboardProvider.tsx
│           └── index.ts
└── components/
    ├── Sidebar/
    │   ├── Sidebar.tsx
    │   ├── Sidebar.test.tsx               # Tests co-located
    │   ├── index.ts
    │   ├── components/                    # Used 2+ times IN Sidebar
    │   │   └── SidebarButton/             # Shared by SidebarNav + SidebarFooter
    │   │       ├── SidebarButton.tsx
    │   │       ├── SidebarButton.test.tsx
    │   │       └── index.ts
    │   ├── SidebarNav/
    │   │   ├── SidebarNav.tsx
    │   │   └── index.ts
    │   └── SidebarFooter/
    │       ├── SidebarFooter.tsx
    │       └── index.ts
    └── HeroSection/
        ├── HeroSection.tsx
        ├── HeroSection.test.tsx           # Tests co-located
        ├── index.ts
        └── components/                    # Used ONLY by HeroSection
            └── HeroCanvas/
                ├── HeroCanvas.tsx
                ├── HeroCanvas.test.tsx
                ├── HeroCanvas.stories.tsx
                ├── index.ts
                └── config.ts

components/                                # Used in 2+ pages (last resort)
└── Header/
```

1. **One folder per component**: `ComponentName/ComponentName.tsx` + `index.ts` for barrel export
2. **Co-locate by usage**: If used once, nest under parent's `components/`. If used 2+ times, promote to **highest shared parent's** `components/` (or `components/` as last resort)
3. **One component per file**: No multi-component files
4. **Co-locate dependencies**: Utils, hooks, constants, config, tests, stories live next to the file using them

### Exception: shadcn/ui Components

The `src/components/ui/` and `src/components/ai-elements` directories contain shadcn/ui components. These use **kebab-case single files** (e.g., `button.tsx`, `base-node.tsx`) instead of the folder structure above. This is intentional—shadcn CLI expects this format for updates via `bunx shadcn@latest add`.

## Database Rules

- Schema in `packages/local-db/src/schema/`
- Use Drizzle ORM for all database operations
- Generate migrations: `bun run --cwd packages/local-db generate`
- **NEVER manually edit generated migration files** — only modify schema files and regenerate

# Noesis v1.0.0

Noesis is a local-first learning studio for building prerequisite-based
curricula, studying AI-generated lessons, practicing with adaptive assessments,
and reviewing with spaced repetition. Workspace data, documents, and their
full-text search index are stored locally in SQLite with FTS5.

## Features

- **Dual-mode prerequisite DAG:** Auto-Layout organizes concepts into
  prerequisite layers; Free Place lets you arrange nodes and author concepts
  and dependency edges on an open canvas.
- **Workspace tools:** Enable built-in tools in **Settings → Plugins**. The
  first tool is Excalidraw, with locally saved boards scoped to a workspace or
  an individual concept. Open a concept's existing board or create an editable
  board from its lesson diagram, with workspace-area fullscreen that retains
  app navigation and app-matched dark mode.
- **Local Document Vault:** Import PDF, Markdown, and TXT notes, index them
  locally with SQLite FTS5, and search them with debounced filtering.
- **AI lessons and worked examples:** Generate structured lessons with KaTeX
  math and Mermaid diagrams, then append scenario-driven examples using
  diagrams, math, code, trace tables, or analogies.
- **Multi-modal assessments:** Practice with multiple-choice, open-ended, and
  coding questions, with configurable difficulty and mastery progression.
- **SM-2 Review Queue:** Schedule flashcard reviews to reinforce long-term
  recall.
- **Recoverable Archive:** Move whole workspaces out of Recent or archive
  individual concepts within a workspace; restore them later or permanently
  delete them from their archive.
- **Gemini and local AI:** Use Google Gemini or an OpenAI-compatible local
  server such as Ollama, LM Studio, or Foundry Local.
- **Themes and reading controls:** Choose Dark or Light palettes, fonts, and
  lesson depth.

## Technology

React 19, TypeScript, Vite, Tailwind CSS, Tauri 2, Rust, SQLite/FTS5, KaTeX,
Mermaid, and CodeMirror.

## Prerequisites

- Node.js 22.6 or later and npm.
- Rust stable and the platform build tools required by Tauri 2. On Windows,
  this includes the Microsoft C++ Build Tools and WebView2 runtime.
- An AI provider configured in Noesis Settings. Local OpenAI-compatible
  servers can be used without an API key; start the server locally and select
  its base URL and model in Settings.

Windows Smart App Control may warn when launching an unsigned local Tauri
build. Only run builds you created from source you trust; follow your
organization's or Windows' security guidance rather than disabling protection
to bypass a warning.

## Quick start

```powershell
npm install
npm run tauri dev
```

In the app, open **Settings → AI & Speed** to configure Gemini or a local
OpenAI-compatible endpoint. Local model discovery can populate the model
selector from the configured server.

## GitHub Releases and Auto-Updates

Pushing a `v*.*.*` tag that matches the version in `src-tauri/tauri.conf.json`
builds Windows x64 and ARM64 MSI/NSIS installers and publishes a signed
`latest.json` updater manifest. Configure the repository secret
`TAURI_SIGNING_PRIVATE_KEY` with the private key matching the updater public
key in the Tauri config; optionally set `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`.
Keep the private key out of the repository. Tauri updater signatures validate
updates but are not Authenticode publisher signatures, so Windows may still
show Smart App Control or unknown-publisher warnings.
The release workflow uses the generated `.sig` sidecars to create the updater
manifest, then publishes only the installers and `latest.json`; signatures
remain embedded in the manifest rather than appearing as separate downloads.

## Verification

```powershell
npx tsc --noEmit
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

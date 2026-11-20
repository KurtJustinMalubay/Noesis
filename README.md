# Noesis

Noesis is a local-first learning studio for building prerequisite-based learning
paths, reading generated lessons, reviewing with spaced repetition, and taking
AI-generated mastery assessments.

## Development

Requirements: Node.js, npm, and the Rust toolchain required by Tauri v2.

```powershell
npm install
npm run tauri dev
```

Run the frontend checks and production build with:

```powershell
npm test
npm run build
cargo check --manifest-path src-tauri/Cargo.toml
```

AI providers and local model context limits are configured in the app's Settings.
The local context window should match the limit configured in the selected model
runtime.

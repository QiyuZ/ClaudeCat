#!/usr/bin/env node
/*
 * ClaudeCat activity hook.
 *
 * Claude Code runs this on two events so the widget knows *exactly* when a task is in
 * progress (rather than guessing from transcript timestamps):
 *
 *   UserPromptSubmit -> `cc-pet-activity.js busy`   (a turn just started)
 *   Stop             -> `cc-pet-activity.js idle`   (the turn finished)
 *
 * It writes a tiny flag to ~/.claude/cc-pet-busy.json that the Rust core reads. The cat
 * types from "busy" until "idle", covering long generations and multi-minute tool runs.
 *
 * IMPORTANT: this must stay silent on stdout — a UserPromptSubmit hook's stdout is injected
 * into the prompt context, so anything printed here would leak into the conversation. It
 * also must never fail the turn, so everything is wrapped and it always exits 0.
 */
try {
  const fs = require("fs");
  const os = require("os");
  const path = require("path");
  const active = process.argv[2] === "busy";
  const dir = path.join(os.homedir(), ".claude");
  const file = path.join(dir, "cc-pet-busy.json");
  fs.mkdirSync(dir, { recursive: true });
  const tmp = file + ".tmp";
  fs.writeFileSync(tmp, JSON.stringify({ active, ts: Date.now() }));
  fs.renameSync(tmp, file);
} catch {
  /* never block or disrupt Claude Code */
}
process.exit(0);

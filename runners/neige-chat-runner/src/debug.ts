/**
 * File-based diagnostic log gated by `NEIGE_RUNNER_LOG=1`.
 *
 * Daemon spawns the runner with stderr piped through `tracing::warn`
 * (target: `chat_child_stderr`), but neige-server in turn spawns the
 * daemon with `Stdio::null()` for both stdout and stderr — every
 * `process.stderr.write` from this process ends up in /dev/null.
 *
 * To get any visibility we have to write to disk ourselves. Single
 * synchronous append to `/tmp/neige-chat-runner.log`, no rotation, no
 * structured fields — diagnostic only. Disabled by default.
 */
import fs from 'node:fs';

const LOG_PATH = process.env.NEIGE_RUNNER_LOG_PATH ?? '/tmp/neige-chat-runner.log';
const ENABLED = process.env.NEIGE_RUNNER_LOG === '1';

let fd: number | null = null;
function open(): number | null {
  if (!ENABLED) return null;
  if (fd !== null) return fd;
  try {
    fd = fs.openSync(LOG_PATH, 'a');
  } catch {
    fd = -1;
  }
  return fd;
}

export function debug(msg: string): void {
  const handle = open();
  if (handle === null || handle <= 0) return;
  const ts = new Date().toISOString();
  try {
    fs.writeSync(handle, `${ts} pid=${process.pid} ${msg}\n`);
  } catch {
    // best-effort; never throw from diagnostics
  }
}

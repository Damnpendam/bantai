import path from "node:path";

/**
 * Where the database (and, in development, the generated app secret) live.
 * Overridable so a worktree, a test, or a hosted volume mount can point
 * somewhere other than the working copy.
 */
export function dataDir(): string {
  return process.env.BANTAI_DATA_DIR
    ? path.resolve(process.env.BANTAI_DATA_DIR)
    : path.join(process.cwd(), "data");
}

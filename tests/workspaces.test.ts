import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { WorkspaceStore } from "../src/workspaces.js";

const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => fs.rm(directory, { recursive: true, force: true })));
});

describe("workspace store", () => {
  it("persists a local workspace mapping and reports when the folder disappears", async () => {
    const directory = await fs.mkdtemp(path.join(os.tmpdir(), "workspace-test-"));
    directories.push(directory);
    const folder = path.join(directory, "作業セット");
    await fs.mkdir(folder);
    const file = path.join(directory, "workspaces.json");
    const store = new WorkspaceStore(file);
    await store.initialize();

    // The native folder picker is intentionally not called in tests. Seed the
    // local-only file to verify loading and unlink behavior.
    await fs.writeFile(file, JSON.stringify({ workspaces: [{
      workspace_id: "workspace-1",
      memo_id: "memo-1",
      label: "作業セット",
      folder_path: folder,
      last_verified_at: "2026-08-05T00:00:00.000Z"
    }] }), "utf8");
    const loaded = new WorkspaceStore(file);
    await loaded.initialize();
    expect(await loaded.get("memo-1")).toMatchObject({ label: "作業セット", exists: true });

    await fs.rm(folder, { recursive: true, force: true });
    expect(await loaded.get("memo-1")).toMatchObject({ exists: false });
    expect(await loaded.unlink("memo-1")).toBe(true);
    expect(await loaded.get("memo-1")).toBeNull();
  });
});

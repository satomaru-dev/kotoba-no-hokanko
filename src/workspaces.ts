import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

export interface WorkspaceRecord {
  workspace_id: string;
  memo_id: string;
  label: string;
  folder_path: string;
  last_verified_at: string;
}

export interface WorkspaceSummary {
  workspace_id: string;
  memo_id: string;
  label: string;
  exists: boolean;
  last_verified_at: string;
}

interface StoredWorkspaceData { workspaces: WorkspaceRecord[]; }

export type WorkspaceOperationStatus =
  | "success" | "cancelled" | "helper_unavailable" | "picker_error"
  | "timeout" | "folder_not_found";

export interface WorkspaceOperationResult<T> {
  status: WorkspaceOperationStatus;
  value: T | null;
}

const powershell = "powershell.exe";
const helperScript = path.resolve(process.cwd(), "scripts", "workspace-helper.ps1");

const runHelper = (operation: "health" | "choose-folder" | "choose-files"): Promise<WorkspaceOperationResult<unknown>> => new Promise((resolve) => {
  if (process.platform !== "win32") {
    resolve({ status: "helper_unavailable", value: null });
    return;
  }
  const child = spawn(powershell, ["-NoProfile", "-STA", "-ExecutionPolicy", "Bypass", "-File", helperScript, "-Operation", operation], {
    windowsHide: false,
    stdio: ["ignore", "pipe", "pipe"]
  });
  let stdout = "";
  child.stdout.setEncoding("utf8");
  child.stdout.on("data", (chunk: string) => { stdout += chunk; });
  const timer = setTimeout(() => {
    child.kill();
    resolve({ status: "timeout", value: null });
  }, 60_000);
  child.once("error", () => {
    clearTimeout(timer);
    resolve({ status: "helper_unavailable", value: null });
  });
  child.once("close", (code) => {
    clearTimeout(timer);
    try {
      const parsed = JSON.parse(stdout.trim()) as { status?: WorkspaceOperationStatus; data?: unknown };
      resolve({
        status: parsed.status ?? (code === 0 ? "picker_error" : "helper_unavailable"),
        value: parsed.data ?? null
      });
    } catch {
      resolve({ status: code === 0 ? "picker_error" : "helper_unavailable", value: null });
    }
  });
});

const chooseFolder = async (): Promise<WorkspaceOperationResult<string>> => {
  const result = await runHelper("choose-folder");
  const data = result.value as { path?: string } | null;
  return { status: result.status, value: data?.path ?? null };
};

const chooseFiles = async (): Promise<WorkspaceOperationResult<string[]>> => {
  const result = await runHelper("choose-files");
  const data = result.value as { paths?: string[] } | null;
  return { status: result.status, value: data?.paths ?? null };
};

const safeFolderName = (label: string): string => {
  const cleaned = label.replace(/[<>:"/\\|?*\x00-\x1f]/g, " ").trim().replace(/[. ]+$/g, "");
  return (cleaned || "作業セット").slice(0, 80);
};

const normalizedUserPath = (value: string): string | null => {
  const normalized = path.normalize(value.trim());
  if (!path.isAbsolute(normalized) || normalized.split(path.sep).includes("..")) return null;
  return normalized;
};

const uniqueDestination = async (directory: string, fileName: string): Promise<string> => {
  const extension = path.extname(fileName);
  const base = path.basename(fileName, extension);
  let candidate = path.join(directory, fileName);
  for (let index = 1; ; index += 1) {
    try { await fs.access(candidate); candidate = path.join(directory, `${base} (${index})${extension}`); }
    catch { return candidate; }
  }
};

export class WorkspaceStore {
  private workspaces = new Map<string, WorkspaceRecord>();
  constructor(private readonly filePath: string) {}

  async initialize(): Promise<void> {
    try {
      const parsed = JSON.parse(await fs.readFile(this.filePath, "utf8")) as StoredWorkspaceData | WorkspaceRecord[];
      const records = Array.isArray(parsed) ? parsed : (parsed.workspaces ?? []);
      this.workspaces = new Map(records.map((record) => [record.memo_id, record]));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    }
  }

  private async persist(): Promise<void> {
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const temporary = `${this.filePath}.tmp`;
    await fs.writeFile(temporary, JSON.stringify({ workspaces: [...this.workspaces.values()] }, null, 2), "utf8");
    await fs.rename(temporary, this.filePath);
  }

  private async summary(record: WorkspaceRecord): Promise<WorkspaceSummary> {
    let exists = false;
    try { exists = (await fs.stat(record.folder_path)).isDirectory(); } catch { exists = false; }
    return { workspace_id: record.workspace_id, memo_id: record.memo_id, label: record.label, exists, last_verified_at: record.last_verified_at };
  }

  async get(memoId: string): Promise<WorkspaceSummary | null> {
    const record = this.workspaces.get(memoId);
    return record ? this.summary(record) : null;
  }

  async helperHealth(): Promise<WorkspaceOperationStatus> {
    return (await runHelper("health")).status;
  }

  private async savePath(memoId: string, folder: string, label: string): Promise<WorkspaceSummary> {
    const now = new Date().toISOString();
    const current = this.workspaces.get(memoId);
    const record: WorkspaceRecord = {
      workspace_id: current?.workspace_id ?? randomUUID(), memo_id: memoId, label, folder_path: folder, last_verified_at: now
    };
    this.workspaces.set(memoId, record);
    await this.persist();
    return this.summary(record);
  }

  async createOrChoose(memoId: string, mode: "choose" | "create", label?: string): Promise<WorkspaceOperationResult<WorkspaceSummary>> {
    const selected = await chooseFolder();
    if (selected.status !== "success" || !selected.value) return { status: selected.status, value: null };
    let folder = selected.value;
    let workspaceLabel = label?.trim() || path.basename(folder) || "作業セット";
    if (mode === "create") {
      workspaceLabel = safeFolderName(workspaceLabel);
      folder = path.join(folder, workspaceLabel);
      for (let index = 1; ; index += 1) {
        try { await fs.access(folder); folder = path.join(path.dirname(folder), `${workspaceLabel} (${index})`); }
        catch { break; }
      }
      await fs.mkdir(folder, { recursive: true });
    }
    return { status: "success", value: await this.savePath(memoId, folder, workspaceLabel) };
  }

  async createFromPath(memoId: string, mode: "choose" | "create", inputPath: string, label?: string): Promise<WorkspaceOperationResult<WorkspaceSummary>> {
    const selected = normalizedUserPath(inputPath);
    if (!selected) return { status: "picker_error", value: null };
    let folder = selected;
    let workspaceLabel = label?.trim() || path.basename(folder) || "作業セット";
    if (mode === "create") {
      workspaceLabel = safeFolderName(workspaceLabel);
      folder = path.join(selected, workspaceLabel);
      await fs.mkdir(folder, { recursive: true });
    }
    try {
      if (!(await fs.stat(folder)).isDirectory()) return { status: "folder_not_found", value: null };
    } catch { return { status: "folder_not_found", value: null }; }
    return { status: "success", value: await this.savePath(memoId, folder, workspaceLabel) };
  }

  async addFiles(memoId: string): Promise<WorkspaceOperationResult<{ copied: string[]; skipped: string[] }>> {
    const record = this.workspaces.get(memoId);
    if (!record) return { status: "folder_not_found", value: null };
    try { if (!(await fs.stat(record.folder_path)).isDirectory()) return { status: "folder_not_found", value: null }; }
    catch { return { status: "folder_not_found", value: null }; }
    const selected = await chooseFiles();
    if (selected.status !== "success" || !selected.value) return { status: selected.status, value: null };
    const copied: string[] = [], skipped: string[] = [];
    for (const source of selected.value) {
      try { const destination = await uniqueDestination(record.folder_path, path.basename(source)); await fs.copyFile(source, destination); copied.push(path.basename(destination)); }
      catch { skipped.push(path.basename(source)); }
    }
    record.last_verified_at = new Date().toISOString();
    await this.persist();
    return { status: "success", value: { copied, skipped } };
  }

  async open(memoId: string): Promise<WorkspaceOperationResult<WorkspaceSummary>> {
    const record = this.workspaces.get(memoId);
    if (!record) return { status: "folder_not_found", value: null };
    try { if (!(await fs.stat(record.folder_path)).isDirectory()) return { status: "folder_not_found", value: await this.summary(record) }; }
    catch { return { status: "folder_not_found", value: await this.summary(record) }; }
    if (process.platform !== "win32") return { status: "helper_unavailable", value: null };
    const child = spawn("explorer.exe", [record.folder_path], { detached: true, stdio: "ignore", windowsHide: false });
    child.unref();
    record.last_verified_at = new Date().toISOString();
    await this.persist();
    return { status: "success", value: await this.summary(record) };
  }

  async unlink(memoId: string): Promise<boolean> {
    const deleted = this.workspaces.delete(memoId);
    if (deleted) await this.persist();
    return deleted;
  }
}

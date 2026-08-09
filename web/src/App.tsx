import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  addDoLater,
  addIdeaThreadEntry,
  cancelReminder,
  captureMemo,
  cloudMode,
  configureDoLater,
  createIdeaThread,
  createReminder,
  createOrChooseWorkspace,
  createWorkspaceFromPath,
  addWorkspaceFiles,
  getWorkspace,
  getIdeaThread,
  getPushPublicKey,
  getSearchInsights,
  listDueReminders,
  listDoLater,
  listMemos,
  markReminderOpened,
  openWorkspace,
  restoreMemo,
  recordSearch,
  saveFeedback,
  savePushSubscription,
  searchMemories,
  supabase,
  trashMemo,
  unlinkWorkspace,
  updateDoLater,
  updateMemo
} from "./api";
import {
  listQueuedCaptures,
  listQueuedReminders,
  queueCapture,
  queueReminder,
  queuedCount,
  removeQueuedCapture,
  removeQueuedReminder
} from "./offline";
import type {
  CaptureInput,
  DoLaterAction,
  DoLaterItem,
  FeedbackVerdict,
  IdeaThread,
  Memo,
  RelatedMemory,
  Reminder,
  ReminderInput,
  SearchInsights,
  WorkspaceOperationStatus,
  WorkspaceSummary
} from "./types";

type Tab = "write" | "do-later" | "search" | "recent";
type InstallPrompt = Event & { prompt: () => Promise<void> };

const DIALOGUE_BETA = import.meta.env.VITE_DIALOGUE_BETA === "true";
const REMINDER_BETA = import.meta.env.VITE_REMINDER_BETA === "true";
const START_ASSIST_BETA = import.meta.env.VITE_START_ASSIST_BETA !== "false";
const SEARCH_INSIGHTS_KEY = "kotoba-search-insights-v1";

const emptySearchInsights = (): SearchInsights => ({ recent: [], frequent: [] });
const readCachedSearchInsights = (): SearchInsights => {
  try {
    const value = localStorage.getItem(SEARCH_INSIGHTS_KEY);
    return value ? JSON.parse(value) as SearchInsights : emptySearchInsights();
  } catch {
    return emptySearchInsights();
  }
};
const cacheSearchInsights = (value: SearchInsights): void => {
  try { localStorage.setItem(SEARCH_INSIGHTS_KEY, JSON.stringify(value)); } catch { /* supplementary cache */ }
};
const addCachedSearch = (query: string): SearchInsights => {
  const text = query.normalize("NFKC").replace(/\s+/gu, " ").trim().toLocaleLowerCase("ja-JP");
  if (!text) return readCachedSearchInsights();
  const current = readCachedSearchInsights();
  const terms = new Map([...current.recent, ...current.frequent].map((term) => [term.text, term]));
  const previous = terms.get(text);
  terms.set(text, { text, count: (previous?.count ?? 0) + 1, last_used_at: new Date().toISOString() });
  const values = [...terms.values()];
  const next = {
    recent: [...values].sort((left, right) => right.last_used_at.localeCompare(left.last_used_at)).slice(0, 8),
    frequent: [...values].sort((left, right) => right.count - left.count || right.last_used_at.localeCompare(left.last_used_at)).slice(0, 8)
  };
  cacheSearchInsights(next);
  return next;
};

const formatDate = (value: string | null): string => {
  if (!value) return "日付不明";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(new Date(value));
};

const formatDateTime = (value: string): string =>
  new Intl.DateTimeFormat("ja-JP", {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit"
  }).format(new Date(value));

const formatRelativeDate = (value: string | null): string => {
  if (!value) return "日付不明";
  const date = new Date(value);
  const now = new Date();
  const sameDay = (left: Date, right: Date) => left.getFullYear() === right.getFullYear()
    && left.getMonth() === right.getMonth()
    && left.getDate() === right.getDate();
  if (sameDay(date, now)) return `きょう ${new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(date)}`;
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  if (sameDay(date, yesterday)) return `きのう ${new Intl.DateTimeFormat("ja-JP", { hour: "2-digit", minute: "2-digit" }).format(date)}`;
  return new Intl.DateTimeFormat("ja-JP", { month: "numeric", day: "numeric" }).format(date);
};

type NavIconKind = "write" | "later" | "search" | "recent" | "trash";

const NavIcon = ({ kind }: { kind: NavIconKind }) => (
  <svg className="nav-svg" viewBox="0 0 24 24" aria-hidden="true" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    {kind === "write" && <><path d="M4 20h4L19.5 8.5a2.12 2.12 0 0 0-3-3L5 17v3z" /><path d="M14.5 6.5l3 3" /></>}
    {kind === "later" && <><circle cx="12" cy="12" r="8.5" /><path d="M12 7.5V12l3 1.8" /></>}
    {kind === "search" && <><circle cx="10.5" cy="10.5" r="6.5" /><path d="m15.5 15.5 5 5" /></>}
    {kind === "recent" && <><circle cx="4.5" cy="6.5" r="1.3" fill="currentColor" stroke="none" /><path d="M9 6.5h11" /><circle cx="4.5" cy="12" r="1.3" fill="currentColor" stroke="none" /><path d="M9 12h11" /><circle cx="4.5" cy="17.5" r="1.3" fill="currentColor" stroke="none" /><path d="M9 17.5h11" /></>}
    {kind === "trash" && <><path d="M4 7h16" /><path d="M9 7V4h6v3" /><path d="M6 7l1 13h10l1-13" /><path d="M10 11v5M14 11v5" /></>}
  </svg>
);
const base64UrlToBytes = (value: string): Uint8Array => {
  const padding = "=".repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(base64), (character) => character.charCodeAt(0));
};

const ensurePushSubscription = async (): Promise<boolean> => {
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
    return false;
  }
  if (Notification.permission === "denied") return false;
  const permission = Notification.permission === "granted"
    ? "granted"
    : await Notification.requestPermission();
  if (permission !== "granted") return false;
  const registration = await navigator.serviceWorker.ready;
  let subscription = await registration.pushManager.getSubscription();
  if (!subscription) {
    const publicKey = await getPushPublicKey();
    subscription = await registration.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: base64UrlToBytes(publicKey) as BufferSource
    });
  }
  await savePushSubscription(subscription.toJSON());
  return true;
};

const RelatedCards = ({
  memories,
  queryMemoId,
  allowLink,
  onOpen,
  onFeedback,
  onLink
}: {
  memories: RelatedMemory[];
  queryMemoId?: string;
  allowLink?: boolean;
  onOpen: (memory: RelatedMemory) => void;
  onFeedback: (memory: RelatedMemory, verdict: FeedbackVerdict) => void;
  onLink: (memory: RelatedMemory) => void;
}) => {
  if (memories.length === 0) return null;
  return (
    <section className="related-section" aria-live="polite">
      <p className="eyebrow">過去の言葉との再会</p>
      <h2>{memories.length}件、近い順に並べました</h2>
      <div className="related-list">
        {memories.map((memory) => (
          <article className="memory-card" key={memory.memory_id}>
            <button className="memory-card-main" onClick={() => onOpen(memory)}>
              <span className="memory-meta">
                <time>{formatDate(memory.date)}</time>
                <span className="relation">{memory.relation}</span>
              </span>
              <strong>{memory.title}</strong>
              <span className="memory-excerpt">{memory.excerpt}</span>
              {memory.has_dialogue && (
                <span className="dialogue-count">過去との対話 {memory.dialogue_count}件</span>
              )}
              <span className="open-label">記録をひらく →</span>
            </button>
            {queryMemoId && (
              <div className="memory-feedback">
                <span>近かった？</span>
                <button onClick={() => onFeedback(memory, "relevant")}>近い</button>
                <button onClick={() => onFeedback(memory, "irrelevant")}>違う</button>
              </div>
            )}
            {DIALOGUE_BETA && allowLink && queryMemoId && (
              <button className="thread-link-button" onClick={() => onLink(memory)}>
                この言葉を、続きとしてつなぐ <span>β</span>
              </button>
            )}
          </article>
        ))}
      </div>
    </section>
  );
};

const AuthScreen = ({ onReady }: { onReady: (session: Session) => void }) => {
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError("");
    const redirect = new URL(window.location.href);
    redirect.hash = "";
    redirect.search = "";
    const { error: authError } = await supabase!.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: redirect.toString() }
    });
    if (authError) setError(authError.message);
    else setSent(true);
  };
  useEffect(() => {
    const { data } = supabase!.auth.onAuthStateChange((_event, session) => {
      if (session) onReady(session);
    });
    return () => data.subscription.unsubscribe();
  }, [onReady]);
  return (
    <main className="auth-shell">
      <img className="brand-mascot" src="./icons/icon-192.png" alt="" aria-hidden="true" />
      <p className="eyebrow">ことばの保管庫</p>
      <h1>自分の言葉に、<br />帰ってこられる場所。</h1>
      {sent ? (
        <div className="auth-message">
          <strong>メールを送りました</strong>
          <p>届いたリンクを開くと、この端末で使い始められます。</p>
        </div>
      ) : (
        <form className="auth-form" onSubmit={submit}>
          <label htmlFor="email">本人確認用のメールアドレス</label>
          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="name@example.com"
            required
          />
          <button className="primary-button" type="submit">ログイン用リンクを受け取る</button>
          {error && <p className="error-text">{error}</p>}
        </form>
      )}
    </main>
  );
};

export const App = () => {
  const [session, setSession] = useState<Session | null | undefined>(cloudMode ? undefined : null);
  const [tab, setTab] = useState<Tab>("write");
  const [text, setText] = useState("");
  const [saving, setSaving] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved" | "queued">("idle");
  const [related, setRelated] = useState<RelatedMemory[]>([]);
  const [lastSavedMemo, setLastSavedMemo] = useState<Memo | null>(null);
  const [lastSavedMarked, setLastSavedMarked] = useState(false);
  const [showReminder, setShowReminder] = useState(false);
  const [pendingCount, setPendingCount] = useState(0);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<RelatedMemory[]>([]);
  const [searchInsights, setSearchInsights] = useState<SearchInsights>({ recent: [], frequent: [] });
  const [memos, setMemos] = useState<Memo[]>([]);
  const [trash, setTrash] = useState<Memo[]>([]);
  const [doLaterActive, setDoLaterActive] = useState<DoLaterItem[]>([]);
  const [doLaterResolved, setDoLaterResolved] = useState<DoLaterItem[]>([]);
  const [showDoLaterHistory, setShowDoLaterHistory] = useState(false);
  const [setupItem, setSetupItem] = useState<DoLaterItem | null>(null);
  const [workspaceItem, setWorkspaceItem] = useState<DoLaterItem | null>(null);
  const [workspaces, setWorkspaces] = useState<Record<string, WorkspaceSummary | null>>({});
  const [focusItem, setFocusItem] = useState<DoLaterItem | null>(null);
  const [showTrash, setShowTrash] = useState(false);
  const [selected, setSelected] = useState<Memo | null>(null);
  const [selectedMemory, setSelectedMemory] = useState<RelatedMemory | null>(null);
  const [ideaThread, setIdeaThread] = useState<IdeaThread | null>(null);
  const [dueReminders, setDueReminders] = useState<Reminder[]>([]);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [notice, setNotice] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);
  const saveMessage = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const focusId = window.setTimeout(() => {
      if (tab === "write") textarea.current?.focus({ preventScroll: true });
    }, 120);
    return () => window.clearTimeout(focusId);
  }, [tab]);

  useEffect(() => {
    if (!notice) return;
    const timeoutId = window.setTimeout(() => setNotice(""), 2800);
    return () => window.clearTimeout(timeoutId);
  }, [notice]);

  useEffect(() => {
    setNotice("");
  }, [tab]);

  useEffect(() => {
    if (!cloudMode) return;
    void supabase!.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase!.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  const refreshPending = useCallback(async () => {
    setPendingCount(await queuedCount());
  }, []);

  const syncPending = useCallback(async () => {
    if (!navigator.onLine || (cloudMode && !session)) return;
    for (const item of await listQueuedCaptures()) {
      try {
        await captureMemo(item);
        await removeQueuedCapture(item.client_id);
      } catch {
        break;
      }
    }
    for (const item of await listQueuedReminders()) {
      try {
        await createReminder(item);
        await removeQueuedReminder(item.client_id);
      } catch {
        break;
      }
    }
    await refreshPending();
  }, [refreshPending, session]);

  useEffect(() => {
    void refreshPending();
    void syncPending();
    window.addEventListener("online", syncPending);
    const handler = (event: Event) => {
      event.preventDefault();
      setInstallPrompt(event as InstallPrompt);
    };
    window.addEventListener("beforeinstallprompt", handler);
    return () => {
      window.removeEventListener("online", syncPending);
      window.removeEventListener("beforeinstallprompt", handler);
    };
  }, [refreshPending, syncPending]);

  const refreshMemos = useCallback(async () => {
    try {
      const [active, deleted] = await Promise.all([listMemos(false), listMemos(true)]);
      setMemos(active);
      setTrash(deleted);
      return [...active, ...deleted];
    } catch {
      setNotice("記録を読み込めませんでした。通信が戻ったら、もう一度開いてください。");
      return [];
    }
  }, []);

  const refreshDueReminders = useCallback(async () => {
    if (!REMINDER_BETA || (cloudMode && !session)) return;
    try {
      setDueReminders(await listDueReminders());
    } catch {
      // Reminders are supplementary. Capture remains available.
    }
  }, [session]);

  const refreshDoLater = useCallback(async () => {
    try {
      const [active, resolved] = await Promise.all([
        listDoLater("active"),
        listDoLater("resolved")
      ]);
      setDoLaterActive(active);
      setDoLaterResolved(resolved);
      if (!cloudMode) {
        const all = [...active, ...resolved];
        const entries = await Promise.all(all.map(async (item) => [item.memo_id, await getWorkspace(item.memo_id)] as const));
        setWorkspaces(Object.fromEntries(entries));
      }
    } catch {
      setNotice("「あとでやる」を読み込めませんでした。メモは消えていません。");
    }
  }, []);

  useEffect(() => {
    if (tab === "recent" && (!cloudMode || session)) void refreshMemos();
  }, [tab, session, refreshMemos]);
  useEffect(() => {
    if (tab !== "search" || (cloudMode && !session)) return;
    void getSearchInsights().then((value) => {
      setSearchInsights(value);
      cacheSearchInsights(value);
    }).catch(() => setSearchInsights(readCachedSearchInsights()));
  }, [tab, session]);

  useEffect(() => {
    if (tab === "do-later" && (!cloudMode || session)) void refreshDoLater();
  }, [tab, session, refreshDoLater]);

  useEffect(() => {
    if (!session && cloudMode) return;
    void refreshDueReminders();
  }, [session, refreshDueReminders]);

  useEffect(() => {
    if (!session || !REMINDER_BETA) return;
    const parameters = new URLSearchParams(window.location.search);
    const reminderId = parameters.get("reminder");
    const memoId = parameters.get("memo");
    if (!reminderId || !memoId) return;
    void (async () => {
      try {
        await markReminderOpened(reminderId);
        const all = await refreshMemos();
        const memo = all.find((item) => item.id === memoId);
        if (memo) setSelected(memo);
        parameters.delete("reminder");
        parameters.delete("memo");
        const suffix = parameters.toString();
        history.replaceState(null, "", `${window.location.pathname}${suffix ? `?${suffix}` : ""}`);
        await refreshDueReminders();
      } catch {
        setNotice("通知の記録を開けませんでした。メモは消えていません。");
      }
    })();
  }, [session, refreshDueReminders, refreshMemos]);

  const save = async () => {
    const clean = text.trim();
    if (!clean || saving) return;
    setSaving(true);
    setRelated([]);
    setLastSavedMemo(null);
    setLastSavedMarked(false);
    setShowReminder(false);
    setSaveState("idle");
    const input: CaptureInput = {
      client_id: crypto.randomUUID(),
      text: clean,
      captured_at: new Date().toISOString()
    };
    try {
      if (!navigator.onLine) throw new Error("offline");
      const result = await captureMemo(input);
      setRelated(result.related);
      setLastSavedMemo(result.memo);
      setShowReminder(REMINDER_BETA);
      setSaveState("saved");
    } catch {
      await queueCapture(input);
      await refreshPending();
      setSaveState("queued");
    } finally {
      textarea.current?.blur();
      setText("");
      setSaving(false);
      window.setTimeout(() => {
        saveMessage.current?.scrollIntoView({ behavior: "smooth", block: "center" });
      }, 80);
    }
  };

  const runSearch = async (value: string) => {
    const cleanQuery = value.trim();
    if (cleanQuery.length < 2) return;
    setQuery(cleanQuery);
    setSearching(true);
    try {
      setSearchResults(await searchMemories(cleanQuery));
      const insights = await recordSearch(cleanQuery);
      setSearchInsights(insights);
      cacheSearchInsights(insights);
    } catch {
      setSearchInsights(addCachedSearch(cleanQuery));
      setNotice("今は検索できません。検索語は端末に預かりました。");
    } finally {
      setSearching(false);
    }
  };

  const search = async (event: FormEvent) => {
    event.preventDefault();
    await runSearch(query);
  };

  const openMemory = async (memory: RelatedMemory) => {
    if (memory.source_type === "idea_thread" && memory.thread_id) {
      try {
        setIdeaThread(await getIdeaThread(memory.thread_id));
      } catch {
        setNotice("過去との対話を開けませんでした。");
      }
      return;
    }
    const id = memory.source_uri.startsWith("memory://memo/")
      ? memory.source_uri.slice("memory://memo/".length)
      : memory.memory_id;
    let local = [...memos, ...trash].find((memo) => memo.id === id);
    if (!local && memory.source_type === "mobile_app") {
      const all = await refreshMemos();
      local = all.find((memo) => memo.id === id);
    }
    if (local) setSelected(local);
    else setSelectedMemory(memory);
  };

  const beginThread = async (memoryId: string, currentMemoId?: string) => {
    try {
      const thread = await createIdeaThread(memoryId, currentMemoId);
      setSelected(null);
      setSelectedMemory(null);
      setIdeaThread(thread);
      setNotice(currentMemoId ? "過去の言葉へ、今の言葉をつなぎました。" : "");
    } catch {
      setNotice("今は対話を始められません。元の記録は変わっていません。");
    }
  };

  const recordFeedback = async (memory: RelatedMemory, verdict: FeedbackVerdict) => {
    if (!lastSavedMemo) return;
    try {
      await saveFeedback(lastSavedMemo.id, memory.memory_id, verdict);
      if (verdict === "irrelevant") {
        setRelated((items) => items.filter((item) => item.memory_id !== memory.memory_id));
      } else {
        setNotice("「近い」を覚えました。");
      }
    } catch {
      setNotice("評価は保存できませんでした。メモには影響ありません。");
    }
  };

  const scheduleReminder = async (remindAt: Date) => {
    if (!lastSavedMemo) return;
    const input: ReminderInput = {
      client_id: crypto.randomUUID(),
      memo_id: lastSavedMemo.id,
      remind_at: remindAt.toISOString()
    };
    try {
      const pushReady = await ensurePushSubscription();
      if (!navigator.onLine) throw new Error("offline");
      await createReminder(input);
      setNotice(pushReady
        ? `${formatDateTime(input.remind_at)}に、もう一度知らせます。`
        : "通知は許可されていないため、次にアプリを開いた時に表示します。");
    } catch {
      await queueReminder(input);
      setNotice("通信が戻ったら、リマインダーを登録します。");
    } finally {
      setShowReminder(false);
    }
  };

  const openDueReminder = async (reminder: Reminder) => {
    if (!reminder.memo) return;
    try {
      await markReminderOpened(reminder.id);
      setSelected(reminder.memo);
      setDueReminders((items) => items.filter((item) => item.id !== reminder.id));
    } catch {
      setNotice("今は開封を記録できません。");
    }
  };

  const markDoLater = async (memo: Memo) => {
    try {
      await addDoLater(memo.id);
      if (lastSavedMemo?.id === memo.id) setLastSavedMarked(true);
      await refreshDoLater();
      setNotice("「あとでやる」に置きました。");
    } catch {
      setNotice("今は「あとでやる」に置けませんでした。メモは残っています。");
    }
  };

  const moveDoLaterToBottom = (memoId: string) => {
    setDoLaterActive((current) => {
      const target = current.find((item) => item.memo_id === memoId);
      if (!target) return current;
      const remaining = current.filter((item) => item.memo_id !== memoId);
      return [...remaining, target];
    });
  };

  const actOnDoLater = async (memoId: string, action: DoLaterAction) => {
    try {
      await updateDoLater(memoId, action);
      if (action === "later") {
        moveDoLaterToBottom(memoId);
        setNotice("一覧の末尾へ移しました。");
        return;
      }
      await refreshDoLater();
    } catch {
      setNotice("今は変更できませんでした。元のメモは変わっていません。");
    }
  };

  const configureItem = async (item: DoLaterItem, configuration: {
    first_step: string | null;
    launch_url: string | null;
    roulette_enabled: boolean;
  }) => {
    try {
      await configureDoLater(item.memo_id, configuration);
      await refreshDoLater();
      setSetupItem(null);
      setNotice("着手の設定を保存しました。");
    } catch {
      setNotice("着手の設定を保存できませんでした。元のメモは変わっていません。");
    }
  };

  const refreshWorkspace = async (memoId: string) => {
    if (cloudMode) return null;
    const workspace = await getWorkspace(memoId);
    setWorkspaces((current) => ({ ...current, [memoId]: workspace }));
    return workspace;
  };

  const chooseWorkspace = async (item: DoLaterItem, mode: "choose" | "create", label?: string) => {
    try {
      const result = await createOrChooseWorkspace(item.memo_id, mode, label);
      if (result.workspace) {
        setWorkspaces((current) => ({ ...current, [item.memo_id]: result.workspace }));
        setNotice("作業フォルダを用意しました。");
      } else if (result.status === "cancelled") {
        setNotice("フォルダの選択を取り消しました。");
      } else {
        setNotice(workspaceStatusMessage(result.status));
      }
    } catch {
      setNotice("作業フォルダを用意できませんでした。");
    }
  };

  const chooseWorkspaceFromPath = async (item: DoLaterItem, mode: "choose" | "create", inputPath: string, label?: string) => {
    try {
      const result = await createWorkspaceFromPath(item.memo_id, mode, inputPath, label);
      if (result.workspace) {
        setWorkspaces((current) => ({ ...current, [item.memo_id]: result.workspace }));
        setNotice("作業フォルダを用意しました。");
      } else {
        setNotice(workspaceStatusMessage(result.status));
      }
    } catch {
      setNotice("入力したパスを確認できませんでした。");
    }
  };

  const addFilesToWorkspace = async (item: DoLaterItem) => {
    try {
      const result = await addWorkspaceFiles(item.memo_id);
      if (result.status !== "success") setNotice(workspaceStatusMessage(result.status));
      else if (result.copied.length > 0) setNotice(`${result.copied.length}個のファイルを追加しました。`);
      else setNotice("追加するファイルはありませんでした。");
      await refreshWorkspace(item.memo_id);
    } catch {
      setNotice("ファイルを追加できませんでした。");
    }
  };

  const startWorkspace = async (item: DoLaterItem) => {
    try {
      const result = await openWorkspace(item.memo_id);
      const workspace = result.workspace;
      if (workspace) setWorkspaces((current) => ({ ...current, [item.memo_id]: workspace }));
      if (result.status !== "success" || !workspace?.exists) {
        setNotice(workspaceStatusMessage(result.status));
        setWorkspaceItem(item);
        return;
      }
      setWorkspaceItem(null);
      setFocusItem(item);
    } catch {
      const workspace = await refreshWorkspace(item.memo_id);
      setNotice(workspace ? "作業フォルダを開けませんでした。" : "作業フォルダが見つかりません。再指定してください。");
      if (workspace) setWorkspaceItem(item);
    }
  };

  const workspaceStatusMessage = (status: WorkspaceOperationStatus): string => {
    if (status === "cancelled") return "フォルダの選択を取り消しました。";
    if (status === "helper_unavailable") return "PCヘルパーを起動できませんでした。パスを入力して指定してください。";
    if (status === "timeout") return "選択画面から応答がありませんでした。もう一度試してください。";
    if (status === "folder_not_found") return "作業フォルダが見つかりません。再指定してください。";
    return "フォルダ選択を開けませんでした。パスを入力して指定することもできます。";
  };

  const detachWorkspace = async (item: DoLaterItem) => {
    try {
      await unlinkWorkspace(item.memo_id);
      setWorkspaces((current) => ({ ...current, [item.memo_id]: null }));
      setNotice("作業フォルダとの紐づけを外しました。フォルダ自体は削除していません。");
    } catch {
      setNotice("作業フォルダとの紐づけを外せませんでした。");
    }
  };

  const openDoLater = (item: DoLaterItem) => {
    if (!START_ASSIST_BETA) {
      setSelected(item.memo);
      return;
    }
    if (item.launch_url) {
      const opened = window.open(item.launch_url, "_blank", "noopener,noreferrer");
      if (opened) {
        setNotice("始めました。");
        return;
      }
    }
    if (item.first_step || item.launch_url) {
      setFocusItem(item);
      return;
    }
    setSelected(item.memo);
  };

  const spinRoulette = () => {
    const candidates = doLaterActive.filter((item) => item.roulette_enabled);
    if (candidates.length === 0) {
      setNotice("ルーレットに入れた言葉はまだありません。");
      return;
    }
    const random = new Uint32Array(1);
    crypto.getRandomValues(random);
    openDoLater(candidates[random[0]! % candidates.length]!);
  };

  const navTitle = useMemo(() => {
    if (tab === "do-later") return "あとでやる";
    if (tab === "search") return "言葉をさがす";
    if (tab === "recent") return "最近";
    return "ことばの保管庫";
  }, [tab]);

  if (session === undefined) {
    return <main className="loading-screen"><img className="brand-mascot" src="./icons/icon-192.png" alt="" aria-hidden="true" /></main>;
  }
  if (cloudMode && !session) return <AuthScreen onReady={setSession} />;

  return (
    <div className="app-shell">
<header className="topbar">
        <div className="topbar-brand">
          <img className="header-mascot" src="./icons/icon-192.png" alt="" aria-hidden="true" />
          <h1>{navTitle}</h1>
        </div>
        <div className="topbar-actions">
          {tab === "recent" && (
            <button
              className={`trash-header-button ${showTrash ? "active" : ""}`}
              type="button"
              aria-label={showTrash ? "最近の言葉に戻る" : "ゴミ箱を開く"}
              onClick={() => setShowTrash((value) => !value)}
            >
              <NavIcon kind="trash" />
              {trash.length > 0 && <small>{trash.length}</small>}
            </button>
          )}
          {installPrompt && (
            <button className="install-button" onClick={() => void installPrompt.prompt()}>
              ホームに置く
            </button>
          )}
        </div>
      </header>

      {REMINDER_BETA && dueReminders[0] && (
        <div className="due-reminder">
          <button onClick={() => void openDueReminder(dueReminders[0]!)}>
            <span>もう一度考えたかった言葉があります</span>
            <strong>{dueReminders[0].memo?.title}</strong>
          </button>
          <button
            className="dismiss-reminder"
            aria-label="リマインダーを取り消す"
            onClick={() => {
              const reminder = dueReminders[0]!;
              void cancelReminder(reminder.id).then(() =>
                setDueReminders((items) => items.slice(1))
              );
            }}
          >×</button>
        </div>
      )}

      <main className="content">
        {tab === "write" && (
          <>
            <section className="write-panel">
              <label className="sr-only" htmlFor="thought">思いついた言葉</label>
              <textarea
                ref={textarea}
                id="thought"
                value={text}
                onChange={(event) => {
                  setText(event.target.value);
                  setSaveState("idle");
                }}
                placeholder={"いま浮かんでいることを、\n整えずにそのまま。"}
                autoFocus
              />
              <div className="write-actions">
                <span className="quiet-status">
                  {pendingCount > 0 ? `${pendingCount}件、端末で預かり中` : "原文のまま残ります"}
                </span>
                {text.trim() && (
                  <button className="save-button" disabled={saving} onClick={save}>
                    {saving ? "残しています…" : "残す"}
                  </button>
                )}
              </div>
            </section>
            {saveState !== "idle" && (
              <div ref={saveMessage} className={`save-message ${saveState}`}>
                <span>{saveState === "saved" ? "残しました。" : "端末に預かりました。"}</span>
                <small>
                  {saveState === "saved"
                    ? "あなたの言葉は、そのまま保管されています。"
                    : "通信が戻ったら、自動で保管庫へ送ります。"}
                </small>
              </div>
            )}
            {saveState === "saved" && lastSavedMemo && (
              <button
                className="do-later-mark-button"
                disabled={lastSavedMarked}
                onClick={() => void markDoLater(lastSavedMemo)}
              >
                {lastSavedMarked ? "あとでやるに置きました" : "あとでやる"}
              </button>
            )}
            {REMINDER_BETA && showReminder && lastSavedMemo && (
              <ReminderChooser
                onSchedule={(date) => void scheduleReminder(date)}
                onClose={() => setShowReminder(false)}
              />
            )}
            <RelatedCards
              memories={related}
              queryMemoId={lastSavedMemo?.id}
              allowLink
              onOpen={(memory) => void openMemory(memory)}
              onFeedback={(memory, verdict) => void recordFeedback(memory, verdict)}
              onLink={(memory) => void beginThread(memory.memory_id, lastSavedMemo?.id)}
            />
          </>
        )}

        {tab === "do-later" && (
          <section className="do-later-panel">
            {START_ASSIST_BETA && (
              <button className="roulette-button" type="button" onClick={spinRoulette}>
                ルーレットを回す
              </button>
            )}
            <p className="do-later-intro">行動につながりそうな言葉を、ここでもう一度。</p>
            <div className="do-later-list">
              {doLaterActive.map((item) => (
                <article className="do-later-card" key={item.memo_id}>
                  <button className="do-later-main" onClick={() => openDoLater(item)}>
                    <time>{formatRelativeDate(item.memo.captured_at)}</time>

                    {START_ASSIST_BETA && item.first_step && (
                      <em className="first-step-preview">まず、これだけ：{item.first_step}</em>
                    )}
                    <span className="do-later-text">{item.memo.current_text}</span>
                  </button>
                  {START_ASSIST_BETA && (
                    <button className="setup-start-button" type="button" onClick={() => setSetupItem(item)}>
                      {item.first_step || item.launch_url ? "最初の一歩を編集" : "最初の一歩を置く"}
                    </button>
                  )}
                  {!cloudMode && (
                    <div className="workspace-actions">
                      {workspaces[item.memo_id]?.exists ? (
                        <button className="workspace-open-button" type="button" onClick={() => void startWorkspace(item)}>
                          開いて始める：{workspaces[item.memo_id]?.label}
                        </button>
                      ) : (
                        <button className="workspace-open-button" type="button" onClick={() => setWorkspaceItem(item)}>
                          {workspaces[item.memo_id] ? "作業フォルダを再指定" : "作業フォルダを用意"}
                        </button>
                      )}
                    </div>
                  )}
                  <div className="do-later-actions">
                    <button className="do-later-done" onClick={() => void actOnDoLater(item.memo_id, "done")}>やってあげた。</button>
                    <button className="do-later-later" onClick={() => void actOnDoLater(item.memo_id, "later")}>まだやらない</button>
                    <button className="do-later-abandon" onClick={() => void actOnDoLater(item.memo_id, "abandon")}>やっぱりやめる</button>
                  </div>
                </article>
              ))}
              {doLaterActive.length === 0 && (
                <p className="empty-message">いま「あとでやる」に置いている言葉はありません。</p>
              )}
            </div>
            <section className="do-later-history">
              <button
                className="do-later-history-toggle"
                onClick={() => setShowDoLaterHistory((value) => !value)}
                aria-expanded={showDoLaterHistory}
              >
                <span>これまで</span><span>{showDoLaterHistory ? "−" : "＋"}</span>
              </button>
              {showDoLaterHistory && (
                <div className="do-later-history-list">
                  {doLaterResolved.map((item) => (
                    <button key={item.memo_id} onClick={() => setSelected(item.memo)}>
                      <span className={`do-later-result ${item.status}`}>
                        {item.status === "done" ? "やってあげた。" : "やっぱりやめる。"}
                      </span>
                      <strong>{item.memo.current_text}</strong>
                      <time>{formatRelativeDate(item.resolved_at)}</time>
                    </button>
                  ))}
                  {doLaterResolved.length === 0 && (
                    <p className="empty-message">これまでの結果は、まだありません。</p>
                  )}
                </div>
              )}
            </section>
          </section>
        )}

{tab === "search" && (
          <section className="search-panel">
            <form onSubmit={search}>
              <label htmlFor="search">覚えている言葉でも、今の考えでも</label>
              <div className="search-box">
                <span className="search-leading-icon" aria-hidden="true"><NavIcon kind="search" /></span>
                <input
                  id="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="例：ゼロから考えるアイデア"
                  enterKeyHint="search"
                />
              </div>
              <p className="search-help">言葉を入れて、過去の自分に会いにいく。</p>
            </form>
            {!query && searchInsights.recent.length > 0 && (
              <section className="search-insight-section">
                <h2>最近さがした言葉</h2>
                <div className="search-chips">
                  {searchInsights.recent.map((term) => (
                    <button type="button" key={`recent-${term.text}`} className="search-chip" onClick={() => void runSearch(term.text)}>{term.text}</button>
                  ))}
                </div>
              </section>
            )}
            {!query && searchInsights.frequent.length > 0 && (
              <section className="search-insight-section">
                <h2>よく出てくる言葉</h2>
                <div className="search-chips">
                  {searchInsights.frequent.map((term) => (
                    <button type="button" key={`frequent-${term.text}`} className="search-chip warm" onClick={() => void runSearch(term.text)}>
                      {term.text}<small>{term.count}</small>
                    </button>
                  ))}
                </div>
              </section>
            )}
            {searchResults.length === 0 && query && !searching && (
              <p className="empty-message">強くつながる記録は、まだ見つかっていません。</p>
            )}
            <RelatedCards
              memories={searchResults}
              onOpen={(memory) => void openMemory(memory)}
              onFeedback={() => undefined}
              onLink={(memory) => void beginThread(memory.memory_id)}
            />
          </section>
        )}

{tab === "recent" && (
          <section className="recent-panel">
            <div className="memo-list">
              {(showTrash ? trash : memos).map((memo) => (
                <button className="memo-row" key={memo.id} onClick={() => setSelected(memo)}>
                  <time>{formatRelativeDate(memo.captured_at)}</time>
                  <span>{memo.current_text}</span>
                </button>
              ))}
              {(showTrash ? trash : memos).length === 0 && (
                <p className="empty-message">
                  {showTrash ? "ゴミ箱は空です。" : "ここに、残した言葉が並びます。"}
                </p>
              )}
            </div>
          </section>
        )}
      </main>

<nav className="bottom-nav" aria-label="メインメニュー">
        <button className={tab === "write" ? "active" : ""} onClick={() => setTab("write")}>
          <span className="nav-icon"><NavIcon kind="write" /></span><span>書く</span>
        </button>
        <button className={tab === "do-later" ? "active" : ""} onClick={() => setTab("do-later")}>
          <span className="nav-icon"><NavIcon kind="later" /></span><span>あとでやる</span>
        </button>
        <button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>
          <span className="nav-icon"><NavIcon kind="search" /></span><span>さがす</span>
        </button>
        <button className={tab === "recent" ? "active" : ""} onClick={() => setTab("recent")}>
          <span className="nav-icon"><NavIcon kind="recent" /></span><span>最近</span>
        </button>
      </nav>

      {selected && (
        <MemoDialog
          memo={selected}
          onClose={() => setSelected(null)}
          onDialogue={DIALOGUE_BETA ? () => void beginThread(selected.id) : undefined}
          onDoLater={!selected.deleted_at ? () => void markDoLater(selected) : undefined}
          onChanged={async () => {
            setSelected(null);
            await refreshMemos();
          }}
        />
      )}
      {selectedMemory && (
        <MemoryPreviewDialog
          memory={selectedMemory}
          onClose={() => setSelectedMemory(null)}
          onDialogue={DIALOGUE_BETA
            ? () => void beginThread(selectedMemory.memory_id)
            : undefined}
        />
      )}
      {ideaThread && (
        <IdeaThreadDialog
          thread={ideaThread}
          onClose={() => setIdeaThread(null)}
          onAdd={async (value) => {
            const updated = await addIdeaThreadEntry(ideaThread.id, value);
            setIdeaThread(updated);
          }}
        />
      )}
      {setupItem && (
        <DoLaterSetupDialog
          item={setupItem}
          onClose={() => setSetupItem(null)}
          onSave={(configuration) => void configureItem(setupItem, configuration)}
        />
      )}
      {workspaceItem && !cloudMode && (
        <WorkspaceDialog
          item={workspaceItem}
          workspace={workspaces[workspaceItem.memo_id] ?? null}
          onClose={() => setWorkspaceItem(null)}
          onChoose={(mode, label) => void chooseWorkspace(workspaceItem, mode, label)}
          onPath={(mode, path, label) => void chooseWorkspaceFromPath(workspaceItem, mode, path, label)}
          onAddFiles={() => void addFilesToWorkspace(workspaceItem)}
          onOpen={() => void startWorkspace(workspaceItem)}
          onDetach={() => void detachWorkspace(workspaceItem)}
        />
      )}
      {focusItem && (
        <DoLaterFocusDialog
          item={focusItem}
          onClose={() => setFocusItem(null)}
          onOpenMemo={() => { setFocusItem(null); setSelected(focusItem.memo); }}
        />
      )}
      {notice && (
        <button className="notice" onClick={() => setNotice("")}>{notice}</button>
      )}
    </div>
  );
};

const WorkspaceDialog = ({
  item,
  workspace,
  onClose,
  onChoose,
  onPath,
  onAddFiles,
  onOpen,
  onDetach
}: {
  item: DoLaterItem;
  workspace: WorkspaceSummary | null;
  onClose: () => void;
  onChoose: (mode: "choose" | "create", label?: string) => void;
  onPath: (mode: "choose" | "create", path: string, label?: string) => void;
  onAddFiles: () => void;
  onOpen: () => void;
  onDetach: () => void;
}) => {
  const [manualPath, setManualPath] = useState("");
  const chooseNew = () => {
    const label = window.prompt("作業フォルダの名前", item.memo.title);
    if (label === null) return;
    onChoose("create", label);
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <article className="start-dialog workspace-dialog" role="dialog" aria-modal="true">
        <button className="close-button" onClick={onClose} aria-label="閉じる">×</button>
        <p className="eyebrow">この作業に必要なもの</p>
        <h2>{workspace?.label ?? "作業フォルダ"}</h2>
        {!workspace ? (
          <>
            <p className="dialog-help">資料をまとめておく場所を選ぶか、新しく作ります。</p>
            <button className="workspace-dialog-button" onClick={() => onChoose("choose")}>既存フォルダを選ぶ</button>
            <button className="workspace-dialog-button" onClick={chooseNew}>新しい作業フォルダを作る</button>
            <div className="workspace-path-fallback">
              <label htmlFor="workspace-path">フォルダのパスを入力</label>
              <input id="workspace-path" value={manualPath} onChange={(event) => setManualPath(event.target.value)} placeholder="C:\\Users\\あなた\\Desktop\\作業" />
              <button className="workspace-dialog-button" disabled={!manualPath.trim()} onClick={() => onPath("choose", manualPath)}>このパスを使う</button>
            </div>
          </>
        ) : (
          <>
            {!workspace.exists && <p className="workspace-missing">作業フォルダが見つかりません。</p>}
            <button className="workspace-dialog-button" onClick={workspace.exists ? onAddFiles : () => onChoose("choose")}>必要なファイルを追加</button>
            {workspace.exists && <button className="workspace-dialog-button primary-button" onClick={onOpen}>開いて始める</button>}
            <button className="text-button" onClick={onDetach}>紐づけを外す（フォルダは削除しない）</button>
          </>
        )}
      </article>
    </div>
  );
};

const DoLaterSetupDialog = ({
  item,
  onClose,
  onSave
}: {
  item: DoLaterItem;
  onClose: () => void;
  onSave: (configuration: { first_step: string | null; launch_url: string | null; roulette_enabled: boolean }) => void;
}) => {
  const [firstStep, setFirstStep] = useState(item.first_step ?? "");
  const [launchUrl, setLaunchUrl] = useState(item.launch_url ?? "");
  const [roulette, setRoulette] = useState(item.roulette_enabled);
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <article className="start-dialog" role="dialog" aria-modal="true">
        <button className="close-button" onClick={onClose} aria-label="閉じる">×</button>
        <h2>最初の一歩</h2>
        <p className="dialog-help">この言葉から始めるなら、まず何をする？</p>
        <textarea value={firstStep} onChange={(event) => setFirstStep(event.target.value)} placeholder="例：資料を開いて、見出しだけ読む" maxLength={500} />
        <input value={launchUrl} onChange={(event) => setLaunchUrl(event.target.value)} placeholder="開くURL（任意）" inputMode="url" />
        <label className="roulette-check"><input type="checkbox" checked={roulette} onChange={(event) => setRoulette(event.target.checked)} /> ルーレットに入れる</label>
        <div className="dialog-actions">
          <button className="text-button" onClick={onClose}>やっぱりやめる</button>
          <button className="primary-button" onClick={() => onSave({
            first_step: firstStep || null,
            launch_url: launchUrl || null,
            roulette_enabled: roulette
          })}>保存</button>
        </div>
      </article>
    </div>
  );
};

const DoLaterFocusDialog = ({ item, onClose, onOpenMemo }: { item: DoLaterItem; onClose: () => void; onOpenMemo: () => void }) => (
  <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <article className="start-dialog focus-dialog" role="dialog" aria-modal="true">
      <button className="close-button" onClick={onClose} aria-label="閉じる">×</button>
      <p className="eyebrow">まず、これだけ。</p>
      <h2>{item.first_step || item.memo.title}</h2>
      {item.launch_url && <a className="primary-button start-link" href={item.launch_url} target="_blank" rel="noreferrer">開く</a>}
      <button className="text-button" onClick={onOpenMemo}>元の言葉を見る</button>
    </article>
  </div>
);

const ReminderChooser = ({
  onSchedule,
  onClose
}: {
  onSchedule: (date: Date) => void;
  onClose: () => void;
}) => {
  const [custom, setCustom] = useState("");
  const now = new Date();
  const tonight = new Date(now);
  tonight.setHours(21, 0, 0, 0);
  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  tomorrow.setHours(8, 0, 0, 0);
  const showTonight = now.getHours() < 20 || (now.getHours() === 20 && now.getMinutes() < 30);
  return (
    <section className="reminder-chooser">
      <div>
        <strong>あとで、もう一度考える？</strong>
        <button aria-label="閉じる" onClick={onClose}>×</button>
      </div>
      <p>通知には、この言葉の冒頭が表示されます。</p>
      <div className="reminder-presets">
        <button onClick={() => onSchedule(new Date(Date.now() + 60 * 60 * 1000))}>1時間後</button>
        {showTonight && <button onClick={() => onSchedule(tonight)}>今夜21時</button>}
        <button onClick={() => onSchedule(tomorrow)}>明日の朝8時</button>
      </div>
      <div className="custom-reminder">
        <input
          type="datetime-local"
          value={custom}
          onChange={(event) => setCustom(event.target.value)}
          aria-label="日時を指定"
        />
        <button disabled={!custom} onClick={() => onSchedule(new Date(custom))}>この日時</button>
      </div>
    </section>
  );
};

const MemoryPreviewDialog = ({
  memory,
  onClose,
  onDialogue
}: {
  memory: RelatedMemory;
  onClose: () => void;
  onDialogue?: () => void;
}) => (
  <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
    <article className="memo-dialog" role="dialog" aria-modal="true">
      <button className="close-button" onClick={onClose} aria-label="閉じる">×</button>
      <time>{formatDate(memory.date)}</time>
      <h2>{memory.title}</h2>
      <p className="full-text">{memory.excerpt}</p>
      {onDialogue && (
        <button className="dialogue-button" onClick={onDialogue}>
          今の自分から返す <span>β</span>
        </button>
      )}
      <small className="source-note">元の記録：{memory.source_type}</small>
    </article>
  </div>
);

const IdeaThreadDialog = ({
  thread,
  onClose,
  onAdd
}: {
  thread: IdeaThread;
  onClose: () => void;
  onAdd: (text: string) => Promise<void>;
}) => {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    if (!text.trim() || busy) return;
    setBusy(true);
    try {
      await onAdd(text.trim());
      setText("");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <article className="memo-dialog thread-dialog" role="dialog" aria-modal="true">
        <button className="close-button" onClick={onClose} aria-label="閉じる">×</button>
        <p className="eyebrow">過去の自分との対話 β</p>
        <div className="thread-timeline">
          <section className="thread-entry root">
            <time>{formatDate(thread.root.date)}</time>
            <strong>{thread.root.title}</strong>
            <p>{thread.root.text}</p>
          </section>
          {thread.entries.map((entry) => (
            <section className="thread-entry" key={entry.id}>
              <time>{formatDate(entry.written_at)}</time>
              <strong>{entry.title}</strong>
              <p>{entry.text}</p>
            </section>
          ))}
        </div>
        <label className="reflection-box">
          <span>今の自分から返す</span>
          <textarea
            value={text}
            onChange={(event) => setText(event.target.value)}
            placeholder="今読むと、同じところ／変わったところは？"
          />
        </label>
        <button className="primary-button" disabled={!text.trim() || busy} onClick={() => void submit()}>
          {busy ? "残しています…" : "この時点の言葉を残す"}
        </button>
      </article>
    </div>
  );
};

const MemoDialog = ({
  memo,
  onClose,
  onChanged,
  onDialogue,
  onDoLater
}: {
  memo: Memo;
  onClose: () => void;
  onChanged: () => Promise<void>;
  onDialogue?: () => void;
  onDoLater?: () => void;
}) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(memo.title);
  const [text, setText] = useState(memo.current_text);
  const [historyVisible, setHistoryVisible] = useState(false);
  const [busy, setBusy] = useState(false);
  const save = async () => {
    setBusy(true);
    await updateMemo(memo.id, text, title);
    await onChanged();
  };
  const remove = async () => {
    if (!window.confirm("この記録をゴミ箱へ移しますか？")) return;
    setBusy(true);
    await trashMemo(memo.id);
    await onChanged();
  };
  const restore = async () => {
    setBusy(true);
    await restoreMemo(memo.id);
    await onChanged();
  };
  return (
    <div className="dialog-backdrop" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <article className="memo-dialog" role="dialog" aria-modal="true">
        <button className="close-button" onClick={onClose} aria-label="閉じる">×</button>
        <time>{formatDate(memo.captured_at)}</time>
        {editing ? (
          <>
            <input className="edit-title" value={title} onChange={(event) => setTitle(event.target.value)} />
            <textarea className="edit-text" value={text} onChange={(event) => setText(event.target.value)} />
          </>
        ) : (
          <>
            <h2>{memo.title}</h2>
            <p className="full-text">{memo.current_text}</p>
          </>
        )}
        {memo.original_text !== memo.current_text && (
          <div className="original-note">
            <span>最初に残した原文</span>
            <p>{memo.original_text}</p>
          </div>
        )}
        {historyVisible && memo.revisions.length > 0 && (
          <div className="revision-list">
            {memo.revisions.map((revision) => (
              <div key={revision.revised_at}>
                <time>{formatDate(revision.revised_at)}</time>
                <p>{revision.text}</p>
              </div>
            ))}
          </div>
        )}
        {onDialogue && !memo.deleted_at && !editing && (
          <button className="dialogue-button" onClick={onDialogue}>
            今の自分から返す <span>β</span>
          </button>
        )}
        {onDoLater && !editing && (
          <button className="do-later-dialog-button" onClick={onDoLater}>
            あとでやる
          </button>
        )}
        <div className="dialog-actions">
          {memo.deleted_at ? (
            <button className="primary-button" disabled={busy} onClick={() => void restore()}>
              元に戻す
            </button>
          ) : editing ? (
            <>
              <button className="text-button" onClick={() => setEditing(false)}>やっぱりやめる</button>
              <button className="primary-button" disabled={busy || !text.trim()} onClick={() => void save()}>
                変更を残す
              </button>
            </>
          ) : (
            <>
              {memo.revisions.length > 0 && (
                <button className="text-button" onClick={() => setHistoryVisible((value) => !value)}>
                  {historyVisible ? "履歴を閉じる" : "編集履歴"}
                </button>
              )}
              <button className="text-button" onClick={() => setEditing(true)}>手直し</button>
              <button className="danger-button" disabled={busy} onClick={() => void remove()}>
                ゴミ箱へ
              </button>
            </>
          )}
        </div>
      </article>
    </div>
  );
};

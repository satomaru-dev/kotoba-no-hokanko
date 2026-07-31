import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import type { Session } from "@supabase/supabase-js";
import {
  captureMemo,
  cloudMode,
  listMemos,
  restoreMemo,
  searchMemories,
  supabase,
  trashMemo,
  updateMemo
} from "./api";
import { listQueuedCaptures, queueCapture, queuedCount, removeQueuedCapture } from "./offline";
import type { CaptureInput, Memo, RelatedMemory } from "./types";

type Tab = "write" | "search" | "recent";
type InstallPrompt = Event & { prompt: () => Promise<void> };

const formatDate = (value: string | null): string => {
  if (!value) return "日付不明";
  return new Intl.DateTimeFormat("ja-JP", {
    year: "numeric",
    month: "long",
    day: "numeric"
  }).format(new Date(value));
};

const RelatedCards = ({
  memories,
  onOpen
}: {
  memories: RelatedMemory[];
  onOpen: (memory: RelatedMemory) => void;
}) => {
  if (memories.length === 0) return null;
  return (
    <section className="related-section" aria-live="polite">
      <p className="eyebrow">過去の言葉との再会</p>
      <h2>近くに、こんな記録がありました</h2>
      <div className="related-list">
        {memories.map((memory) => (
          <button className="memory-card" key={memory.memory_id} onClick={() => onOpen(memory)}>
            <span className="memory-meta">
              <time>{formatDate(memory.date)}</time>
              <span className="relation">{memory.relation}</span>
            </span>
            <strong>{memory.title}</strong>
            <span className="memory-excerpt">{memory.excerpt}</span>
            <span className="open-label">記録をひらく →</span>
          </button>
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
    const { error: authError } = await supabase!.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: window.location.href.split("#")[0] }
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
      <div className="brand-mark" aria-hidden="true"><i /><i /><i /></div>
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
  const [pendingCount, setPendingCount] = useState(0);
  const [query, setQuery] = useState("");
  const [searching, setSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<RelatedMemory[]>([]);
  const [memos, setMemos] = useState<Memo[]>([]);
  const [trash, setTrash] = useState<Memo[]>([]);
  const [showTrash, setShowTrash] = useState(false);
  const [selected, setSelected] = useState<Memo | null>(null);
  const [installPrompt, setInstallPrompt] = useState<InstallPrompt | null>(null);
  const [notice, setNotice] = useState("");
  const textarea = useRef<HTMLTextAreaElement>(null);

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
    } catch {
      setNotice("記録を読み込めませんでした。通信が戻ったら、もう一度開いてください。");
    }
  }, []);

  useEffect(() => {
    if (tab === "recent" && (!cloudMode || session)) void refreshMemos();
  }, [tab, session, refreshMemos]);

  const save = async () => {
    const clean = text.trim();
    if (!clean || saving) return;
    setSaving(true);
    setRelated([]);
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
      setSaveState("saved");
    } catch {
      await queueCapture(input);
      await refreshPending();
      setSaveState("queued");
    } finally {
      setText("");
      setSaving(false);
      window.setTimeout(() => textarea.current?.focus(), 50);
    }
  };

  const search = async (event: FormEvent) => {
    event.preventDefault();
    if (query.trim().length < 2) return;
    setSearching(true);
    try {
      setSearchResults(await searchMemories(query.trim()));
    } catch {
      setNotice("今は検索できません。書いた言葉は消えていません。");
    } finally {
      setSearching(false);
    }
  };

  const openMemory = async (memory: RelatedMemory) => {
    const id = memory.source_uri.startsWith("memory://memo/")
      ? memory.source_uri.slice("memory://memo/".length)
      : memory.memory_id;
    let local = [...memos, ...trash].find((memo) => memo.id === id);
    if (!local && memory.source_type === "mobile_app") {
      try {
        const [active, deleted] = await Promise.all([listMemos(false), listMemos(true)]);
        setMemos(active);
        setTrash(deleted);
        local = [...active, ...deleted].find((memo) => memo.id === id);
      } catch {
        setNotice("記録を開けませんでした。通信が戻ってから、もう一度試してください。");
        return;
      }
    }
    if (local) {
      setSelected(local);
      return;
    }
    if (/^https?:/i.test(memory.source_uri)) window.open(memory.source_uri, "_blank", "noopener");
    else setNotice("元の記録はPC側の保管庫にあります。");
  };

  const navTitle = useMemo(() => {
    if (tab === "search") return "言葉をさがす";
    if (tab === "recent") return "最近の言葉";
    return "ことばの保管庫";
  }, [tab]);

  if (session === undefined) {
    return <main className="loading-screen"><div className="brand-mark"><i /><i /><i /></div></main>;
  }
  if (cloudMode && !session) return <AuthScreen onReady={setSession} />;

  return (
    <div className="app-shell">
      <header className="topbar">
        <div>
          <p className="eyebrow">{tab === "write" ? "自分の言葉と温度を、そのまま" : "保管庫"}</p>
          <h1>{navTitle}</h1>
        </div>
        {installPrompt && (
          <button className="install-button" onClick={() => void installPrompt.prompt()}>
            ホームに置く
          </button>
        )}
      </header>

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
                <button className="save-button" disabled={!text.trim() || saving} onClick={save}>
                  {saving ? "残しています…" : "残す"}
                </button>
              </div>
            </section>
            {saveState !== "idle" && (
              <div className={`save-message ${saveState}`}>
                <span>{saveState === "saved" ? "残しました。" : "端末に預かりました。"}</span>
                <small>
                  {saveState === "saved"
                    ? "あなたの言葉は、そのまま保管されています。"
                    : "通信が戻ったら、自動で保管庫へ送ります。"}
                </small>
              </div>
            )}
            <RelatedCards memories={related} onOpen={openMemory} />
          </>
        )}

        {tab === "search" && (
          <section className="search-panel">
            <form onSubmit={search}>
              <label htmlFor="search">覚えている言葉でも、今の考えでも</label>
              <div className="search-box">
                <input
                  id="search"
                  value={query}
                  onChange={(event) => setQuery(event.target.value)}
                  placeholder="例：ゼロから考えるアイデア"
                />
                <button disabled={searching || query.trim().length < 2}>
                  {searching ? "…" : "探す"}
                </button>
              </div>
            </form>
            {searchResults.length === 0 && query && !searching && (
              <p className="empty-message">強くつながる記録は、まだ見つかっていません。</p>
            )}
            <RelatedCards memories={searchResults} onOpen={openMemory} />
          </section>
        )}

        {tab === "recent" && (
          <section className="recent-panel">
            <div className="section-switch">
              <button className={!showTrash ? "active" : ""} onClick={() => setShowTrash(false)}>
                最近
              </button>
              <button className={showTrash ? "active" : ""} onClick={() => setShowTrash(true)}>
                ゴミ箱{trash.length > 0 ? ` ${trash.length}` : ""}
              </button>
            </div>
            <div className="memo-list">
              {(showTrash ? trash : memos).map((memo) => (
                <button className="memo-row" key={memo.id} onClick={() => setSelected(memo)}>
                  <time>{formatDate(memo.captured_at)}</time>
                  <strong>{memo.title}</strong>
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
          <span className="nav-icon">＋</span><span>書く</span>
        </button>
        <button className={tab === "search" ? "active" : ""} onClick={() => setTab("search")}>
          <span className="nav-icon">⌕</span><span>さがす</span>
        </button>
        <button className={tab === "recent" ? "active" : ""} onClick={() => setTab("recent")}>
          <span className="nav-icon">≡</span><span>最近</span>
        </button>
      </nav>

      {selected && (
        <MemoDialog
          memo={selected}
          onClose={() => setSelected(null)}
          onChanged={async () => {
            setSelected(null);
            await refreshMemos();
          }}
        />
      )}
      {notice && (
        <button className="notice" onClick={() => setNotice("")}>{notice}</button>
      )}
    </div>
  );
};

const MemoDialog = ({
  memo,
  onClose,
  onChanged
}: {
  memo: Memo;
  onClose: () => void;
  onChanged: () => Promise<void>;
}) => {
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState(memo.title);
  const [text, setText] = useState(memo.current_text);
  const [history, setHistory] = useState(false);
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
        {history && memo.revisions.length > 0 && (
          <div className="revision-list">
            {memo.revisions.map((revision) => (
              <div key={revision.revised_at}>
                <time>{formatDate(revision.revised_at)}</time>
                <p>{revision.text}</p>
              </div>
            ))}
          </div>
        )}
        <div className="dialog-actions">
          {memo.deleted_at ? (
            <button className="primary-button" disabled={busy} onClick={restore}>元に戻す</button>
          ) : editing ? (
            <>
              <button className="text-button" onClick={() => setEditing(false)}>やめる</button>
              <button className="primary-button" disabled={busy || !text.trim()} onClick={save}>変更を残す</button>
            </>
          ) : (
            <>
              <button className="text-button danger" disabled={busy} onClick={remove}>ゴミ箱へ</button>
              {memo.revisions.length > 0 && (
                <button className="text-button" onClick={() => setHistory(!history)}>履歴</button>
              )}
              <button className="primary-button" onClick={() => setEditing(true)}>手直しする</button>
            </>
          )}
        </div>
      </article>
    </div>
  );
};

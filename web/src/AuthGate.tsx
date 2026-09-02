import { useEffect, useRef, useState, type FormEvent, type ReactNode } from "react";
import type { Session, SupabaseClient } from "@supabase/supabase-js";
import { authErrorMessage, authRedirect, passwordError, readAuthReturn, setExistingAccountPassword } from "./auth";

type Mode = "login" | "setup" | "reset" | "link";
type AuthReturn = ReturnType<typeof readAuthReturn>;

const AuthShell = ({ children }: { children: ReactNode }) => (
  <main className="auth-shell">
    <img className="brand-mascot" src="./icons/icon-192.png" alt="" />
    <p className="eyebrow">ことばの保管庫</p>
    {children}
  </main>
);

export const LoginForm = ({ client, initialError = "" }: { client: SupabaseClient; initialError?: string }) => {
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState(initialError);
  const changeMode = (next: Mode) => { setMode(next); setSent(false); setError(""); setPassword(""); };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    lock.current = true;
    setBusy(true); setError("");
    try {
      const address = email.trim();
      const result = mode === "login"
        ? await client.auth.signInWithPassword({ email: address, password })
        : mode === "link"
          ? await client.auth.signInWithOtp({ email: address, options: {
            shouldCreateUser: false, emailRedirectTo: authRedirect(window.location.href)
          } })
          : await client.auth.resetPasswordForEmail(address, { redirectTo: authRedirect(window.location.href, true) });
      if (result.error) throw result.error;
      setPassword("");
      if (mode !== "login") setSent(true);
    } catch (error) { setError(authErrorMessage(error)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <AuthShell>
    <h1>{mode === "login" ? <>自分の言葉に、<br />帰ってこられる場所。</> : mode === "setup" ? "初めてのパスワード設定" : mode === "reset" ? "パスワードの再設定" : "メールリンクでログイン"}</h1>
    {sent ? <div className="auth-message" role="status">
      <strong>メールをご確認ください</strong>
      <p>登録済みのアドレスに手続き用リンクを送ります。届かない場合は、迷惑メールと入力したアドレスをご確認ください。</p>
      <p>{mode === "link" ? "届いたリンクでログインできます。" : "リンク先でパスワードを設定したら、ホーム画面のアプリに戻り、同じメールアドレスとパスワードでログインしてください。"}</p>
    </div> : <form className="auth-form" onSubmit={submit}>
      {mode !== "login" && <p className="auth-help">メモを保存していたメールアドレスを入力してください。新しいアカウントは作成しません。</p>}
      <label htmlFor="auth-email">メールアドレス</label>
      <input id="auth-email" type="email" autoComplete="username" autoCapitalize="none" spellCheck={false} value={email} onChange={e => setEmail(e.target.value)} required disabled={busy} />
      {mode === "login" && <>
        <label htmlFor="auth-password">パスワード</label>
        <input id="auth-password" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} required disabled={busy} />
      </>}
      <button className="primary-button" disabled={busy}>{busy ? "手続き中…" : mode === "login" ? "ログイン" : mode === "link" ? "ログイン用リンクを受け取る" : "設定用メールを受け取る"}</button>
    </form>}
    {error && <p className="error-text" role="alert">{error}</p>}
    <div className="auth-links">
      {mode === "login" ? <>
        <button disabled={busy} onClick={() => changeMode("setup")}>初めてパスワードを設定する</button>
        <button disabled={busy} onClick={() => changeMode("reset")}>パスワードを忘れた方</button>
        <button disabled={busy} onClick={() => changeMode("link")}>メールリンクでログインする</button>
      </> : <button disabled={busy} onClick={() => changeMode("login")}>ログイン画面に戻る</button>}
    </div>
  </AuthShell>;
};

export const PasswordForm = ({ client, session, onClose }: { client: SupabaseClient; session: Session; onClose: () => void }) => {
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [busy, setBusy] = useState(false);
  const lock = useRef(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const [mailSent, setMailSent] = useState(false);
  const sendRecovery = async () => {
    if (lock.current || !session.user.email) return;
    lock.current = true; setBusy(true); setError("");
    try {
      const result = await client.auth.resetPasswordForEmail(session.user.email, { redirectTo: authRedirect(window.location.href, true) });
      if (result.error) throw result.error;
      setMailSent(true);
    } catch (error) { setError(authErrorMessage(error)); }
    finally { lock.current = false; setBusy(false); }
  };
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (lock.current) return;
    const invalid = passwordError(password, confirmation);
    if (invalid) { setError(invalid); return; }
    lock.current = true; setBusy(true); setError("");
    try {
      await setExistingAccountPassword(client, session.user.id, password, confirmation);
      setPassword(""); setConfirmation(""); setSaved(true);
    } catch (error) { setError(authErrorMessage(error)); }
    finally { lock.current = false; setBusy(false); }
  };
  return <AuthShell>
    <h1>パスワードの設定</h1>
    <p className="auth-help">設定するアカウント：{session.user.email}</p>
    {saved ? <div className="auth-message" role="status">
      <strong>パスワードを設定しました</strong>
      <p>今までのメモと履歴はそのままです。ホーム画面のアプリでも、このメールアドレスとパスワードでログインできます。</p>
    </div> : <form className="auth-form" onSubmit={submit}>
      <p className="auth-help">今のアカウントのパスワードだけを設定します。8文字以上で、他のサービスと使い回していないものにしてください。</p>
      <input type="text" autoComplete="username" value={session.user.email ?? ""} readOnly hidden />
      <label htmlFor="new-password">新しいパスワード</label>
      <input id="new-password" type="password" autoComplete="new-password" minLength={8} required disabled={busy} value={password} onChange={e => setPassword(e.target.value)} />
      <label htmlFor="confirm-password">新しいパスワード（確認）</label>
      <input id="confirm-password" type="password" autoComplete="new-password" minLength={8} required disabled={busy} value={confirmation} onChange={e => setConfirmation(e.target.value)} />
      <button className="primary-button" disabled={busy}>{busy ? "設定中…" : "パスワードを設定する"}</button>
    </form>}
    {error && <p className="error-text" role="alert">{error}</p>}
    {mailSent && <p className="auth-help" role="status">設定用メールを送りました。届いたリンクから本人確認して、パスワードを設定してください。</p>}
    <div className="auth-links">
      {!saved && <button disabled={busy || mailSent} onClick={() => void sendRecovery()}>設定用メールを受け取る</button>}
      <button disabled={busy} onClick={onClose}>{saved ? "保管庫を開く" : "設定せずに戻る"}</button>
    </div>
  </AuthShell>;
};

export const AuthGate = ({ client, initialReturn, children }: {
  client: SupabaseClient; initialReturn: AuthReturn; children: (openSettings: () => void) => ReactNode;
}) => {
  const [session, setSession] = useState<Session | null | undefined>(undefined);
  const [recovery, setRecovery] = useState(initialReturn.password);
  const [settings, setSettings] = useState(false);
  const [failed, setFailed] = useState(initialReturn.failed);
  useEffect(() => {
    // Subscribe before initialization completes; never call async Auth APIs inside this callback.
    const { data } = client.auth.onAuthStateChange((event, next) => {
      if (event === "PASSWORD_RECOVERY") { setRecovery(true); setFailed(false); }
      setSession(next);
      if (!next) setSettings(false);
    });
    return () => data.subscription.unsubscribe();
  }, [client]);
  const close = () => {
    window.history.replaceState(null, "", authRedirect(window.location.href));
    setRecovery(false); setSettings(false); setFailed(false);
  };
  if (session === undefined) return <AuthShell><p role="status">ログイン状態を確認しています…</p></AuthShell>;
  if (failed) return <AuthShell>
    <p role="alert">リンクが無効か、有効期限が切れています。もう一度メールを受け取ってください。</p>
    <button className="primary-button" onClick={close}>戻る</button>
  </AuthShell>;
  if (!session) return <LoginForm client={client} initialError={recovery ? "設定用リンクを確認できませんでした。もう一度、設定用メールを受け取ってください。" : ""} />;
  return <>
    {(recovery || settings) && <PasswordForm key={`password-${session.user.id}`} client={client} session={session} onClose={close} />}
    {!recovery && <div key={`memos-${session.user.id}`} hidden={settings}>{children(() => setSettings(true))}</div>}
  </>;
};

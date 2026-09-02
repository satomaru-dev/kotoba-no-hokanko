import { act, createElement, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import type { AuthChangeEvent, Session, SupabaseClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthGate, LoginForm, PasswordForm } from "./AuthGate";
import { authRedirect, passwordError, readAuthReturn, setExistingAccountPassword } from "./auth";

const session = { user: { id: "existing-owner", email: "test@example.com" } } as Session;
const password = "a-long-test-password";
const mockClient = () => {
  let listener: (event: AuthChangeEvent, session: Session | null) => void = () => {};
  const auth = {
    getUser: vi.fn().mockResolvedValue({ data: { user: session.user }, error: null }),
    updateUser: vi.fn().mockResolvedValue({ data: { user: session.user }, error: null }),
    signInWithPassword: vi.fn().mockResolvedValue({ data: { session }, error: null }),
    signInWithOtp: vi.fn().mockResolvedValue({ error: null }),
    resetPasswordForEmail: vi.fn().mockResolvedValue({ error: null }),
    onAuthStateChange: vi.fn((callback: typeof listener) => {
      listener = callback;
      return { data: { subscription: { unsubscribe: vi.fn() } } };
    })
  };
  return { auth, client: { auth } as unknown as SupabaseClient, emit: (event: AuthChangeEvent, value: Session | null) => listener(event, value) };
};

let container: HTMLDivElement;
let root: Root;
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  window.history.replaceState(null, "", "/");
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); });
const render = async (element: ReturnType<typeof createElement>) => { await act(async () => root.render(element)); };
const input = async (id: string, value: string) => {
  const element = container.querySelector<HTMLInputElement>(`#${id}`)!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
};
const click = async (text: string) => {
  const button = [...container.querySelectorAll("button")].find(b => b.textContent === text)!;
  expect(button).toBeTruthy();
  await act(async () => button.click());
};
const submit = async () => {
  await act(async () => { container.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })); });
};

describe("existing-account password authentication", () => {
  it("keeps the Pages path and removes tokens/unrelated query parameters from email redirects", () => {
    expect(authRedirect("https://example.com/kotoba/?memo=1#access_token=secret", true)).toBe("https://example.com/kotoba/?auth=password");
    expect(authRedirect("https://example.com/kotoba/?auth=password#x")).toBe("https://example.com/kotoba/");
    expect(readAuthReturn("https://example.com/?auth=password#type=recovery")).toEqual({ password: true, failed: false });
    expect(readAuthReturn("https://example.com/#error=access_denied").failed).toBe(true);
  });
  it("requires a long matching password without trimming it", () => {
    expect(passwordError("short", "short")).not.toBe("");
    expect(passwordError(password, password + " ")).not.toBe("");
    expect(passwordError(" " + password, " " + password)).toBe("");
  });
  it("updates only the password of the verified existing account, never any memo or owner ID", async () => {
    const { client, auth } = mockClient();
    await setExistingAccountPassword(client, session.user.id, password, password);
    expect(auth.getUser).toHaveBeenCalledOnce();
    expect(auth.updateUser).toHaveBeenCalledExactlyOnceWith({ password });
  });
  it("does not update when verification fails or the account has changed", async () => {
    const { client, auth } = mockClient();
    await expect(setExistingAccountPassword(client, "different-owner", password, password)).rejects.toThrow();
    auth.getUser.mockResolvedValue({ data: { user: null }, error: { code: "session_not_found" } });
    await expect(setExistingAccountPassword(client, session.user.id, password, password)).rejects.toBeTruthy();
    expect(auth.updateUser).not.toHaveBeenCalled();
  });
  it("logs in inside the app using password, without sending email", async () => {
    const { client, auth } = mockClient();
    await render(createElement(LoginForm, { client }));
    await input("auth-email", "test@example.com"); await input("auth-password", password); await submit();
    expect(auth.signInWithPassword).toHaveBeenCalledWith({ email: "test@example.com", password });
    expect(auth.signInWithOtp).not.toHaveBeenCalled(); expect(auth.resetPasswordForEmail).not.toHaveBeenCalled();
  });
  it("handles wrong passwords without displaying raw server error text", async () => {
    const { client, auth } = mockClient();
    auth.signInWithPassword.mockResolvedValue({ error: { code: "invalid_credentials", message: "secret detail" } });
    await render(createElement(LoginForm, { client })); await submit();
    expect(container.textContent).toContain("メールアドレスかパスワードを確認");
    expect(container.textContent).not.toContain("secret detail");
  });
  it.each(["初めてパスワードを設定する", "パスワードを忘れた方"])("uses existing-user recovery for %s", async (label) => {
    const { client, auth } = mockClient();
    await render(createElement(LoginForm, { client })); await click(label);
    await input("auth-email", "test@example.com"); await submit();
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith("test@example.com", { redirectTo: "http://localhost:3000/?auth=password" });
    expect(container.textContent).toContain("ホーム画面のアプリに戻り");
  });
  it("retains magic links but explicitly disables creating accounts", async () => {
    const { client, auth } = mockClient();
    await render(createElement(LoginForm, { client })); await click("メールリンクでログインする");
    await input("auth-email", "test@example.com"); await submit();
    expect(auth.signInWithOtp).toHaveBeenCalledWith({ email: "test@example.com", options: { shouldCreateUser: false, emailRedirectTo: "http://localhost:3000/" } });
  });
  it("does not save invalid confirmation, and keeps the form open on network failure", async () => {
    const { client, auth } = mockClient(); const onClose = vi.fn();
    await render(createElement(PasswordForm, { client, session, onClose }));
    await input("new-password", password); await input("confirm-password", "not-matching"); await submit();
    expect(auth.getUser).not.toHaveBeenCalled();
    auth.updateUser.mockRejectedValue(new Error("network failure"));
    await input("confirm-password", password); await submit();
    expect(container.querySelector("form")).not.toBeNull(); expect(onClose).not.toHaveBeenCalled();
    expect(container.textContent).toContain("通信を確認");
  });
  it("shows success only after the password update succeeds", async () => {
    const { client, auth } = mockClient();
    await render(createElement(PasswordForm, { client, session, onClose: vi.fn() }));
    await input("new-password", password); await input("confirm-password", password); await submit();
    expect(auth.updateUser).toHaveBeenCalledOnce();
    expect(container.textContent).toContain("パスワードを設定しました");
    expect(container.querySelector('input[type="password"]')).toBeNull();
  });
  it("offers recovery for the same account if password change requires fresh verification", async () => {
    const { client, auth } = mockClient();
    auth.updateUser.mockResolvedValue({ error: { code: "reauthentication_needed" } });
    await render(createElement(PasswordForm, { client, session, onClose: vi.fn() }));
    await input("new-password", password); await input("confirm-password", password); await submit();
    await click("設定用メールを受け取る");
    expect(auth.resetPasswordForEmail).toHaveBeenCalledWith(session.user.email, { redirectTo: "http://localhost:3000/?auth=password" });
    expect(container.textContent).toContain("届いたリンクから本人確認");
  });
  it("gates recovery before mounting the memo app, including after a reload", async () => {
    const mock = mockClient(); const child = vi.fn(() => createElement("p", null, "memo-app"));
    await render(createElement(AuthGate, { client: mock.client, initialReturn: { password: true, failed: false }, children: child }));
    await act(async () => mock.emit("INITIAL_SESSION", session));
    expect(child).not.toHaveBeenCalled(); expect(container.textContent).toContain("パスワードの設定");
    await act(async () => mock.emit("USER_UPDATED", session));
    expect(child).not.toHaveBeenCalled();
    await click("設定せずに戻る"); expect(container.textContent).toContain("memo-app");
  });
  it("opens recovery on the Auth event and preserves existing drafts when opening ordinary settings", async () => {
    const mock = mockClient();
    const Draft = ({ open }: { open: () => void }) => {
      const [value, setValue] = useState("");
      return createElement("section", null, createElement("input", { id: "draft", value, onChange: (e: { target: { value: string } }) => setValue(e.target.value) }), createElement("button", { onClick: open }, "settings"));
    };
    await render(createElement(AuthGate, { client: mock.client, initialReturn: { password: false, failed: false }, children: open => createElement(Draft, { open }) }));
    await act(async () => mock.emit("INITIAL_SESSION", session));
    await input("draft", "unsaved memo"); await click("settings"); await click("設定せずに戻る");
    expect(container.querySelector<HTMLInputElement>("#draft")!.value).toBe("unsaved memo");
    await act(async () => mock.emit("PASSWORD_RECOVERY", session));
    expect(container.querySelector("#draft")).toBeNull(); expect(container.textContent).toContain("パスワードの設定");
  });
  it("handles expired recovery links without calling updateUser", async () => {
    const mock = mockClient();
    await render(createElement(AuthGate, { client: mock.client, initialReturn: { password: true, failed: true }, children: () => "memo-app" }));
    await act(async () => mock.emit("INITIAL_SESSION", null));
    expect(container.textContent).toContain("有効期限が切れています");
    await click("戻る"); expect(container.textContent).toContain("初めてパスワードを設定する");
    expect(mock.auth.updateUser).not.toHaveBeenCalled();
  });
});

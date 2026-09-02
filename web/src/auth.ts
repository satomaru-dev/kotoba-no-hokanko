import type { SupabaseClient } from "@supabase/supabase-js";

export const readAuthReturn = (href: string) => {
  const url = new URL(href);
  const hash = new URLSearchParams(url.hash.slice(1));
  return {
    password: url.searchParams.get("auth") === "password" || hash.get("type") === "recovery",
    failed: hash.has("error") || url.searchParams.has("error")
  };
};

export const authRedirect = (href: string, password = false): string => {
  const url = new URL(href);
  url.hash = "";
  url.search = "";
  if (password) url.searchParams.set("auth", "password");
  return url.toString();
};

export const passwordError = (password: string, confirmation: string): string => {
  if (password.length < 8) return "パスワードは8文字以上にしてください。";
  if (password !== confirmation) return "確認用のパスワードが一致していません。";
  return "";
};

export const authErrorMessage = (error: unknown): string => {
  const code = (error as { code?: string } | null)?.code;
  if (code === "invalid_credentials") return "メールアドレスかパスワードを確認してください。未設定の場合は「初めてパスワードを設定する」へ進んでください。";
  if (code === "over_email_send_rate_limit" || code === "over_request_rate_limit") return "試行回数の上限に達しました。少し時間をおいてお試しください。";
  if (code === "weak_password") return "そのパスワードは使用できません。より長く、使い回していないものに変更してください。";
  if (code === "same_password") return "現在とは異なるパスワードを入力してください。";
  if (code === "email_not_confirmed") return "メールでの本人確認を完了してください。";
  if (code === "reauthentication_needed" || code === "session_not_found") return "本人確認が必要です。設定用メールを受け取って、リンクからやり直してください。";
  return "手続きを完了できませんでした。通信を確認して、もう一度お試しください。";
};

// Never sign up, change email/owner IDs, or touch memo tables in this flow.
export const setExistingAccountPassword = async (
  client: SupabaseClient, expectedUserId: string, password: string, confirmation: string
): Promise<void> => {
  const invalid = passwordError(password, confirmation);
  if (invalid) throw new Error(invalid);
  const { data, error } = await client.auth.getUser();
  if (error) throw error;
  if (!data.user || data.user.id !== expectedUserId) throw new Error("account_changed");
  const result = await client.auth.updateUser({ password });
  if (result.error) throw result.error;
};

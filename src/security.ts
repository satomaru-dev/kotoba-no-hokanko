import path from "node:path";

const DEFAULT_DENY_PATTERNS = [
  /(^|[\\/])\.env($|[\\/])/i,
  /password|passwd|credential|secret|token/i,
  /パスワード|認証情報|顧客|契約|被保険者|金融明細|口座|クレジット/i,
  /\.csv$/i
];

export const containsSensitivePath = (
  filePath: string,
  extraPatterns: RegExp[] = []
): boolean => {
  const normalized = path.normalize(filePath);
  return [...DEFAULT_DENY_PATTERNS, ...extraPatterns].some((pattern) =>
    pattern.test(normalized)
  );
};

const SECRET_TEXT_PATTERNS = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/i,
  /\bsk-[A-Za-z0-9_-]{20,}\b/,
  /\bAIza[0-9A-Za-z_-]{25,}\b/,
  /\b(?:password|passwd|api[_-]?key|client[_-]?secret)\s*[:=]\s*\S+/i
];

export const containsLikelySecret = (text: string): boolean =>
  SECRET_TEXT_PATTERNS.some((pattern) => pattern.test(text));

export const assertAuthorized = (
  authorization: string | undefined,
  expectedToken: string | null
): boolean => {
  if (!expectedToken) return process.env.NODE_ENV !== "production";
  if (!authorization?.startsWith("Bearer ")) return false;
  const supplied = authorization.slice("Bearer ".length);
  if (supplied.length !== expectedToken.length) return false;
  let difference = 0;
  for (let index = 0; index < supplied.length; index += 1) {
    difference |= supplied.charCodeAt(index) ^ expectedToken.charCodeAt(index);
  }
  return difference === 0;
};

export function redactToken(token?: string): string | undefined {
  if (!token) {
    return undefined;
  }
  if (token.length <= 8) {
    return `${token[0]}…`;
  }
  return `${token.slice(0, 3)}…${token.slice(-3)}`;
}

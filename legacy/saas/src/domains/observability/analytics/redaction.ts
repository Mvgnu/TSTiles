function redactUrlParams(value: string): string {
  return value
    .replace(/([?&](?:access_token|token)=)[^&#]*/gi, "$1[redacted]")
    .replace(/([?&](?:x-amz-signature|signature)=)[^&#]*/gi, "$1[redacted]")
    .replace(/([?&](?:x-amz-credential|credential)=)[^&#]*/gi, "$1[redacted]")
    .replace(/([?&](?:x-amz-security-token|security_token)=)[^&#]*/gi, "$1[redacted]");
}

function redactFragment(value: string): string {
  const fragmentIndex = value.indexOf("#");
  if (fragmentIndex < 0) {
    return value;
  }
  return `${value.slice(0, fragmentIndex)}#[redacted]`;
}

function isSensitiveHeader(name: string): boolean {
  return name === "authorization"
    || name.includes("token")
    || name.includes("api-key")
    || name.includes("secret")
    || name === "cookie"
    || name === "set-cookie";
}

export function redactHeaders(input: Record<string, string>): Record<string, string> {
  const output: Record<string, string> = {};
  for (const [name, value] of Object.entries(input)) {
    const lower = name.toLowerCase();
    if (isSensitiveHeader(lower)) {
      output[name] = "[redacted]";
    } else {
      output[name] = redactFragment(redactUrlParams(value));
    }
  }
  return output;
}

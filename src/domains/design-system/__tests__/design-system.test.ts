import { describe, expect, it } from "vitest";
import {
  escapeHtml,
  renderBanner,
  renderCodeCard,
  renderInput,
  renderUniversalHeader,
} from "../components";
import { getGlobalCss } from "../styles";

describe("design-system boundary", () => {
  it("escapes text in code and status output", () => {
    const payload = '<img src=x onerror="alert(1)">';
    expect(escapeHtml(payload)).toBe("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
    expect(renderBanner(payload, "danger")).not.toContain("<img");
    expect(renderCodeCard({ label: payload, language: "html", code: payload })).not.toContain("<img");
  });

  it("renders deterministic, linked input descriptions without random IDs", () => {
    const first = renderInput("Email", "account[email]", {
      hint: "Used for notices",
      error: "Check the address",
      required: true,
    });
    const second = renderInput("Email", "account[email]", {
      hint: "Used for notices",
      error: "Check the address",
      required: true,
    });

    expect(first).toBe(second);
    expect(first).toMatch(/id="ds-input-account-email-[a-z0-9]+"/);
    expect(first).toContain('aria-invalid="true"');
    expect(first).toMatch(/aria-describedby="ds-input-account-email-[a-z0-9]+-hint ds-input-account-email-[a-z0-9]+-error"/);
    expect(first).not.toContain("Math.random");
  });

  it("escapes caller-provided input identifiers and values", () => {
    const html = renderInput("Token", 'token" autofocus', {
      id: 'token" data-bad="true',
      value: '<secret>&"',
    });
    expect(html).toContain('for="token&quot; data-bad=&quot;true"');
    expect(html).toContain('name="token&quot; autofocus"');
    expect(html).toContain('value="&lt;secret&gt;&amp;&quot;"');
    expect(html).not.toContain('data-bad="true"');
  });

  it("provides a first-focus skip link and current-page navigation state", () => {
    const html = renderUniversalHeader("docs");
    expect(html.trim().startsWith('<a class="ds-skip-link"')).toBe(true);
    expect(html).toContain('href="#main-content"');
    expect(html).toContain('href="/docs" data-active="true" aria-current="page"');
  });

  it("contains global layout, focus, contrast, and motion invariants", () => {
    const css = getGlobalCss();
    expect(css).toContain(":where(main, section, article, aside, header, footer, nav, div) { min-width: 0; }");
    expect(css).toContain(":where(img, video) { max-width: 100%; height: auto; }");
    expect(css).toContain("font-size: max(0.875rem, 14px) !important;");
    expect(css).toContain("pre code { display: block; min-width: max-content; }");
    expect(css).toContain("outline: 2px solid var(--accent);");
    expect(css).toContain("@media (prefers-reduced-motion: reduce)");
    expect(css).toContain("--accent: #818CF8");
    expect(css).not.toContain("outline: none");
  });
});

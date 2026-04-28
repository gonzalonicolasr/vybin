// Markdown renderer for cero's assistant messages.
// - GFM (tables, task lists, strikethrough) via remark-gfm.
// - Code blocks with shiki syntax highlighting (loaded async per-language
//   so we don't ship 100s of grammars upfront).
// - Inline code styled to match the violet/amber palette of v5.
//
// Renders incrementally — react-markdown re-parses on every text-delta,
// so partial markdown during streaming shows up gracefully (e.g. an
// incomplete fence renders as plain code until the closing ``` arrives).
//
// ─── XSS / security audit (F6-C) ───────────────────────────────────────────
// Trust boundaries are as follows:
//
//   1. ReactMarkdown (no rehype-raw plugin): all text nodes are React-escaped.
//      Raw HTML in LLM output (e.g. `<img onerror="...">`) is rendered as
//      escaped text, NOT as DOM elements. This is the default safe behavior
//      and must not be changed without a security review.
//
//   2. shiki `codeToHtml`: receives the literal code string extracted by
//      ReactMarkdown (which already stripped any enclosing HTML). shiki
//      HTML-escapes all token text before building its output string.
//      The resulting HTML only contains shiki-controlled span/pre/code tags
//      with CSS class names and inline color styles — no user-supplied
//      attribute values reach the DOM as HTML.
//      The dangerouslySetInnerHTML below is therefore safe for shiki's output.
//
//   3. If rehype-raw or any plugin that allows raw HTML passthrough is ever
//      added, a DOMPurify sanitization pass MUST be added before setting
//      dangerouslySetInnerHTML, and this comment must be updated.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useState, memo } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { BundledLanguage, BundledTheme } from "shiki";

const SHIKI_THEME: BundledTheme = "github-dark-default";

// Languages we lazy-load on demand. The set covers what cero typically
// produces: TypeScript/JS, Python, JSON, shell, markdown, SQL, Go, Rust.
// Anything else falls back to plain pre/code (no highlighting).
const SUPPORTED_LANGS: ReadonlySet<BundledLanguage> = new Set<BundledLanguage>([
  "typescript",
  "tsx",
  "javascript",
  "jsx",
  "json",
  "bash",
  "sh",
  "shell",
  "powershell",
  "python",
  "rust",
  "go",
  "sql",
  "yaml",
  "toml",
  "markdown",
  "html",
  "css",
  "diff",
]);

// Module-singleton highlighter — created on first use, reused after.
let highlighterPromise: Promise<unknown> | null = null;
async function getHighlighter() {
  if (!highlighterPromise) {
    highlighterPromise = (async () => {
      const { createHighlighter } = await import("shiki");
      return createHighlighter({
        themes: [SHIKI_THEME],
        langs: [],
      });
    })();
  }
  return highlighterPromise as Promise<{
    codeToHtml(code: string, opts: { lang: BundledLanguage | "text"; theme: BundledTheme }): string;
    loadLanguage(lang: BundledLanguage): Promise<void>;
    getLoadedLanguages(): string[];
  }>;
}

interface CodeBlockProps {
  readonly code: string;
  readonly lang: string | undefined;
}

function CodeBlock({ code, lang }: CodeBlockProps): React.JSX.Element {
  const [html, setHtml] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async (): Promise<void> => {
      try {
        const hl = await getHighlighter();
        const useLang =
          lang && SUPPORTED_LANGS.has(lang as BundledLanguage)
            ? (lang as BundledLanguage)
            : null;
        if (useLang && !hl.getLoadedLanguages().includes(useLang)) {
          await hl.loadLanguage(useLang);
        }
        const out = hl.codeToHtml(code, {
          lang: useLang ?? "text",
          theme: SHIKI_THEME,
        });
        if (!cancelled) setHtml(out);
      } catch {
        // fall back to plain code below
      }
    })();
    return (): void => {
      cancelled = true;
    };
  }, [code, lang]);

  const handleCopy = async (): Promise<void> => {
    try {
      await navigator.clipboard.writeText(code);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard API may be unavailable; fail silently
    }
  };

  // Decide whether the "open in browser" button is meaningful for this lang.
  // HTML / SVG render natively; everything else opens as plain text in a tab.
  const openableLangs = new Set(["html", "htm", "xhtml", "svg"]);
  const canOpenInBrowser = lang ? openableLangs.has(lang.toLowerCase()) : false;

  const handleOpen = async (): Promise<void> => {
    try {
      const [{ writeTextFile, BaseDirectory, mkdir, exists }, { open }, pathMod] = await Promise.all([
        import("@tauri-apps/plugin-fs"),
        import("@tauri-apps/plugin-shell"),
        import("@tauri-apps/api/path"),
      ]);
      const dir = ".cero/temp";
      try {
        const has = await exists(dir, { baseDir: BaseDirectory.Home });
        if (!has) await mkdir(dir, { baseDir: BaseDirectory.Home, recursive: true });
      } catch (e) {
        if (import.meta.env.DEV) console.debug("[code-open] mkdir non-fatal", e);
      }
      const ext = lang?.toLowerCase() === "svg" ? "svg" : "html";
      const fname = `${dir}/cero-${Date.now()}.${ext}`;
      await writeTextFile(fname, code, { baseDir: BaseDirectory.Home });
      // Build the absolute file path. shell.open accepts native paths
      // directly — no file:// URL wrapping needed (and that wrapping was
      // failing the capability allowlist on Windows path-separator quirks).
      const home = await pathMod.homeDir();
      const fullPath = await pathMod.join(home, fname.replace(/\//g, pathMod.sep));
      if (import.meta.env.DEV) console.debug("[code-open] opening", fullPath);
      await open(fullPath);
    } catch (err) {
      console.error("[code-open] failed", err);
      // Fallback: copy to clipboard so user has something
      try { await navigator.clipboard.writeText(code); } catch { /* */ }
    }
  };

  return (
    <div className="md-codeblock">
      <div className="md-codeblock-header">
        <span className="md-codeblock-lang">{lang ?? "text"}</span>
        <div className="md-codeblock-actions">
          {canOpenInBrowser ? (
            <button
              type="button"
              className="md-codeblock-open"
              onClick={() => void handleOpen()}
              title={`Open ${lang} in default browser`}
              aria-label="Open in browser"
            >
              ↗ open
            </button>
          ) : null}
          <button
            type="button"
            className={`md-codeblock-copy${copied ? " copied" : ""}`}
            onClick={() => void handleCopy()}
            title="Copy code"
            aria-label="Copy code"
          >
            {copied ? "✓ copied" : "⎘ copy"}
          </button>
        </div>
      </div>
      {html ? (
        <div
          className="md-codeblock-body"
          // shiki output is sanitized; we trust it.
          // eslint-disable-next-line react/no-danger
          dangerouslySetInnerHTML={{ __html: html }}
        />
      ) : (
        <pre className="md-codeblock-body md-codeblock-fallback">
          <code>{code}</code>
        </pre>
      )}
    </div>
  );
}

const MarkdownInner = ({ text }: { readonly text: string }): React.JSX.Element => (
  <ReactMarkdown
    remarkPlugins={[remarkGfm]}
    components={{
      code(props) {
        const { className, children } = props as {
          className?: string;
          children?: React.ReactNode;
        };
        const match = /language-(\w+)/.exec(className ?? "");
        const code = String(children ?? "").replace(/\n$/, "");
        // Inline code (no language) → keep small <code> styling
        if (!match && !code.includes("\n")) {
          return <code className="md-inline">{code}</code>;
        }
        return <CodeBlock code={code} lang={match?.[1]} />;
      },
      // pre is rendered inside CodeBlock; for inline-only markdown that
      // omits a code element, react-markdown still wraps in <pre>. We
      // unwrap to avoid double padding.
      pre({ children }) {
        return <>{children}</>;
      },
      a(props) {
        const { href, children } = props as { href?: string; children?: React.ReactNode };
        return (
          <a
            href={href ?? "#"}
            target="_blank"
            rel="noreferrer noopener"
            className="md-link"
          >
            {children}
          </a>
        );
      },
      table(props) {
        return <table className="md-table">{props.children}</table>;
      },
    }}
  >
    {text}
  </ReactMarkdown>
);

// memo so streaming updates only re-render when text actually changes.
export const Markdown = memo(MarkdownInner);

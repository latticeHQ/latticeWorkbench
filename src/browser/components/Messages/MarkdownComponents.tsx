import type { ReactNode } from "react";
import React, { useState, useEffect } from "react";
import { Play } from "lucide-react";
import { Mermaid } from "./Mermaid";
import { useOptionalMessageListContext } from "./MessageListContext";
import { highlightCode } from "@/browser/utils/highlighting/highlightWorkerClient";
import { extractShikiLines } from "@/browser/utils/highlighting/shiki-shared";
import { useTheme } from "@/browser/contexts/ThemeContext";
import { CopyButton } from "@/browser/components/ui/CopyButton";
import { useFileOpener } from "@/browser/contexts/FileOpenerContext";

interface CodeProps {
  node?: unknown;
  inline?: boolean;
  className?: string;
  children?: ReactNode;
}

interface PreProps {
  children?: ReactNode;
}

interface DetailsProps {
  children?: ReactNode;
  open?: boolean;
}

interface SummaryProps {
  children?: ReactNode;
}

interface AnchorProps {
  href?: string;
  children?: ReactNode;
}

const RUNNABLE_SHELL_LANGUAGES = new Set([
  "bash",
  "sh",
  "shell",
  "zsh",
  "fish",
  "powershell",
  "pwsh",
  "cmd",
  "batch",
]);

function normalizeSuggestedShellCommand(code: string): string {
  const lines = code.split("\n");

  // Trim leading/trailing blank lines (but preserve blank lines in the middle).
  while (lines.length > 0 && lines[0].trim() === "") {
    lines.shift();
  }
  while (lines.length > 0 && lines[lines.length - 1].trim() === "") {
    lines.pop();
  }

  let promptKind: "lattice" | "powershell" | "cmd" | null = null;

  return lines
    .map((line, idx) => {
      // Remove leading prompt characters (copy/paste friendly).
      // Examples:
      //   $ npm install
      //   $ cat <<EOF
      //   > line 1
      //   > EOF
      //   PS C:\Users\mike> npm install
      //   C:\Users\mike> npm install

      // Common Lattice shell prompt marker.
      if (/^\s*\$\s+/.test(line)) {
        promptKind = "lattice";
        return line.replace(/^\s*\$\s+/, "");
      }

      // PowerShell prompt marker.
      if (/^\s*PS(?:\s+[^>]+)?>\s*/.test(line)) {
        promptKind = "powershell";
        return line.replace(/^\s*PS(?:\s+[^>]+)?>\s*/, "");
      }

      // cmd.exe prompt marker.
      if (/^\s*[A-Za-z]:\\[^>]*>\s*/.test(line)) {
        promptKind = "cmd";
        return line.replace(/^\s*[A-Za-z]:\\[^>]*>\s*/, "");
      }

      // Avoid stripping leading `>` on the *first* line since it can be a valid
      // redirection operator (e.g. `> output.txt` truncates/creates a file).
      //
      // But if the snippet starts with a `$ ` prompt marker, then `> ` on subsequent
      // lines is usually a continuation prompt (PS2) and should be stripped.
      if (promptKind === "lattice" && idx > 0) {
        return line.replace(/^\s*>\s+/, "");
      }

      // cmd.exe continuation prompt is just `>` (space after is optional).
      if (promptKind === "cmd" && idx > 0) {
        return line.replace(/^\s*>\s*/, "");
      }

      // PowerShell uses `>>` for continuation lines.
      if (promptKind === "powershell" && idx > 0) {
        return line.replace(/^\s*>>\s+/, "");
      }

      return line;
    })
    .join("\n")
    .trim();
}

function isRunnableShellLanguage(language: string): boolean {
  return RUNNABLE_SHELL_LANGUAGES.has(language.toLowerCase());
}

interface CodeBlockProps {
  code: string;
  language: string;
  /**
   * Language id passed to Shiki. Allows us to keep a non-runnable “meta” language
   * (e.g. shell-session) while still getting reasonable highlighting.
   */
  highlightLanguage?: string;
}

/**
 * CodeBlock component with async Shiki highlighting
 * Displays code with line numbers in a CSS grid
 */
const CodeBlock: React.FC<CodeBlockProps> = ({ code, language, highlightLanguage }) => {
  const [highlightedLines, setHighlightedLines] = useState<string[] | null>(null);

  const shikiLanguage = highlightLanguage ?? language;
  const { theme: themeMode } = useTheme();

  // Split code into lines, removing trailing empty line
  const plainLines = code
    .split("\n")
    .filter((line, idx, arr) => idx < arr.length - 1 || line !== "");

  useEffect(() => {
    let cancelled = false;
    const isLight = themeMode === "light" || themeMode.endsWith("-light");
    const theme = isLight ? "light" : "dark";

    setHighlightedLines(null);

    async function highlight() {
      try {
        const html = await highlightCode(code, shikiLanguage, theme);

        if (!cancelled) {
          const lines = extractShikiLines(html);
          // Remove trailing empty line if present
          const filteredLines = lines.filter(
            (line, idx, arr) => idx < arr.length - 1 || line.trim() !== ""
          );
          setHighlightedLines(filteredLines.length > 0 ? filteredLines : null);
        }
      } catch (error) {
        console.warn(`Failed to highlight code block (${shikiLanguage}):`, error);
        if (!cancelled) setHighlightedLines(null);
      }
    }

    void highlight();
    return () => {
      cancelled = true;
    };
  }, [code, shikiLanguage, themeMode]);

  const messageListContext = useOptionalMessageListContext();
  const openTerminal = messageListContext?.openTerminal;
  const runnableCommand = isRunnableShellLanguage(language)
    ? normalizeSuggestedShellCommand(code)
    : "";
  const showRunButton = Boolean(openTerminal) && runnableCommand.length > 0;
  const lines = highlightedLines ?? plainLines;
  const isSingleLine = lines.length === 1;

  return (
    <div
      className={`code-block-wrapper${isSingleLine ? " code-block-single-line" : ""}${showRunButton ? " code-block-runnable" : ""}`}
    >
      <div className="code-block-container">
        {lines.map((content, idx) => (
          <React.Fragment key={idx}>
            <div className="line-number">{idx + 1}</div>
            {/* SECURITY AUDIT: dangerouslySetInnerHTML usage
             * Source: Shiki syntax highlighter (highlighter.codeToHtml)
             * Safety: Shiki escapes all user content before wrapping in <span> tokens
             * Data flow: User markdown → react-markdown → code prop → Shiki → extractShikiLines → here
             * Verification: Shiki's codeToHtml tokenizes and escapes HTML entities in code content
             * Risk: Low - Shiki is a trusted library that properly escapes user input
             * Alternative considered: Render Shiki's full <code> block, but per-line rendering
             *   required for line numbers in CSS grid layout
             */}
            <div
              className="code-line"
              {...(highlightedLines
                ? { dangerouslySetInnerHTML: { __html: content } }
                : { children: <code>{content}</code> })}
            />
          </React.Fragment>
        ))}
      </div>
      {showRunButton ? (
        <button
          type="button"
          className="copy-button code-run-button"
          aria-label="Run command"
          onClick={() => openTerminal?.({ initialCommand: runnableCommand })}
        >
          <Play className="copy-icon" />
        </button>
      ) : null}
      <CopyButton text={code} className="code-copy-button" />
    </div>
  );
};

/**
 * Common file extensions that indicate a path is a file (not a shell command or variable).
 */
const FILE_EXTENSIONS = new Set([
  "pdf",
  "doc",
  "docx",
  "xls",
  "xlsx",
  "ppt",
  "pptx",
  "txt",
  "md",
  "json",
  "yaml",
  "yml",
  "toml",
  "xml",
  "csv",
  "ts",
  "tsx",
  "js",
  "jsx",
  "py",
  "rb",
  "go",
  "rs",
  "java",
  "c",
  "cpp",
  "h",
  "hpp",
  "html",
  "css",
  "scss",
  "less",
  "svg",
  "png",
  "jpg",
  "jpeg",
  "gif",
  "webp",
  "ico",
  "sh",
  "bash",
  "zsh",
  "fish",
  "env",
  "gitignore",
  "lock",
  "log",
]);

/**
 * Detect if inline code text looks like a file path.
 * Matches patterns like: file.ext, path/to/file, ./relative, ../parent, /absolute
 */
function looksLikeFilePath(text: string): boolean {
  const trimmed = text.trim();
  // Must not be empty or contain spaces (likely a command)
  if (!trimmed || trimmed.includes(" ")) return false;
  // Check if it has a recognized file extension
  const lastDot = trimmed.lastIndexOf(".");
  if (lastDot > 0) {
    const ext = trimmed.slice(lastDot + 1).toLowerCase();
    if (FILE_EXTENSIONS.has(ext)) return true;
  }
  // Check if it looks like an explicit path (has slashes and no spaces)
  if (
    (trimmed.includes("/") || trimmed.startsWith("./") || trimmed.startsWith("../")) &&
    !trimmed.includes(" ")
  ) {
    // Must have at least one segment that looks like a filename
    const segments = trimmed.split("/").filter(Boolean);
    if (segments.length > 0) {
      const lastSegment = segments[segments.length - 1];
      // Last segment should contain a dot (file.ext) or be a reasonable filename
      if (lastSegment.includes(".")) return true;
    }
  }
  return false;
}

/**
 * Extract the relative path from inline code text.
 * Strips absolute path prefixes to get a workspace-relative path.
 */
function extractRelativePath(text: string): string {
  let path = text.trim();
  // If it's an absolute path, try to extract the filename or relative portion
  // The sidebar's handleOpenFile expects a relative path
  if (path.startsWith("/")) {
    // Just use the filename - the file viewer will handle it
    const lastSlash = path.lastIndexOf("/");
    if (lastSlash >= 0) {
      return path.slice(lastSlash + 1);
    }
  }
  return path;
}

/**
 * InlineCode component that detects file paths and makes them clickable.
 */
const InlineCode: React.FC<CodeProps> = ({ className, children, node, ...props }) => {
  const { openFile } = useFileOpener();
  const childString =
    typeof children === "string" ? children : Array.isArray(children) ? children.join("") : "";

  if (looksLikeFilePath(childString)) {
    const relativePath = extractRelativePath(childString);
    return (
      <code
        className={`${className ?? ""} cursor-pointer hover:underline hover:text-accent transition-colors`}
        onClick={(e) => {
          e.stopPropagation();
          openFile(relativePath);
        }}
        title={`Open ${relativePath}`}
        {...props}
      >
        {children}
      </code>
    );
  }

  return (
    <code className={className} {...props}>
      {children}
    </code>
  );
};

// Custom components for markdown rendering
export const markdownComponents = {
  // Pass through pre element - let code component handle the wrapping
  pre: ({ children }: PreProps) => <>{children}</>,

  // Custom anchor to open links externally
  a: ({ href, children }: AnchorProps) => (
    <a href={href} target="_blank" rel="noopener noreferrer">
      {children}
    </a>
  ),

  // Custom details/summary for collapsible sections
  details: ({ children, open }: DetailsProps) => (
    <details
      open={open}
      className="bg-code-bg my-2 rounded border border-white/10 px-2 py-1 text-sm"
    >
      {children}
    </details>
  ),

  summary: ({ children }: SummaryProps) => (
    <summary className="cursor-pointer py-1 pl-1 font-semibold select-none">{children}</summary>
  ),

  // Custom code block renderer with async Shiki highlighting
  code: ({ inline, className, children, node, ...props }: CodeProps) => {
    const match = /language-([^\s]+)/.exec(className ?? "");
    const language = match ? match[1] : "";

    // Extract text content
    const childString =
      typeof children === "string" ? children : Array.isArray(children) ? children.join("") : "";
    const hasMultipleLines = childString.includes("\n");
    const isInline = inline ?? !hasMultipleLines;

    // Handle mermaid diagrams specially
    if (!isInline && language === "mermaid") {
      return <Mermaid chart={childString} />;
    }

    // Code blocks with language - use async Shiki highlighting
    if (!isInline && language) {
      const highlightLanguage = language === "shell-session" ? "shell" : language;
      return (
        <CodeBlock code={childString} language={language} highlightLanguage={highlightLanguage} />
      );
    }

    // Code blocks without language (global CSS provides styling)
    if (!isInline) {
      return (
        <pre>
          <code className={className} {...props}>
            {children}
          </code>
        </pre>
      );
    }

    // Inline code - detect file paths and make them clickable
    return <InlineCode className={className} children={children} node={node} {...props} />;
  },
};

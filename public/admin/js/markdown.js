/**
 * Browser-side Markdown parser and Block<->Markdown converter for CFPress Admin SPA.
 * Pure ESM module, zero external dependencies.
 */

function escapeHtml(text) {
  return String(text || "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeUrl(url) {
  const trimmed = String(url || "").trim();
  if (/^(?:javascript|data|vbscript):/i.test(trimmed)) {
    return "#";
  }
  return escapeHtml(trimmed);
}

/** Render inline Markdown elements: code, links, images, bold, italic, strikethrough */
export function renderInline(text) {
  let out = "";
  let i = 0;
  const str = String(text || "");
  const len = str.length;

  while (i < len) {
    // 1. Inline code: `code`
    if (str[i] === "`") {
      const close = str.indexOf("`", i + 1);
      if (close !== -1) {
        const codeContent = str.slice(i + 1, close);
        out += `<code>${escapeHtml(codeContent)}</code>`;
        i = close + 1;
        continue;
      }
    }

    // 2. Images: ![alt](url "title")
    if (str[i] === "!" && str[i + 1] === "[") {
      const altEnd = str.indexOf("]", i + 2);
      if (altEnd !== -1 && str[altEnd + 1] === "(") {
        const urlEnd = str.indexOf(")", altEnd + 2);
        if (urlEnd !== -1) {
          const alt = str.slice(i + 2, altEnd);
          const rawUrl = str.slice(altEnd + 2, urlEnd).trim();
          const parts = rawUrl.split(/\s+"([^"]+)"$/);
          const src = sanitizeUrl(parts[0] || "");
          const titleAttr = parts[1] ? ` title="${escapeHtml(parts[1])}"` : "";
          out += `<img src="${src}" alt="${escapeHtml(alt)}"${titleAttr} loading="lazy">`;
          i = urlEnd + 1;
          continue;
        }
      }
    }

    // 3. Links: [text](url "title")
    if (str[i] === "[") {
      const textEnd = str.indexOf("]", i + 1);
      if (textEnd !== -1 && str[textEnd + 1] === "(") {
        let depth = 1;
        let urlEnd = -1;
        for (let j = textEnd + 2; j < len; j++) {
          if (str[j] === "(") depth++;
          else if (str[j] === ")") {
            depth--;
            if (depth === 0) {
              urlEnd = j;
              break;
            }
          }
        }
        if (urlEnd !== -1) {
          const linkText = str.slice(i + 1, textEnd);
          const rawUrl = str.slice(textEnd + 2, urlEnd).trim();
          const parts = rawUrl.split(/\s+"([^"]+)"$/);
          const href = sanitizeUrl(parts[0] || "");
          const titleAttr = parts[1] ? ` title="${escapeHtml(parts[1])}"` : "";
          out += `<a href="${href}"${titleAttr} target="_blank" rel="noopener noreferrer">${renderInline(linkText)}</a>`;
          i = urlEnd + 1;
          continue;
        }
      }
    }

    // 4. Strikethrough: ~~text~~
    if (str[i] === "~" && str[i + 1] === "~") {
      const end = str.indexOf("~~", i + 2);
      if (end !== -1) {
        const inner = str.slice(i + 2, end);
        out += `<del>${renderInline(inner)}</del>`;
        i = end + 2;
        continue;
      }
    }

    // 5. Bold & Italic
    if ((str[i] === "*" && str[i + 1] === "*") || (str[i] === "_" && str[i + 1] === "_")) {
      const delim = str.slice(i, i + 2);
      const end = str.indexOf(delim, i + 2);
      if (end !== -1) {
        const inner = str.slice(i + 2, end);
        out += `<strong>${renderInline(inner)}</strong>`;
        i = end + 2;
        continue;
      }
    }

    // Italic: *text* or _text_ (with intra-word underscore protection per GFM)
    if (str[i] === "*" || str[i] === "_") {
      const delim = str[i];
      const isWordPrev = i > 0 && /\w/.test(str[i - 1]);
      if (delim === "_" && isWordPrev) {
        // intra-word underscore, treat as literal
      } else {
        const end = str.indexOf(delim, i + 1);
        if (end !== -1 && end > i + 1 && str[i + 1] !== " ") {
          const isWordNext = end + 1 < len && /\w/.test(str[end + 1]);
          if (delim === "_" && isWordNext) {
            // intra-word closing, treat as literal
          } else {
            const inner = str.slice(i + 1, end);
            out += `<em>${renderInline(inner)}</em>`;
            i = end + 1;
            continue;
          }
        }
      }
    }

    const char = str[i];
    if (char === "&") out += "&amp;";
    else if (char === "<") out += "&lt;";
    else if (char === ">") out += "&gt;";
    else if (char === '"') out += "&quot;";
    else if (char === "'") out += "&#39;";
    else out += char;
    i++;
  }

  return out;
}

/** Render full Markdown string to HTML */
export function renderMarkdown(md) {
  if (!md || typeof md !== "string") return "";

  const lines = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const htmlChunks = [];
  let i = 0;
  const n = lines.length;

  while (i < n) {
    const line = lines[i];

    // 1. Fenced Code Block: ```lang
    const codeMatch = line.match(/^```(\w*)/);
    if (codeMatch) {
      const lang = codeMatch[1] ? ` class="language-${escapeHtml(codeMatch[1])}"` : "";
      const codeLines = [];
      i++;
      while (i < n && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < n && lines[i].startsWith("```")) i++;
      htmlChunks.push(`<pre><code${lang}>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
      continue;
    }

    // Blank line
    if (!line.trim()) {
      i++;
      continue;
    }

    // 2. Headings: # H1 ~ ###### H6
    const headingMatch = line.match(/^(#{1,6})\s+(.+)$/);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const content = renderInline(headingMatch[2].trim());
      htmlChunks.push(`<h${level}>${content}</h${level}>`);
      i++;
      continue;
    }

    // 3. Horizontal Rule: ---, ***, ___
    if (/^(?:---|\*\*\*|___)\s*$/.test(line)) {
      htmlChunks.push("<hr>");
      i++;
      continue;
    }

    // 4. Blockquote: > text
    if (line.startsWith(">")) {
      const quoteLines = [];
      while (i < n && lines[i].startsWith(">")) {
        quoteLines.push(lines[i].replace(/^>\s?/, ""));
        i++;
      }
      const quoteHtml = renderMarkdown(quoteLines.join("\n"));
      htmlChunks.push(`<blockquote>${quoteHtml}</blockquote>`);
      continue;
    }

    // 5. Unordered List: - item, * item, + item
    if (/^[\*\-+]\s+/.test(line)) {
      const items = [];
      while (i < n && /^[\*\-+]\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^[\*\-+]\s+/, ""));
        i++;
      }
      const listContent = items.map((it) => `<li>${renderInline(it)}</li>`).join("");
      htmlChunks.push(`<ul>${listContent}</ul>`);
      continue;
    }

    // 6. Ordered List: 1. item
    if (/^\d+\.\s+/.test(line)) {
      const items = [];
      while (i < n && /^\d+\.\s+/.test(lines[i])) {
        items.push(lines[i].replace(/^\d+\.\s+/, ""));
        i++;
      }
      const listContent = items.map((it) => `<li>${renderInline(it)}</li>`).join("");
      htmlChunks.push(`<ol>${listContent}</ol>`);
      continue;
    }

    // 7. Table: | a | b |
    if (line.includes("|") && i + 1 < n && /^\|?\s*:?-+:?\s*\|/.test(lines[i + 1])) {
      const headerRow = line.split("|").map((c) => c.trim()).filter((_, idx, arr) => (idx > 0 && idx < arr.length - 1) || arr.length === 1);
      i += 2;
      const bodyRows = [];
      while (i < n && lines[i].includes("|") && lines[i].trim()) {
        const row = lines[i].split("|").map((c) => c.trim()).filter((_, idx, arr) => (idx > 0 && idx < arr.length - 1) || arr.length === 1);
        bodyRows.push(row);
        i++;
      }
      const thead = `<thead><tr>${headerRow.map((c) => `<th>${renderInline(c)}</th>`).join("")}</tr></thead>`;
      const tbody = `<tbody>${bodyRows.map((r) => `<tr>${r.map((c) => `<td>${renderInline(c)}</td>`).join("")}</tr>`).join("")}</tbody>`;
      htmlChunks.push(`<table>${thead}${tbody}</table>`);
      continue;
    }

    // 8. Paragraph
    const paraLines = [];
    while (
      i < n &&
      lines[i].trim() &&
      !lines[i].startsWith("#") &&
      !lines[i].startsWith("```") &&
      !lines[i].startsWith(">") &&
      !/^[\*\-+]\s+/.test(lines[i]) &&
      !/^\d+\.\s+/.test(lines[i]) &&
      !/^(?:---|\*\*\*|___)\s*$/.test(lines[i]) &&
      !(lines[i].includes("|") && i + 1 < n && /^\|?\s*:?-+:?\s*\|/.test(lines[i + 1]))
    ) {
      paraLines.push(lines[i]);
      i++;
    }
    if (paraLines.length > 0) {
      const content = paraLines.map(renderInline).join("<br>");
      htmlChunks.push(`<p>${content}</p>`);
    }
  }

  return htmlChunks.join("");
}

/**
 * Convert blocks array to a single Markdown string.
 */
export function blocksToMarkdown(blocks) {
  if (!Array.isArray(blocks) || blocks.length === 0) return "";
  const parts = [];

  for (const b of blocks) {
    const kind = String(b.type || "").replace(/^core\//, "");
    const a = b.attrs || {};
    switch (kind) {
      case "markdown":
      case "paragraph":
        parts.push(String(a.text || ""));
        break;
      case "heading":
        parts.push(`## ${String(a.text || "")}`);
        break;
      case "list":
        parts.push(
          String(a.text || "")
            .split("\n")
            .filter(Boolean)
            .map((item) => `- ${item}`)
            .join("\n")
        );
        break;
      case "quote":
        parts.push(
          String(a.text || "")
            .split("\n")
            .map((line) => `> ${line}`)
            .join("\n")
        );
        break;
      case "code":
        parts.push("```\n" + String(a.text || "") + "\n```");
        break;
      case "image":
        if (a.url) {
          parts.push(`![${a.alt || ""}](${a.url})`);
        }
        break;
      case "gallery":
        if (Array.isArray(a.items)) {
          parts.push(a.items.map((it) => `![${it.alt || ""}](${it.url || ""})`).join("\n"));
        }
        break;
      case "button":
        parts.push(`[${a.text || "Button"}](${a.url || "#"})`);
        break;
      case "separator":
        parts.push("---");
        break;
      case "html":
        parts.push(String(a.html || ""));
        break;
      default:
        if (b.content && Array.isArray(b.content)) {
          parts.push(blocksToMarkdown(b.content));
        }
        break;
    }
  }

  return parts.join("\n\n");
}

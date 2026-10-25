/**
 * Lightweight, zero-dependency CommonMark / GFM subset parser for CFPress.
 *
 * Runs seamlessly in both Cloudflare Workers (V8 isolate) and browser environments.
 * Strictly adheres to safe rendering (XSS protection, protocol sanitization).
 */

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function sanitizeUrl(url: string): string {
  const trimmed = url.trim();
  if (/^(?:javascript|data|vbscript):/i.test(trimmed)) {
    return "#";
  }
  return escapeHtml(trimmed);
}

/** Render inline Markdown elements: code, links, images, bold, italic, strikethrough */
export function renderInline(text: string): string {
  let out = "";
  let i = 0;
  const len = text.length;

  while (i < len) {
    // 1. Inline code: `code`
    if (text[i] === "`") {
      let close = text.indexOf("`", i + 1);
      if (close !== -1) {
        const codeContent = text.slice(i + 1, close);
        out += `<code>${escapeHtml(codeContent)}</code>`;
        i = close + 1;
        continue;
      }
    }

    // 2. Images: ![alt](url "title")
    if (text[i] === "!" && text[i + 1] === "[") {
      const altEnd = text.indexOf("]", i + 2);
      if (altEnd !== -1 && text[altEnd + 1] === "(") {
        const urlEnd = text.indexOf(")", altEnd + 2);
        if (urlEnd !== -1) {
          const alt = text.slice(i + 2, altEnd);
          const rawUrl = text.slice(altEnd + 2, urlEnd).trim();
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
    if (text[i] === "[") {
      const textEnd = text.indexOf("]", i + 1);
      if (textEnd !== -1 && text[textEnd + 1] === "(") {
        let depth = 1;
        let urlEnd = -1;
        for (let j = textEnd + 2; j < len; j++) {
          if (text[j] === "(") depth++;
          else if (text[j] === ")") {
            depth--;
            if (depth === 0) {
              urlEnd = j;
              break;
            }
          }
        }
        if (urlEnd !== -1) {
          const linkText = text.slice(i + 1, textEnd);
          const rawUrl = text.slice(textEnd + 2, urlEnd).trim();
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
    if (text[i] === "~" && text[i + 1] === "~") {
      const end = text.indexOf("~~", i + 2);
      if (end !== -1) {
        const inner = text.slice(i + 2, end);
        out += `<del>${renderInline(inner)}</del>`;
        i = end + 2;
        continue;
      }
    }

    // 5. Bold & Italic
    // Bold: **text** or __text__
    if ((text[i] === "*" && text[i + 1] === "*") || (text[i] === "_" && text[i + 1] === "_")) {
      const delim = text.slice(i, i + 2);
      const end = text.indexOf(delim, i + 2);
      if (end !== -1) {
        const inner = text.slice(i + 2, end);
        out += `<strong>${renderInline(inner)}</strong>`;
        i = end + 2;
        continue;
      }
    }

    // Italic: *text* or _text_ (with intra-word underscore protection per GFM)
    if (text[i] === "*" || text[i] === "_") {
      const delim = text[i];
      const isWordPrev = i > 0 && /\w/.test(text[i - 1]);
      if (delim === "_" && isWordPrev) {
        // intra-word underscore, treat as literal
      } else {
        const end = text.indexOf(delim, i + 1);
        if (end !== -1 && end > i + 1 && text[i + 1] !== " ") {
          const isWordNext = end + 1 < len && /\w/.test(text[end + 1]);
          if (delim === "_" && isWordNext) {
            // intra-word closing, treat as literal
          } else {
            const inner = text.slice(i + 1, end);
            out += `<em>${renderInline(inner)}</em>`;
            i = end + 1;
            continue;
          }
        }
      }
    }

    // Default: escape char
    const char = text[i];
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

/** Render a full Markdown string to HTML */
export function renderMarkdown(md: string): string {
  if (!md || typeof md !== "string") return "";

  const lines = md.replace(/\r\n/g, "\n").replace(/\r/g, "\n").split("\n");
  const htmlChunks: string[] = [];
  let i = 0;
  const n = lines.length;

  while (i < n) {
    const line = lines[i];

    // 1. Fenced Code Block: ```lang
    const codeMatch = line.match(/^```(\w*)/);
    if (codeMatch) {
      const lang = codeMatch[1] ? ` class="language-${escapeHtml(codeMatch[1])}"` : "";
      const codeLines: string[] = [];
      i++;
      while (i < n && !lines[i].startsWith("```")) {
        codeLines.push(lines[i]);
        i++;
      }
      if (i < n && lines[i].startsWith("```")) i++; // skip closing ```
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
      const quoteLines: string[] = [];
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
      const items: string[] = [];
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
      const items: string[] = [];
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
      i += 2; // skip header and separator
      const bodyRows: string[][] = [];
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

    // 8. Paragraph (collect consecutive non-empty lines)
    const paraLines: string[] = [];
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

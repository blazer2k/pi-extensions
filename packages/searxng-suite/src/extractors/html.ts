import { parseHTML } from "linkedom";
import TurndownService from "turndown";
import { readResponseBody, type ResponseBody } from "../helpers/request";
import type { ExtractResponse } from "./shared";
import { absolutizeUrls } from "../helpers/url";

const turndown = new TurndownService({
  headingStyle: "atx",
  hr: "---",
  bulletListMarker: "-",
  codeBlockStyle: "fenced",
});

export function buildMetaString(document: Document): string {
  const meta = (name: string): string =>
    document
      .querySelector(`meta[name="${name}"], meta[property="${name}"]`)
      ?.getAttribute("content") ?? "";

  const title = document.title || meta("og:title") || "Untitled";
  const author = meta("author") || meta("article:author") || "";
  const date =
    meta("article:published_time") ||
    meta("og:published_time") ||
    meta("date") ||
    "";
  const description = meta("description") || meta("og:description") || "";

  const metaString = [
    `Title: ${title}`,
    author ? `Author: ${author}` : null,
    date ? `Published: ${date}` : null,
    description ? `Description: ${description}` : null,
  ]
    .filter(Boolean)
    .join("\n");

  return metaString;
}

export async function extractHtml(
  sourceUrl: string,
  contentType: string,
  res: ResponseBody,
  maxBytes: number,
  signal?: AbortSignal,
  baseUrl = sourceUrl,
): Promise<ExtractResponse> {
  const raw = new TextDecoder().decode(
    await readResponseBody(res, maxBytes, signal),
  );
  signal?.throwIfAborted();

  const { document } = parseHTML(raw);
  const body = document.body;

  if (!body) throw new Error("Fetch returned empty body");

  const html = extractContent(document, baseUrl);
  const metaString = buildMetaString(document);
  const markdown = turndown.turndown(html).trimStart();

  const content = [
    `Source URL: ${sourceUrl}`,
    `Content-Type: ${contentType}`,
    "",
    "---",
    "",
    metaString,
    "",
    "---",
    "",
    markdown,
  ].join("\n");

  signal?.throwIfAborted();
  return {
    sourceUrl,
    contentType,
    bodyStart: content.length - markdown.length,
    content: [{ type: "text", text: content }],
  };
}

const NOISE_SELECTORS = `
  nav, header, footer,
  [role="navigation"], [role="banner"], [role="contentinfo"],
  [role="dialog"], [aria-modal="true"], [hidden],
  .modal, .overlay, .popup, .listingsignupbar,
  .breadcrumb, .breadcrumbs,
  .webring, .related-posts, .post-navigation,
  .sidebar, .side, .aside, .footer-parent,
  .cookie-banner, .cookie-notice,
  .share-buttons, .social-share,
  .newsletter, .subscribe,
  .rank, .midcol, .rank-spacer, .midcol-spacer,
  a[href^="javascript:"],
  script, style, noscript, svg, iframe, link, meta
`;

const CONTENT_SELECTORS = `
  main,
  article,
  [role="main"],
  [class*="content"], [id*="content"],
  [class*="article"], [id*="article"],
  [class*="post"], [id*="post"],
  [class*="entry"], [id*="entry"],
  [class*="thread"], [id*="thread"],
  [class*="conversation"], [id*="conversation"],
  [class*="timeline"], [id*="timeline"],
  [class*="comments"], [id*="comments"]
`;

function compactTextLength(text: string | null | undefined): number {
  return (text || "").replace(/\s+/g, "").length;
}

function getElementTextLength(el: Element): number {
  return compactTextLength(el.textContent);
}

function getLinkTextLength(el: Element): number {
  let length = 0;
  el.querySelectorAll("a").forEach((a) => {
    length += compactTextLength(a.textContent);
  });
  return length;
}

function getClassIdText(el: Element): string {
  return `${el.getAttribute("class") || ""} ${el.getAttribute("id") || ""}`;
}

function preClean(body: Element) {
  [...body.querySelectorAll(NOISE_SELECTORS)].forEach((el) => el.remove());
  removeEmptyAnchorsAndFragments(body);
}

function removeEmptyAnchorsAndFragments(body: Element): void {
  body.querySelectorAll('a[href="#"]').forEach((el) => {
    if (getElementTextLength(el) === 0) el.remove();
  });

  body.querySelectorAll("include-fragment").forEach((el) => {
    const text = (el.textContent || "").replace(/\s+/g, " ").trim();
    if (!text || /^(loading|fetching|please wait)/i.test(text)) el.remove();
  });
}

function looksLikeNavigationBlock(el: Element): boolean {
  const tag = el.tagName.toLowerCase();
  const role = el.getAttribute("role") || "";
  const classId = getClassIdText(el);

  return (
    /^(nav|header|footer|aside)$/i.test(tag) ||
    /^(navigation|banner|contentinfo|complementary)$/i.test(role) ||
    /\b(nav|menu|toc|table-of-contents|sidebar|aside|breadcrumb|footer|header|pagination|related-posts|related-articles|recommended-articles|share-buttons|social-share|newsletter|subscribe)\b/i.test(
      classId,
    )
  );
}

function removeLinkDenseBlocks(
  container: Element,
  minLinks = 10,
  maxLinkTextRatio = 0.8,
): void {
  const children = Array.from(container.children);

  for (const child of children) {
    const anchors = child.querySelectorAll("a");
    if (anchors.length < minLinks) {
      removeLinkDenseBlocks(child, minLinks, maxLinkTextRatio);
      continue;
    }

    const totalTextLen = getElementTextLength(child);
    if (totalTextLen === 0) continue;

    const linkRatio = getLinkTextLength(child) / totalTextLen;
    const hasLongParagraph = [...child.querySelectorAll("p, pre, code")].some(
      (el) => getElementTextLength(el) >= 120,
    );

    if (
      linkRatio >= maxLinkTextRatio &&
      !hasLongParagraph &&
      looksLikeNavigationBlock(child)
    ) {
      child.remove();
    } else {
      removeLinkDenseBlocks(child, minLinks, maxLinkTextRatio);
    }
  }
}

function scoreContentCandidate(el: Element): number {
  const textLen = getElementTextLength(el);
  if (textLen < 200) return 0;

  const linkRatio = getLinkTextLength(el) / textLen;
  const classId = getClassIdText(el);
  const tag = el.tagName.toLowerCase();

  let score = textLen * (1 - Math.min(linkRatio, 0.7) * 0.35);

  if (tag === "article") score *= 1.3;
  if (tag === "main") score *= 1.05;
  if (
    /\b(content|article|post|entry|thread|conversation|timeline|comments)\b/i.test(
      classId,
    )
  ) {
    score *= 1.4;
  }
  if (/\bmain\b/i.test(classId)) {
    score *= 1.1;
  }
  if (
    /\b(sidebar|aside|footer|header|nav|menu|modal|popup|overlay)\b/i.test(
      classId,
    )
  ) {
    score *= 0.2;
  }

  return score;
}

function chooseContentRoot(body: Element): Element {
  const candidates = [
    body,
    ...Array.from(body.querySelectorAll(CONTENT_SELECTORS)),
  ];
  let best = body;
  let bestScore = scoreContentCandidate(body);

  for (const candidate of candidates) {
    const score = scoreContentCandidate(candidate);
    if (score > bestScore) {
      best = candidate;
      bestScore = score;
    }
  }

  const bestTextLen = getElementTextLength(best);
  const bodyTextLen = getElementTextLength(body);

  // Avoid selecting a tiny island when the body still carries substantial
  // useful surrounding content, as can happen on discussion pages.
  if (best !== body && bodyTextLen > 0 && bestTextLen / bodyTextLen < 0.35) {
    return body;
  }

  return best;
}

function denoiseBody(body: Element) {
  preClean(body);
  removeLinkDenseBlocks(body);
}

function looksLikeDiscussion(root: Element): boolean {
  const text = root.textContent || "";
  const hasCommentArea = Boolean(root.querySelector(".commentarea"));
  const commentItems = root.querySelectorAll(
    [
      ".commentarea .comment",
      ".comment .md",
      ".timeline-comment",
      ".js-comment",
      '[id^="issuecomment-"]',
      '[class*="comment-body"]',
      '[data-testid*="comment"]',
    ].join(","),
  );

  if (hasCommentArea && /\bcomments?\b/i.test(text)) return true;
  if (commentItems.length >= 3) return true;

  const hasIssueTimeline = Boolean(
    root.querySelector(
      [
        '[data-partial-name*="Timeline"]',
        '[class*="discussion-timeline"]',
        '[class*="js-discussion"]',
      ].join(","),
    ),
  );

  return (
    hasIssueTimeline && /\b(commented|comments?|participants?)\b/i.test(text)
  );
}

function getTailMarkerKind(el: Element): "strong" | "weak" | null {
  const heading = el.firstElementChild;
  const markerText = heading?.matches("h2, h3, h4")
    ? heading.textContent
    : el.textContent;
  const text = (markerText || "").replace(/\s+/g, " ").trim();
  if (!text) return null;

  if (
    /^(found this article interesting\?|share this (article|post|story)\b|get the latest news\b|daily briefing newsletter\b)/i.test(
      text,
    )
  ) {
    return "strong";
  }

  if (
    /^(trending\b|related (articles|posts|stories)\b|recommended articles\b|more from\b|more news\b|latest news\b|expert insights\b|popular stories\b|people on the move\b|webinar\b|virtual event\b)/i.test(
      text,
    )
  ) {
    return "weak";
  }

  return null;
}

function getTextBeforeWithin(root: Element, node: Element): number {
  let total = 0;
  let current: Node | null = node;

  while (current && current !== root) {
    let sibling = current.previousSibling;
    while (sibling) {
      total += compactTextLength(sibling.textContent);
      sibling = sibling.previousSibling;
    }
    current = current.parentNode;
  }

  return total;
}

function isPrunableTailMarker(root: Element, el: Element): boolean {
  const kind = getTailMarkerKind(el);
  if (!kind) return false;

  const rootTextLen = getElementTextLength(root);
  if (rootTextLen === 0) return false;

  const beforeRatio = getTextBeforeWithin(root, el) / rootTextLen;
  if (beforeRatio < 0.55) return false;

  // Weak headings need structural evidence, not just a position near the end.
  return (
    kind === "strong" ||
    (looksLikeNavigationBlock(el) &&
      getLinkTextLength(el) / getElementTextLength(el) >= 0.8)
  );
}

function removeTailFrom(el: Element): void {
  let current: ChildNode | null = el;
  while (current) {
    const next: ChildNode | null = current.nextSibling;
    current.remove();
    current = next;
  }
}

function pruneArticleTail(root: Element): void {
  if (looksLikeDiscussion(root)) return;

  for (let pass = 0; pass < 20; pass++) {
    const nodes = Array.from(
      root.querySelectorAll("h2, h3, h4, section, aside, div, p"),
    );
    const marker = nodes.find(
      (node) => node.isConnected && isPrunableTailMarker(root, node),
    );

    if (!marker) return;

    removeTailFrom(marker);
  }
}

function extractContent(document: Document, sourceUrl: string): string {
  const body = document.body;
  if (!body) return "";

  denoiseBody(body);

  const contentRoot = chooseContentRoot(body);
  pruneArticleTail(contentRoot);
  absolutizeUrls(contentRoot, sourceUrl);

  return contentRoot.innerHTML ?? "";
}

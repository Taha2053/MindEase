import browser from "webextension-polyfill";
import type { ContentChunk, Gap, HighlightNote, PersonalizedArtifact, ResourceEntry, SessionFolderSummary, StudyCard, VisualEntry } from "@/types";
import { renderMarkdown } from "@/utils/markdown";
import { formatDayAndTime } from "@/session/sessionHistory";

const main = document.getElementById("review")!;
document.getElementById("print")?.addEventListener("click", () => window.print());

function _escape(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function section(title: string): HTMLElement {
  const wrapper = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = title;
  wrapper.append(heading);
  main.append(wrapper);
  return wrapper;
}

function paragraph(parent: HTMLElement, text: string, className?: string): HTMLParagraphElement {
  const p = document.createElement("p");
  if (className) p.className = className;
  p.textContent = text;
  parent.append(p);
  return p;
}

function items(parent: HTMLElement, entries: string[]): void {
  if (!entries.length) return;
  const ul = document.createElement("ul");
  for (const entry of entries) {
    const li = document.createElement("li");
    li.textContent = entry;
    ul.append(li);
  }
  parent.append(ul);
}

function resourceLink(parent: HTMLElement, resource: ResourceEntry): void {
  const p = document.createElement("p");
  const link = document.createElement("a");
  try {
    const url = new URL(resource.url);
    if (url.protocol === "https:" || url.protocol === "http:") {
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  } catch { /* display title without a link */ }
  link.textContent = resource.title || resource.url;
  p.append(link);
  parent.append(p);
}

function openLightbox(dataUrl: string, title: string): void {
  document.getElementById("review-lightbox")?.remove();
  let zoom = 1.0;

  const lb = document.createElement("div");
  lb.id = "review-lightbox";
  lb.className = "review-lightbox";

  const header = document.createElement("div");
  header.className = "review-lightbox-header";
  const titleEl = document.createElement("strong");
  titleEl.textContent = title || "Diagram preview";

  const actions = document.createElement("div");
  actions.className = "review-lightbox-actions";

  const zoomOut = document.createElement("button");
  zoomOut.type = "button";
  zoomOut.className = "btn-lightbox-action";
  zoomOut.textContent = "−";

  const zoomDisplay = document.createElement("span");
  zoomDisplay.style.cssText = "font-size: 0.8rem; min-width: 44px; text-align: center; color: #cbd5e1;";
  zoomDisplay.textContent = "100%";

  const zoomIn = document.createElement("button");
  zoomIn.type = "button";
  zoomIn.className = "btn-lightbox-action";
  zoomIn.textContent = "+";

  const reset = document.createElement("button");
  reset.type = "button";
  reset.className = "btn-lightbox-action";
  reset.textContent = "Reset";

  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "btn-lightbox-action";
  closeBtn.textContent = "✕ Close";

  actions.append(zoomOut, zoomDisplay, zoomIn, reset, closeBtn);
  header.append(titleEl, actions);

  const body = document.createElement("div");
  body.className = "review-lightbox-body";
  const img = document.createElement("img");
  img.className = "review-lightbox-img";
  img.src = dataUrl;
  img.alt = title;

  const apply = () => {
    zoom = Math.max(0.5, Math.min(4, zoom));
    img.style.transform = `scale(${zoom})`;
    zoomDisplay.textContent = `${Math.round(zoom * 100)}%`;
  };

  zoomIn.onclick = () => { zoom += 0.25; apply(); };
  zoomOut.onclick = () => { zoom -= 0.25; apply(); };
  reset.onclick = () => { zoom = 1.0; apply(); };
  const close = () => { document.removeEventListener("keydown", onKey); lb.remove(); };
  closeBtn.onclick = close;
  body.onclick = (e) => { if (e.target === body) close(); };
  const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") close(); };
  document.addEventListener("keydown", onKey);

  body.append(img);
  lb.append(header, body);
  document.body.append(lb);
}

void Promise.all([
  browser.storage.local.get(["latestArtifact", "latestReviewChunks", "mindease_session_folders", "mindease_visuals_cache"]),
]).then(([result]) => {
  const artifact = result.latestArtifact as PersonalizedArtifact | undefined;
  const review = result.latestReviewChunks as { sessionId: string; chunks: ContentChunk[] } | undefined;
  const folders = (result.mindease_session_folders as SessionFolderSummary[] | undefined) ?? [];
  const cachedVisuals = (result.mindease_visuals_cache as { entries: VisualEntry[] } | undefined)?.entries ?? [];

  const chunks = review && review.sessionId === artifact?.sessionId ? review.chunks : [];
  main.replaceChildren();
  if (!artifact) { paragraph(main, "No completed session review is available yet."); return; }

  // Header & Title
  const h1 = document.createElement("h1");
  h1.textContent = "MindEase · Session Review";
  main.append(h1);
  paragraph(main, `Completed on ${formatDayAndTime(artifact.generatedAt)}`, "session-time-sub");

  const sources = artifact.resourcesUsed ?? [];
  const rawConcepts = artifact.keyConcepts ?? [];
  const notes = artifact.userNotes ?? [];
  const cards = artifact.studyCards ?? [];
  const gaps = artifact.needsReview ?? [];

  // Match folder visuals if available
  const matchingFolder = folders.find(f => f.savedAt === artifact.generatedAt || (f.content && f.content.some(c => chunks.some(rc => rc.id === c.id))));
  const visuals: Array<{ id: string; concept: string; dataUrl: string; filename?: string }> = matchingFolder?.visuals?.length ? matchingFolder.visuals : cachedVisuals;

  // Separate adapted sources (those with actual chunks) from unadapted background tabs
  const adaptedSources = sources.filter(source =>
    chunks.some(c => c.sourceId === source.url)
  );
  const unadaptedSources = sources.filter(source =>
    !chunks.some(c => c.sourceId === source.url)
  );

  // Distinct cleaned concepts
  const conceptSet = new Set<string>();
  for (const c of rawConcepts) {
    const trimmed = c.label?.trim();
    if (trimmed && trimmed.length >= 2 && trimmed.length <= 80 && !conceptSet.has(trimmed.toLowerCase())) {
      conceptSet.add(trimmed.toLowerCase());
    }
  }
  const uniqueConcepts = [...conceptSet];

  // 1. Session at a Glance: Structured Metrics Table
  const overview = section("Session at a glance");
  const glanceTable = document.createElement("table");
  glanceTable.className = "review-table glance-table";
  glanceTable.innerHTML = `
    <thead>
      <tr>
        <th style="width: 34%;">Session Metric</th>
        <th style="width: 26%;">Count / Value</th>
        <th>Description</th>
      </tr>
    </thead>
    <tbody>
      <tr>
        <td><strong>Studied Sources</strong></td>
        <td>${adaptedSources.length} primary source${adaptedSources.length === 1 ? "" : "s"}</td>
        <td>${sources.length} total browser tab${sources.length === 1 ? "" : "s"} recorded during study</td>
      </tr>
      <tr>
        <td><strong>Adapted Sections</strong></td>
        <td>${chunks.length} structured chunk${chunks.length === 1 ? "" : "s"}</td>
        <td>Processed and formatted learning materials</td>
      </tr>
      <tr>
        <td><strong>Domain Concepts</strong></td>
        <td>${uniqueConcepts.length} concept${uniqueConcepts.length === 1 ? "" : "s"}</td>
        <td>Source-grounded knowledge topics identified</td>
      </tr>
      ${visuals.length ? `<tr><td><strong>Generated Visuals</strong></td><td>${visuals.length} diagram${visuals.length === 1 ? "" : "s"}</td><td>Interactive explanatory diagrams</td></tr>` : ""}
      ${notes.length ? `<tr><td><strong>Learner Notes</strong></td><td>${notes.length} note${notes.length === 1 ? "" : "s"}</td><td>Important excerpts highlighted by student</td></tr>` : ""}
      ${cards.length ? `<tr><td><strong>Study Cards</strong></td><td>${cards.length} card${cards.length === 1 ? "" : "s"}</td><td>Spaced repetition review questions</td></tr>` : ""}
    </tbody>
  `;
  overview.append(glanceTable);

  // 2. Key Topics: Clean Badge Pills (No repetitive 168-line dumps!)
  if (uniqueConcepts.length > 0) {
    const topicsSec = section(`Key topics (${uniqueConcepts.length})`);
    const cloud = document.createElement("div");
    cloud.className = "topics-cloud";
    const topTopics = uniqueConcepts.slice(0, 24);
    for (const topic of topTopics) {
      const pill = document.createElement("span");
      pill.className = "topic-pill";
      pill.textContent = topic;
      cloud.append(pill);
    }
    if (uniqueConcepts.length > 24) {
      const morePill = document.createElement("span");
      morePill.className = "topic-pill more";
      morePill.textContent = `+${uniqueConcepts.length - 24} more topics`;
      cloud.append(morePill);
    }
    topicsSec.append(cloud);
  }

  // 3. Accompanying Visuals & Diagrams (Click to Zoom / Open Full View)
  if (visuals.length > 0) {
    const visSection = section(`Accompanying diagrams & visuals (${visuals.length})`);
    paragraph(visSection, "Click any diagram to inspect it full size with high-resolution zoom.");
    const grid = document.createElement("div");
    grid.className = "visuals-review-grid";
    for (const vis of visuals) {
      const card = document.createElement("div");
      card.className = "visual-review-card";
      card.title = "Click to inspect full size";
      card.onclick = () => openLightbox(vis.dataUrl, vis.concept);

      const wrap = document.createElement("div");
      wrap.className = "visual-review-img-wrap";
      const img = document.createElement("img");
      img.src = vis.dataUrl;
      img.alt = vis.concept;
      img.loading = "lazy";
      const zoomBadge = document.createElement("span");
      zoomBadge.className = "btn-zoom-visual-review";
      zoomBadge.textContent = "🔍 View full size";
      wrap.append(img, zoomBadge);

      const label = document.createElement("div");
      label.className = "visual-review-label";
      label.textContent = vis.concept;

      card.append(wrap, label);
      grid.append(card);
    }
    visSection.append(grid);
  }

  // 4. Sources Overview Table (Embracing structured tables!)
  const effectiveSources = adaptedSources.length > 0 ? adaptedSources : sources;
  if (effectiveSources.length > 0) {
    const sourcesSummarySec = section("Sources summary");
    const srcTable = document.createElement("table");
    srcTable.className = "review-table sources-table";
    srcTable.innerHTML = `
      <thead>
        <tr>
          <th style="width: 52%;">Source Document</th>
          <th style="width: 20%;">Type</th>
          <th>Adapted Sections</th>
        </tr>
      </thead>
      <tbody>
        ${effectiveSources.map(s => {
          const count = chunks.filter(c => c.sourceId === s.url).length;
          const displayTitle = s.title || s.url;
          return `
            <tr>
              <td><strong><a href="${_escape(s.url)}" target="_blank" rel="noopener noreferrer">${_escape(displayTitle)}</a></strong></td>
              <td><span style="text-transform: capitalize;">${_escape(s.sourceType || "website")}</span></td>
              <td>${count} section${count === 1 ? "" : "s"}</td>
            </tr>
          `;
        }).join("")}
      </tbody>
    `;
    sourcesSummarySec.append(srcTable);
  }

  // 5. What you covered across this session (Key summaries per adapted source)
  if (effectiveSources.length > 0) {
    const covered = section("What you covered across this session");
    for (const source of effectiveSources) {
      const sourceChunks = chunks.filter(c => c.sourceId === source.url).sort((a, b) => a.position - b.position);
      const heading = document.createElement("h3");
      heading.textContent = source.title || source.url;
      covered.append(heading);

      const summaries = [...new Set(sourceChunks.map(c => c.summary?.trim()).filter((v): v is string => Boolean(v)))];
      if (summaries.length) {
        items(covered, summaries);
      } else if (sourceChunks.length > 0) {
        const tags = [...new Set(sourceChunks.flatMap(c => c.conceptTags || []))].slice(0, 6);
        if (tags.length) {
          paragraph(covered, `Core concepts covered: ${tags.join(", ")}.`);
        } else {
          paragraph(covered, `Adapted lesson with ${sourceChunks.length} structured sections.`);
        }
      }
    }
  }

  // 6. Sources and material studied (Detailed source blocks)
  if (effectiveSources.length > 0) {
    const sourceSection = section("Sources and material studied");
    for (const source of effectiveSources) {
      const group = document.createElement("article");
      group.className = "source-section";
      const heading = document.createElement("h3");
      heading.textContent = source.title || source.url;
      group.append(heading);
      resourceLink(group, source);
      const sourceChunks = chunks.filter(c => c.sourceId === source.url).sort((a, b) => a.position - b.position);
      for (const chunk of sourceChunks) {
        const body = document.createElement("div");
        body.innerHTML = renderMarkdown(chunk.text);
        group.append(body);
        if (chunk.sourceText && chunk.sourceText.trim() !== chunk.text.trim()) {
          const original = document.createElement("details");
          original.className = "source-original";
          const label = document.createElement("summary");
          label.textContent = "Original source section";
          const text = document.createElement("div");
          text.innerHTML = renderMarkdown(chunk.sourceText);
          original.append(label, text);
          group.append(original);
        }
      }
      sourceSection.append(group);
    }

    // Unadapted background/reference tabs grouped compactly in ONE place!
    if (unadaptedSources.length > 0) {
      const refArticle = document.createElement("article");
      refArticle.className = "source-section";
      const refHeading = document.createElement("h3");
      refHeading.textContent = `Additional reference tabs visited (${unadaptedSources.length})`;
      refArticle.append(refHeading);
      paragraph(refArticle, "The following tabs were open during your study session as background or reference material:");
      const refList = document.createElement("ul");
      refList.className = "reference-tabs-list";
      for (const ref of unadaptedSources) {
        const li = document.createElement("li");
        const a = document.createElement("a");
        try {
          const url = new URL(ref.url);
          if (url.protocol === "https:" || url.protocol === "http:") {
            a.href = url.href;
            a.target = "_blank";
            a.rel = "noopener noreferrer";
          }
        } catch {}
        a.textContent = ref.title || ref.url;
        li.append(a);
        refList.append(li);
      }
      refArticle.append(refList);
      sourceSection.append(refArticle);
    }
  }

  // 7. Structured Study Cards Table (when cards exist)
  if (cards.length > 0) {
    const cardSec = section("Study cards");
    const cardsTable = document.createElement("table");
    cardsTable.className = "review-table cards-table";
    cardsTable.innerHTML = `
      <thead>
        <tr>
          <th style="width: 28%;">Concept</th>
          <th>Question & Knowledge Prompt</th>
        </tr>
      <tbody>
        ${cards.map((c: StudyCard) => `
            <td><strong>${_escape(c.concept)}</strong></td>
            <td>${_escape(c.content)}</td>
          </tr>
        `).join("")}
      </tbody>
    `;
    cardSec.append(cardsTable);
  }

  // 8. Structured Notes Table (when notes exist)
  if (notes.length > 0) {
    const noteSec = section("Your notes");
    const notesTable = document.createElement("table");
    notesTable.className = "review-table notes-table";
    notesTable.innerHTML = `
      <thead>
        <tr>
          <th>Learner Highlight / Note</th>
          <th style="width: 35%;">Source Document</th>
        </tr>
      </thead>
      <tbody>
        ${notes.map((n: HighlightNote) => `
          <tr>
            <td>${_escape(n.text)}</td>
            <td><em>${_escape(n.resourceTitle || n.sourceUrl)}</em></td>
          </tr>
        `).join("")}
      </tbody>
    `;
    noteSec.append(notesTable);
  }

  // 9. Structured Needs Review / Gaps Table (when gaps exist)
  if (gaps.length > 0) {
    const gapSec = section("Areas for review");
    const gapsTable = document.createElement("table");
    gapsTable.className = "review-table gaps-table";
    gapsTable.innerHTML = `
      <thead>
        <tr>
          <th style="width: 30%;">Topic Area</th>
          <th>Review Recommendation</th>
        </tr>
      <tbody>
        ${gaps.map((g: Gap) => `
            <td><strong>${_escape(g.conceptLabel)}</strong></td>
            <td>${_escape(g.text)}</td>
          </tr>
        `).join("")}
      </tbody>
    `;
    gapSec.append(gapsTable);
  }
}).catch(() => {
  main.replaceChildren();
  paragraph(main, "Session review could not be loaded. Please reopen the dashboard and try again.");
});

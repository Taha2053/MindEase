import browser from "webextension-polyfill";
import type { ContentChunk, PersonalizedArtifact, ResourceEntry } from "@/types";
import { renderMarkdown } from "@/utils/markdown";

const main = document.getElementById("review")!;
document.getElementById("print")?.addEventListener("click", () => window.print());

function section(title: string): HTMLElement {
  const wrapper = document.createElement("section");
  const heading = document.createElement("h2");
  heading.textContent = title;
  wrapper.append(heading);
  main.append(wrapper);
  return wrapper;
}
function paragraph(parent: HTMLElement, text: string): void {
  const p = document.createElement("p");
  p.textContent = text;
  parent.append(p);
}
function items(parent: HTMLElement, entries: string[]): void {
  if (!entries.length) { paragraph(parent, "Nothing recorded for this section."); return; }
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
    if (url.protocol === "https:" || url.protocol === "http:") link.href = url.href;
  } catch { /* display title without a link */ }
  link.textContent = resource.title || resource.url;
  p.append(link);
  parent.append(p);
}

void browser.storage.local.get(["latestArtifact", "latestReviewChunks"]).then(result => {
  const artifact = result.latestArtifact as PersonalizedArtifact | undefined;
  const review = result.latestReviewChunks as { sessionId: string; chunks: ContentChunk[] } | undefined;
  const chunks = review && review.sessionId === artifact?.sessionId ? review.chunks : [];
  main.replaceChildren();
  if (!artifact) { paragraph(main, "No completed session review is available yet."); return; }

  const h1 = document.createElement("h1");
  h1.textContent = "MindEase · Complete session review";
  main.append(h1);
  paragraph(main, `Completed ${new Date(artifact.generatedAt).toLocaleString()}`);

  const sources = artifact.resourcesUsed ?? [];
  const concepts = artifact.keyConcepts ?? [];
  const notes = artifact.userNotes ?? [];
  const cards = artifact.studyCards ?? [];
  const gaps = artifact.needsReview ?? [];
  const overview = section("Session at a glance");
  paragraph(overview, `Studied ${sources.length} source${sources.length === 1 ? "" : "s"}; ${concepts.length} source-grounded topic${concepts.length === 1 ? "" : "s"}, ${notes.length} note${notes.length === 1 ? "" : "s"}, ${cards.length} study card${cards.length === 1 ? "" : "s"}, and ${gaps.length} area${gaps.length === 1 ? "" : "s"} marked for review.`);
  if (concepts.length) paragraph(overview, `Topics: ${concepts.map(c => c.label).join(", ")}.`);

  const covered = section("What you covered across this session");
  for (const source of sources) {
    const sourceChunks = chunks.filter(c => c.sourceId === source.url).sort((a, b) => a.position - b.position);
    const summaries = [...new Set(sourceChunks.map(c => c.summary?.trim()).filter((value): value is string => Boolean(value)))];
    const heading = document.createElement("h3");
    heading.textContent = source.title || source.url;
    covered.append(heading);
    if (summaries.length) items(covered, summaries);
    else paragraph(covered, "No section summaries were retained; the complete adapted lesson appears below.");
  }

  const sourceSection = section("Sources and material studied");
  for (const source of sources) {
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
    if (!sourceChunks.length) paragraph(group, "Adapted source text was not retained for this source; consult the original link above.");
    sourceSection.append(group);
  }
  if (!sources.length) paragraph(sourceSection, "No source metadata was recorded for this session.");

  items(section("Key topics"), concepts.map(c => c.label));
  items(section("Your notes"), notes.map(n => `${n.text} — ${n.resourceTitle || n.sourceUrl}`));
  items(section("Study cards"), cards.map(c => `${c.concept}: ${c.content}`));
  items(section("Needs review"), gaps.map(g => `${g.conceptLabel}: ${g.text}`));
}).catch(() => {
  main.replaceChildren();
  paragraph(main, "Session review could not be loaded. Please reopen the dashboard and try again.");
});

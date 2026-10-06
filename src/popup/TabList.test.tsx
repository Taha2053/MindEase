// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import type { WorkspaceSession } from "@/types";
import { TabList } from "./TabList";

Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const host = document.createElement("div");
document.body.append(host);
let root: ReturnType<typeof createRoot> | undefined;
afterEach(async () => { if (root) await act(async () => root!.unmount()); root = undefined; });

const tabs = [
  { id: 1, title: "Lesson", url: "https://example.org/lesson", index: 0, highlighted: false, active: true, pinned: false, incognito: false },
  { id: 2, title: "Entertainment", url: "https://example.org/show", index: 1, highlighted: false, active: false, pinned: false, incognito: false },
  { id: 3, title: "Browser settings", url: "chrome://settings", index: 2, highlighted: false, active: false, pinned: false, incognito: false },
];
const session = { tabs: [
  { tabId: 1, url: tabs[0].url, category: "learning" },
  { tabId: 2, url: tabs[1].url, category: "distraction" },
] } as WorkspaceSession;

describe("study tab inventory", () => {
  it("shows valid study tabs, omits internal browser settings, and keeps classification independent of manual inclusion", async () => {
    const changed: number[] = [];
    root = createRoot(host);
    await act(async () => root!.render(<TabList tabs={tabs} session={session} excludedTabs={{ 1: true, 2: false }} onToggle={id => changed.push(id)} />));
    const rows = [...host.querySelectorAll(".tab-row")];
    expect(rows.map(row => row.querySelector(".tab-title")?.textContent)).toEqual(["Lesson", "Entertainment"]);
    expect(rows.map(row => row.querySelector(".tab-badge")?.textContent)).toEqual(["Learning", "Non-learning"]);
    const switches = [...host.querySelectorAll<HTMLButtonElement>('button[role="switch"]')];
    expect(switches.map(btn => btn.getAttribute("aria-checked"))).toEqual(["false", "true"]);
    await act(async () => switches[0].click());
    expect(changed).toEqual([1]);
  });

  it("shows valid study tabs before background classification completes", async () => {
    root = createRoot(host);
    await act(async () => root!.render(<TabList tabs={tabs} session={null} excludedTabs={{}} onToggle={() => {}} />));
    const rows = [...host.querySelectorAll(".tab-row")];
    expect(rows.map(row => row.querySelector(".tab-title")?.textContent)).toEqual(["Lesson", "Entertainment"]);
    expect(rows.map(row => row.querySelector(".tab-badge")?.textContent)).toEqual(["Pending", "Pending"]);
  });
  it("offers a reader for classified PDF URLs", async () => {
    let selected: string | undefined;
    const pdf = { ...tabs[0], url: "https://example.org/paper.pdf?download=1" };
    const pdfSession = { tabs: [{ tabId: 1, url: pdf.url, category: "learning" }] } as WorkspaceSession;
    root = createRoot(host);
    await act(async () => root!.render(<TabList tabs={[pdf]} session={pdfSession} excludedTabs={{}} onToggle={() => {}}
      onReadPdf={tab => { selected = tab.url; }} />));
    const pdfBtn = host.querySelector<HTMLButtonElement>(".btn-pdf-reader");
    expect(pdfBtn).not.toBeNull();
    await act(async () => pdfBtn!.click());
    expect(selected).toBe(pdf.url);
  });
});

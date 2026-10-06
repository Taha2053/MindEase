// @vitest-environment jsdom
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import browser from "webextension-polyfill";
import { extractRemoteSource } from "@/layer1/premiumClient";
import { getTabTrackingState } from "@/utils/tabTracking";
import { PdfReader } from "./PdfReader";

vi.mock("webextension-polyfill", () => ({ default: {
  tabs: { get: vi.fn() }, storage: { local: { get: vi.fn() } }, runtime: { sendMessage: vi.fn() },
} }));
vi.mock("@/layer1/premiumClient", () => ({ extractRemoteSource: vi.fn() }));
vi.mock("@/layer1", () => ({ transformContent: vi.fn() }));
vi.mock("@/utils/tabTracking", () => ({ getTabTrackingState: vi.fn() }));
vi.mock("@/layer1/resourceRecommendations", () => ({ findRelatedResources: vi.fn() }));
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
const source = "https://example.org/lesson.pdf?download=1";
const host = document.createElement("div");
document.body.append(host);
let root: ReturnType<typeof createRoot>;
beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(browser.tabs.get).mockResolvedValue({ id: 7, url: source, incognito: false } as Awaited<ReturnType<typeof browser.tabs.get>>);
  vi.mocked(getTabTrackingState).mockResolvedValue({ active: false, included: false, overridden: false });
  root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); });
const openReader = async () => { await act(async () => root.render(<PdfReader source={source} tabId={7} />)); };
const accept = async () => { await act(async () => host.querySelector<HTMLButtonElement>("button")!.click()); };

describe("PDF reader consent and source boundaries", () => {
  it("never uploads before consent and refuses adaptation outside an included session", async () => {
    await openReader();
    expect(extractRemoteSource).not.toHaveBeenCalled();
    await accept();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("include this PDF tab");
    expect(extractRemoteSource).not.toHaveBeenCalled();
  });

  it("refuses a stale reader after its source tab navigates", async () => {
    vi.mocked(browser.tabs.get).mockResolvedValue({ id: 7, url: "https://example.org/another.pdf", incognito: false } as Awaited<ReturnType<typeof browser.tabs.get>>);
    await openReader();
    await accept();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("source tab changed");
    expect(extractRemoteSource).not.toHaveBeenCalled();
  });

  it("never sends an incognito PDF to the server", async () => {
    vi.mocked(browser.tabs.get).mockResolvedValue({ id: 7, url: source, incognito: true } as Awaited<ReturnType<typeof browser.tabs.get>>);
    await openReader();
    await accept();
    expect(host.querySelector('[role="status"]')?.textContent).toContain("private");
    expect(extractRemoteSource).not.toHaveBeenCalled();
  });
});

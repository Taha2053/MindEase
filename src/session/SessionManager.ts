import browser from "webextension-polyfill";
import type {
  WorkspaceSession,
  SessionState,
  TabResource,
  HighlightNote,
  FocusSummary,
  ContentChunk,
  CognitiveEvent,
  SignalType,
  FullCognitiveProfile,
  CognitiveProfile,
  StateTransition,
} from "@/types";
import { STORAGE_KEYS } from "@/types";
import { v4 as uuidv4 } from "uuid";

/* ─── Timeout constants ─────────────────────────────────────────────────── */

const IDLE_TO_PASSIVE_MS = 5 * 60 * 1000;     // 5 min inactivity → passive
const PASSIVE_TO_SUSPENDED_MS = 30 * 60 * 1000; // 30 min passive → suspended
const SUSPENDED_TO_ENDED_MS = 60 * 60 * 1000;   // 60 min suspended → auto-end
const MAX_HIGHLIGHTS_PER_TAB = 500;              // cap to prevent unbounded memory growth

/* ─── SessionManager ─────────────────────────────────────────────────────── */

export class SessionManager {
  private session: WorkspaceSession | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;
  private ending: Promise<void> | null = null;

  // Callbacks - set by background to wire into existing layers
  public onLayer2Signal: ((signal: SignalType, url: string, sectionId: string) => Promise<void>) | null = null;
  public onLayer3Event: ((event: CognitiveEvent) => void) | null = null;
  public onLayer3EndSession: ((
    chunks?: ContentChunk[],
    highlights?: HighlightNote[] | null,
    tabs?: TabResource[] | null,
    focus?: FocusSummary | null,
  ) => Promise<void>) | null = null;
  public onLayer2EndSession: (() => Promise<FullCognitiveProfile | null>) | null = null;
  public getProfile: (() => Promise<FullCognitiveProfile | null>) | null = null;

  /* ─── Initialization ─────────────────────────────────────────────────── */

  async init(): Promise<void> {
    const restored = await this.restore();
    if (!restored) {
      this.session = null;
    }
  }

  private async restore(): Promise<boolean> {
    try {
      const result = await browser.storage.local.get([STORAGE_KEYS.WORKSPACE]);
      const raw = result[STORAGE_KEYS.WORKSPACE];
      const saved = (raw && typeof raw === "object" ? raw : undefined) as WorkspaceSession | undefined;
      if (!saved || saved.state === "ended") return false;

      this.session = saved;
      const now = Date.now();
      const passiveAt = saved.lastActivityAt + IDLE_TO_PASSIVE_MS;
      if (saved.state === "active" && now >= passiveAt) {
        this.transitionToPassive(passiveAt);
      }
      const suspendedAt = (saved.enteredPassiveAt ?? passiveAt) + PASSIVE_TO_SUSPENDED_MS;
      if (saved.state === "passive" && now >= suspendedAt) {
        this.transitionToSuspended(suspendedAt);
      }

      this.startTimers();
      return true;
    } catch {
      return false;
    }
  }

  private async persist(): Promise<void> {
    if (!this.session) return;
    try {
      await browser.storage.local.set({ [STORAGE_KEYS.WORKSPACE]: this.session });
    } catch (err) {
      console.warn("[MindEase] Workspace save failed:", err);
    }
  }

  /* ─── Getters ────────────────────────────────────────────────────────── */

  getState(): SessionState {
    return this.session?.state ?? "ended";
  }

  getSessionId(): string | null {
    return this.session?.sessionId ?? null;
  }

  getTabs(): TabResource[] {
    return this.session ? [...(this.session.closedTabs ?? []), ...this.session.tabs] : [];
  }

  getHighlights(): HighlightNote[] {
    return this.getTabs().flatMap(t => t.highlights);
  }

  getFocusSummary(): FocusSummary {
    if (!this.session) {
      return { totalTimeMs: 0, focusedTimeMs: 0, interruptionCount: 0, longestDistractionMs: 0, passiveTimeMs: 0, suspendedTimeMs: 0 };
    }
    const now = this.session.endTime ?? Date.now();
    const elapsed = now - this.session.startTime;
    const passiveMs = this.session.totalPassiveDurationMs +
      (this.session.state === "passive" && this.session.enteredPassiveAt !== null
        ? now - this.session.enteredPassiveAt : 0);
    const suspendedMs = this.session.totalSuspendedDurationMs +
      (this.session.state === "suspended" && this.session.enteredSuspendedAt !== null
        ? now - this.session.enteredSuspendedAt : 0);
    const focusedMs = elapsed - passiveMs - suspendedMs;
    return {
      totalTimeMs: this.session.endTime ? this.session.endTime - this.session.startTime : elapsed,
      focusedTimeMs: Math.max(0, focusedMs),
      interruptionCount: this.session.interruptionCount,
      longestDistractionMs: this.session.longestDistractionMs,
      passiveTimeMs: passiveMs,
      suspendedTimeMs: suspendedMs,
    };
  }

  /* ─── Tab Management ─────────────────────────────────────────────────── */

  async registerTab(tabId: number, url: string, sourceType: "pdf" | "video" | "website" | "lecture", title: string, category?: "learning" | "distraction"): Promise<void> {
    if (this.ending) await this.ending;
    const now = Date.now();

    // Create session if none exists
    if (!this.session) {
      this.session = {
        sessionId: uuidv4(),
        userId: "guest",
        state: "active",
        tabs: [],
        startTime: now,
        endTime: null,
        lastActivityAt: now,
        enteredPassiveAt: null,
        enteredSuspendedAt: null,
        totalActiveDurationMs: 0,
        totalPassiveDurationMs: 0,
        totalSuspendedDurationMs: 0,
        interruptionCount: 0,
        longestDistractionMs: 0,
        distractionStart: null,
        stateTransitions: [],
      };
    }

    // Don't register if already present
    const existing = this.session.tabs.find(t => t.tabId === tabId);
    if (existing) {
      existing.lastActiveAt = now;
      if (category && existing.category !== category) existing.category = category;
      if (title && !existing.title) existing.title = title;
      this.onActivity();
      return;
    }

    this.session.tabs.push({
      tabId,
      url,
      title,
      sourceType,
      category,
      joinedAt: now,
      lastActiveAt: now,
      highlights: [],
    });

    this.onActivity();
    await this.persist();
  }

  async removeTab(tabId: number): Promise<void> {
    if (!this.session || this.session.state === "ended") return;
    const tab = this.session.tabs.find(t => t.tabId === tabId);
    if (!tab) return;
    (this.session.closedTabs ??= []).push(tab);
    this.session.tabs = this.session.tabs.filter(t => t.tabId !== tabId);
    if (this.session.tabs.length === 0) {
      await this.endSession();
    } else {
      await this.persist();
    }
  }

  /* ─── Activity ───────────────────────────────────────────────────────── */

  onActivity(): void {
    if (!this.session || this.session.state === "ended") return;

    const now = Date.now();

    // Track distraction: if transitioning from passive/suspended → active
    if (this.session.state === "passive" && this.session.enteredPassiveAt) {
      const distractionMs = now - this.session.enteredPassiveAt;
      this.session.totalPassiveDurationMs += distractionMs;
      if (distractionMs > this.session.longestDistractionMs) {
        this.session.longestDistractionMs = distractionMs;
      }
      this.session.interruptionCount++;
    }
    if (this.session.state === "suspended" && this.session.enteredSuspendedAt) {
      const distractionMs = now - this.session.enteredSuspendedAt;
      this.session.totalSuspendedDurationMs += distractionMs;
      if (distractionMs > this.session.longestDistractionMs) {
        this.session.longestDistractionMs = distractionMs;
      }
      this.session.interruptionCount++;
    }

    // Transition back to active
    const wasNotActive = this.session.state !== "active";
    if (wasNotActive) this.recordTransition("active");
    this.session.state = "active";
    this.session.lastActivityAt = now;
    this.session.enteredPassiveAt = null;
    this.session.enteredSuspendedAt = null;

    this.clearTimers();
    this.startTimers();

    if (wasNotActive) this.persist();
  }

  /* ─── Signal Routing ─────────────────────────────────────────────────── */

  async recordSignal(signal: SignalType, url: string, sectionId: string): Promise<void> {
    if (!this.session || this.session.state === "ended") return;
    this.onActivity();

    // Route to Layer 2 (RL agent)
    if (this.onLayer2Signal) {
      await this.onLayer2Signal(signal, url, sectionId);
    }
  }

  /* ─── Highlights ─────────────────────────────────────────────────────── */

  recordHighlight(tabId: number, text: string, sectionId?: string): void {
    if (!this.session || this.session.state === "ended") return;

    const tab = this.session.tabs.find(t => t.tabId === tabId);
    if (!tab) return;

    const note: HighlightNote = {
      id: uuidv4(),
      text,
      sourceUrl: tab.url,
      resourceTitle: tab.title,
      timestamp: Date.now(),
      sectionId,
    };

    tab.highlights.push(note);
    if (tab.highlights.length > MAX_HIGHLIGHTS_PER_TAB) {
      tab.highlights = tab.highlights.slice(-MAX_HIGHLIGHTS_PER_TAB);
    }
    this.persist();
  }

  /* ─── Session End ────────────────────────────────────────────────────── */

  endSession(): Promise<void> {
    if (this.ending) return this.ending;
    if (!this.session || this.session.state === "ended") return Promise.resolve();
    this.ending = this.finishSession().finally(() => {
      this.session = null;
      this.ending = null;
    });
    return this.ending;
  }

  private async finishSession(): Promise<void> {
    const session = this.session!;
    const focus = this.getFocusSummary();
    session.totalPassiveDurationMs = focus.passiveTimeMs;
    session.totalSuspendedDurationMs = focus.suspendedTimeMs;
    session.enteredPassiveAt = null;
    session.enteredSuspendedAt = null;
    this.recordTransition("ended");
    session.state = "ended";
    session.endTime = Date.now();
    this.clearTimers();
    await this.persist();

    let reviewChunks: ContentChunk[] = [];
    try {
      const stored = await browser.storage.local.get(STORAGE_KEYS.SESSION_CHUNKS);
      reviewChunks = (stored[STORAGE_KEYS.SESSION_CHUNKS] ?? []) as ContentChunk[];
    } catch (error) {
      console.warn("[MindEase] Could not load session source text:", error);
    }
    try {
      await browser.storage.local.set({
        latestReviewChunks: { sessionId: session.sessionId, chunks: reviewChunks },
      });
      await browser.storage.local.remove(STORAGE_KEYS.SESSION_CHUNKS);
    } catch (error) {
      console.warn("[MindEase] Could not archive session source text:", error);
    }
    try {
      await this.onLayer3EndSession?.(reviewChunks, this.getHighlights(), this.getTabs(), focus);
    } finally {
      await this.onLayer2EndSession?.();
    }
  }

  /* ─── Reset ──────────────────────────────────────────────────────────── */

  async reset(): Promise<void> {
    if (this.ending) await this.ending.catch(() => {});
    this.clearTimers();
    this.session = null;
    try {
      await browser.storage.local.remove([
        STORAGE_KEYS.WORKSPACE,
        STORAGE_KEYS.SESSION_CHUNKS,
      ]);
    } catch (err) {
      console.warn("[MindEase] Workspace remove failed:", err);
    }
  }

  /* ─── State Transitions (private) ────────────────────────────────────── */

  private recordTransition(toState: SessionState, timestamp = Date.now()): void {
    if (!this.session) return;
    const fromState = this.session.state;
    this.session.stateTransitions.push({ fromState, toState, timestamp });
  }

  private transitionToPassive(at = Date.now()): void {
    if (!this.session || this.session.state !== "active") return;
    this.recordTransition("passive", at);
    this.session.state = "passive";
    this.session.enteredPassiveAt = at;
    void this.persist();
    this.startTimers();
  }

  private transitionToSuspended(at = Date.now()): void {
    if (!this.session || this.session.state !== "passive") return;
    this.recordTransition("suspended", at);
    if (this.session.enteredPassiveAt !== null) {
      this.session.totalPassiveDurationMs += at - this.session.enteredPassiveAt;
    }
    this.session.state = "suspended";
    this.session.enteredPassiveAt = null;
    this.session.enteredSuspendedAt = at;
    void this.persist();
    this.startTimers();
  }

  /* ─── Timer Management ──────────────────────────────────────────────── */

  private clearTimers(): void {
    if (this.idleTimer) { clearTimeout(this.idleTimer); this.idleTimer = null; }
    if (this.suspendTimer) { clearTimeout(this.suspendTimer); this.suspendTimer = null; }
    if (this.endTimer) { clearTimeout(this.endTimer); this.endTimer = null; }
  }

  private startTimers(): void {
    this.clearTimers();

    // After IDLE_TO_PASSIVE_MS of no activity → passive
    if (this.session?.state === "active") {
      const passiveAt = this.session.lastActivityAt + IDLE_TO_PASSIVE_MS;
      this.idleTimer = setTimeout(() => this.transitionToPassive(passiveAt), Math.max(0, passiveAt - Date.now()));
    }

    // After PASSIVE_TO_SUSPENDED_MS in passive → suspended
    if (this.session?.state === "passive") {
      const suspendedAt = (this.session.enteredPassiveAt ?? this.session.lastActivityAt) + PASSIVE_TO_SUSPENDED_MS;
      this.suspendTimer = setTimeout(() => this.transitionToSuspended(suspendedAt), Math.max(0, suspendedAt - Date.now()));
    }
    if (this.session?.state === "suspended") {
      const endedAt = (this.session.enteredSuspendedAt ?? Date.now()) + SUSPENDED_TO_ENDED_MS;
      this.endTimer = setTimeout(() => {
        void this.endSession().catch(error => console.warn("[MindEase] Automatic session end failed:", error));
      }, Math.max(0, endedAt - Date.now()));
    }
  }

  /* ─── Check if session should exist (for content script guard) ──────── */

  hasActiveSession(): boolean {
    return this.session !== null && this.session.state !== "ended";
  }
}

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

/* ─── SessionManager ─────────────────────────────────────────────────────── */

export class SessionManager {
  private session: WorkspaceSession | null = null;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private suspendTimer: ReturnType<typeof setTimeout> | null = null;
  private endTimer: ReturnType<typeof setTimeout> | null = null;

  // Callbacks — set by background to wire into existing layers
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
      const result = await browser.storage.local.get(STORAGE_KEYS.WORKSPACE);
      const saved = result[STORAGE_KEYS.WORKSPACE] as WorkspaceSession | undefined;
      if (!saved || saved.state === "ended") return false;

      this.session = saved;

      // If was active but last activity was > IDLE timeout ago, transition
      if (saved.state === "active" && Date.now() - saved.lastActivityAt > IDLE_TO_PASSIVE_MS) {
        this.session.state = "passive";
        this.session.enteredPassiveAt = Date.now();
      }
      if (saved.state === "passive" && Date.now() - (saved.enteredPassiveAt ?? saved.lastActivityAt) > PASSIVE_TO_SUSPENDED_MS) {
        this.session.state = "suspended";
        this.session.enteredSuspendedAt = Date.now();
      }

      this.startTimers();
      return true;
    } catch {
      return false;
    }
  }

  private async persist(): Promise<void> {
    if (!this.session) return;
    await browser.storage.local.set({ [STORAGE_KEYS.WORKSPACE]: this.session });
  }

  /* ─── Getters ────────────────────────────────────────────────────────── */

  getState(): SessionState {
    return this.session?.state ?? "ended";
  }

  getSessionId(): string | null {
    return this.session?.sessionId ?? null;
  }

  getTabs(): TabResource[] {
    return this.session?.tabs ?? [];
  }

  getHighlights(): HighlightNote[] {
    if (!this.session) return [];
    return this.session.tabs.flatMap(t => t.highlights);
  }

  getFocusSummary(): FocusSummary {
    if (!this.session) {
      return { totalTimeMs: 0, focusedTimeMs: 0, interruptionCount: 0, longestDistractionMs: 0, passiveTimeMs: 0, suspendedTimeMs: 0 };
    }
    const now = Date.now();
    const elapsed = now - this.session.startTime;
    const passiveMs = this.session.totalPassiveDurationMs;
    const suspendedMs = this.session.totalSuspendedDurationMs;
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

  registerTab(tabId: number, url: string, sourceType: "pdf" | "video" | "website" | "lecture", title: string): void {
    const now = Date.now();

    // Create session if none exists
    if (!this.session) {
      const profile = { userId: "guest", learningStyle: "text", attentionSpan: "medium", anchorNeed: false, condition: "none", updatedAt: now };
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
      this.onActivity();
      return;
    }

    this.session.tabs.push({
      tabId,
      url,
      title,
      sourceType,
      joinedAt: now,
      lastActiveAt: now,
      highlights: [],
    });

    this.onActivity();
    this.persist();
  }

  removeTab(tabId: number): void {
    if (!this.session) return;
    this.session.tabs = this.session.tabs.filter(t => t.tabId !== tabId);

    // If no more tabs, start end timer
    if (this.session.tabs.length === 0) {
      this.transitionToSuspended();
      this.scheduleEndIfNoTabs();
    }

    this.persist();
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
    this.persist();
  }

  /* ─── Session End ────────────────────────────────────────────────────── */

  async endSession(): Promise<void> {
    if (!this.session) return;

    this.recordTransition("ended");
    this.session.state = "ended";
    this.session.endTime = Date.now();
    this.clearTimers();
    await this.persist();

    // Call Layer 3 endSession with workspace data
    if (this.onLayer3EndSession) {
      try {
        const stored = await browser.storage.local.get("sessionChunks");
        const chunks = (stored.sessionChunks ?? []) as ContentChunk[];
        const highlights = this.getHighlights();
        const tabs = this.getTabs();
        const focus = this.getFocusSummary();
        await this.onLayer3EndSession(chunks, highlights, tabs, focus);
      } catch {
        const highlights = this.getHighlights();
        const tabs = this.getTabs();
        const focus = this.getFocusSummary();
        await this.onLayer3EndSession(undefined, highlights, tabs, focus);
      }
    }

    // Call Layer 2 endSession
    if (this.onLayer2EndSession) {
      await this.onLayer2EndSession();
    }

    this.session = null;
  }

  /* ─── Reset ──────────────────────────────────────────────────────────── */

  async reset(): Promise<void> {
    this.clearTimers();
    this.session = null;
    await browser.storage.local.remove(STORAGE_KEYS.WORKSPACE);
  }

  /* ─── State Transitions (private) ────────────────────────────────────── */

  private recordTransition(toState: SessionState): void {
    if (!this.session) return;
    const fromState = this.session.state;
    this.session.stateTransitions.push({ fromState, toState, timestamp: Date.now() });
  }

  private transitionToPassive(): void {
    if (!this.session || this.session.state !== "active") return;
    this.recordTransition("passive");
    this.session.state = "passive";
    this.session.enteredPassiveAt = Date.now();
    this.persist();
  }

  private transitionToSuspended(): void {
    if (!this.session || this.session.state === "suspended" || this.session.state === "ended") return;

    const now = Date.now();
    this.recordTransition("suspended");

    // Track time spent in previous state
    if (this.session.state === "active" && this.session.enteredPassiveAt) {
      // was active → passive transition already measured, but if we skip passive:
    } else if (this.session.state === "passive" && this.session.enteredPassiveAt) {
      this.session.totalPassiveDurationMs += now - this.session.enteredPassiveAt;
    }

    this.session.state = "suspended";
    this.session.enteredSuspendedAt = now;
    this.persist();
  }

  private scheduleEndIfNoTabs(): void {
    // Wait SUSPENDED_TO_ENDED_MS after last tab closed, then end
    if (this.endTimer) clearTimeout(this.endTimer);
    this.endTimer = setTimeout(() => {
      if (this.session && this.session.tabs.length === 0) {
        this.endSession();
      }
    }, SUSPENDED_TO_ENDED_MS);
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
      this.idleTimer = setTimeout(() => this.transitionToPassive(), IDLE_TO_PASSIVE_MS);
    }

    // After PASSIVE_TO_SUSPENDED_MS in passive → suspended
    if (this.session?.state === "passive") {
      const remaining = PASSIVE_TO_SUSPENDED_MS - (Date.now() - (this.session.enteredPassiveAt ?? this.session.lastActivityAt));
      if (remaining > 0) {
        this.suspendTimer = setTimeout(() => this.transitionToSuspended(), remaining);
      } else {
        this.transitionToSuspended();
      }
    }
  }

  /* ─── Check if session should exist (for content script guard) ──────── */

  hasActiveSession(): boolean {
    return this.session !== null && this.session.state !== "ended";
  }
}

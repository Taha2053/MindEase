import { BookOpen, Sparkles, Layout, MousePointerClick, Video, Brain, ShieldCheck, HelpCircle } from "lucide-react";

interface HelpTopic {
  title: string;
  badge: string;
  icon: typeof BookOpen;
  points: { title: string; desc: string }[];
}

const TOPICS: HelpTopic[] = [
  {
    title: "1. Quick Start & Baseline Setup",
    badge: "Setup",
    icon: Sparkles,
    points: [
      {
        title: "Onboarding Questionnaire",
        desc: "When first launched, MindEase prompts you for your core preferences: visual vs. text format, comfortable reading pace, chunking span, and optional support needs (e.g. ADHD, dyslexia).",
      },
      {
        title: "Fully User-Controlled",
        desc: "Your baseline preferences are never locked or assumed. You can adjust any preference at any time inside the 'My learning puzzle' section of the dashboard.",
      },
      {
        title: "Session History Snapshots",
        desc: "Each finished study session logs a configuration snapshot, letting you review how your setup evolved across different subjects.",
      },
    ],
  },
  {
    title: "2. Transforming Learning Material",
    badge: "Core Feature",
    icon: Layout,
    points: [
      {
        title: "Non-Destructive Annotation",
        desc: "MindEase preserves the original factual text, equations, and citations. It restructures long walls of text into digestible chunks rather than rewriting content.",
      },
      {
        title: "Adaptation Prompts",
        desc: "On educational articles or documentation, accept 'Structured Reading' for scannable step-by-step chunks, or 'Reading with Visual Explanation' for diagrams alongside text.",
      },
      {
        title: "Formula Typesetting",
        desc: "Mathematical notation and LaTeX formulas render cleanly using integrated KaTeX without breaking the surrounding layout.",
      },
    ],
  },
  {
    title: "3. Interactive Reading Sidebar & Audio",
    badge: "Tools",
    icon: MousePointerClick,
    points: [
      {
        title: "Adaptable Sidebar",
        desc: "Switch seamlessly between Content, Visuals, and Session tabs. Minimize the sidebar or dock it to the left/right edge. If closed, the floating reopen button restores your reading place.",
      },
      {
        title: "Text-to-Speech (TTS)",
        desc: "Click 'Read Aloud' for synchronized section audio narration with play, pause, and rate controls powered by Puter.js and browser speech synthesis.",
      },
      {
        title: "Context Explainer & Image OCR",
        desc: "Highlight any complex sentence and right-click 'Explain with MindEase' for a plain-language tutor breakdown. Right-click any diagram or equation to extract its text via OCR.",
      },
    ],
  },
  {
    title: "4. Animated Video Generation",
    badge: "Video Studio",
    icon: Video,
    points: [
      {
        title: "Manim-Powered Visualizations",
        desc: "Open Video Studio to turn papers or complex topics into animated Manim scenes with synchronized pedagogical voiceover.",
      },
      {
        title: "DeepSeek Reasoning Pipeline",
        desc: "DeepSeek plans the scene beats and generates valid Manim code, which the rendering worker compiles into an MP4 video.",
      },
      {
        title: "Media Library Persistence",
        desc: "Rendered animations and diagram assets stay saved in your Review Library so you can re-watch them after study sessions end.",
      },
    ],
  },
  {
    title: "5. How Learning Adaptation Works",
    badge: "System",
    icon: Brain,
    points: [
      {
        title: "User-Directed Layouts",
        desc: "Every adaptation decision is directly driven by your saved preferences (chunk size, visual density, reading pace) and manual overrides.",
      },
      {
        title: "Behavior Telemetry",
        desc: "Reading events (pauses, highlights, skips) are tracked strictly as passive session observations to build your learning insights, not secret tests.",
      },
      {
        title: "No Inferred Mental States",
        desc: "MindEase never claims to diagnose conditions or measure neurological activity. You always maintain full control over every setting.",
      },
    ],
  },
  {
    title: "6. Accounts, Privacy & Data Storage",
    badge: "Privacy",
    icon: ShieldCheck,
    points: [
      {
        title: "Private by Default",
        desc: "Without an account, all settings, session history, and cached diagrams live exclusively in your browser's local storage and IndexedDB.",
      },
      {
        title: "Optional Cloud Synchronization",
        desc: "Sign in with an optional account to sync profiles and session logs across machines using end-to-end Supabase authentication.",
      },
      {
        title: "Total Data Deletion",
        desc: "Under 'Account & data', you can export your entire telemetry history as JSON or wipe all local and cloud data in one click.",
      },
    ],
  },
];

export function HelpPage() {
  return (
    <div className="section-card help-page-container">
      <div className="help-page-header">
        <div className="help-header-badge">
          <HelpCircle size={14} />
          <span>Documentation & Guide</span>
        </div>
        <h1>How MindEase Works</h1>
        <p className="help-header-subtitle">
          Everything you need to know about setting up your preferences, adapting reading materials,
          generating videos, and managing your study privacy.
        </p>
      </div>

      <div className="help-topics-grid">
        {TOPICS.map((topic, i) => (
          <div key={i} className="help-topic-card">
            <div className="help-topic-head">
              <div className="topic-icon-wrap">
                <topic.icon size={18} />
              </div>
              <div style={{ flex: 1 }}>
                <span className="topic-badge">{topic.badge}</span>
                <h2 className="topic-title">{topic.title}</h2>
              </div>
            </div>

            <div className="topic-points-list">
              {topic.points.map((pt, j) => (
                <div key={j} className="topic-point-item">
                  <div className="point-bullet" />
                  <div className="point-content">
                    <strong className="point-title">{pt.title}</strong>
                    <p className="point-desc">{pt.desc}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>

      <div className="help-footer-tip">
        <strong>Need technical assistance?</strong> Check the extension popup for live status, or visit the
        Account &amp; Data tab to inspect your local storage and API keys.
      </div>
    </div>
  );
}

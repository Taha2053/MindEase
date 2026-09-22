import { createRoot } from "react-dom/client";
import { VideoStudio } from "./VideoStudio";
import { loadTheme, applyTheme } from "@/utils/themeManager";
import "@/styles/theme.css";
import "@/session/dashboard/dashboard.css";
import "@/styles/glass.css";
import "./video.css";
void loadTheme().then(applyTheme);
createRoot(document.getElementById("root")!).render(<main className="video-page" style={{ maxWidth: 1200, margin: "32px auto", padding: 24 }}><a className="dashboard-link" href="../session/dashboard/dashboard.html">MindEase dashboard</a><VideoStudio /></main>);

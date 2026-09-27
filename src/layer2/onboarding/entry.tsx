import { createRoot } from "react-dom/client";
import browser from "webextension-polyfill";
import { Onboarding } from "./onboarding";

createRoot(document.getElementById("root")!).render(<Onboarding onComplete={() => {
  location.replace(browser.runtime.getURL("src/session/dashboard/dashboard.html#profile"));
}} />);

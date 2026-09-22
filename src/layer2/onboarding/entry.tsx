import browser from "webextension-polyfill";
import { STORAGE_KEYS } from "@/types";
void browser.storage.local.get(STORAGE_KEYS.PROFILE).then(result => {
  location.replace(browser.runtime.getURL(result[STORAGE_KEYS.PROFILE] ? "src/session/dashboard/dashboard.html#profile" : "src/popup/popup.html"));
});

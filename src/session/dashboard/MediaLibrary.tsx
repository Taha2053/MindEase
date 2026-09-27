import { useEffect, useState } from "react";
import browser from "webextension-polyfill";

export interface SavedVideo { id: string; concept: string; video_url: string; title: string; savedAt: number }
export function MediaLibrary() {
  const [videos, setVideos] = useState<SavedVideo[]>([]);
  useEffect(() => {
    const load = () => void browser.storage.local.get("mindease_saved_videos").then(result => setVideos((result.mindease_saved_videos as SavedVideo[]) ?? []));
    load(); browser.storage.onChanged.addListener(load);
    return () => browser.storage.onChanged.removeListener(load);
  }, []);
  return <section className="section-card"><h2>Saved videos</h2><p>Video files stay on the server that generated them. These saved links remain available after a session ends.</p>{videos.length === 0 ? <p>No saved videos yet. Open a completed result in Video studio to add it here.</p> : videos.map(video => <figure key={video.id}><figcaption>{video.title} — {video.concept}</figcaption><video controls preload="metadata" src={video.video_url} style={{width: "100%", maxWidth: 720}} /><p><a href={video.video_url} target="_blank" rel="noreferrer">Open video</a></p></figure>)}</section>;
}

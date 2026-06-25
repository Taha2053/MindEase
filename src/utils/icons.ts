import brainData from "lucide/dist/esm/icons/brain.mjs";
import starData from "lucide/dist/esm/icons/star.mjs";
import xData from "lucide/dist/esm/icons/x.mjs";
import sunData from "lucide/dist/esm/icons/sun.mjs";
import moonData from "lucide/dist/esm/icons/moon.mjs";
import refreshCwData from "lucide/dist/esm/icons/refresh-cw.mjs";
import arrowRightData from "lucide/dist/esm/icons/arrow-right.mjs";
import arrowLeftRightData from "lucide/dist/esm/icons/arrow-left-right.mjs";
import fileTextData from "lucide/dist/esm/icons/file-text.mjs";
import filmData from "lucide/dist/esm/icons/film.mjs";
import globeData from "lucide/dist/esm/icons/globe.mjs";
import graduationCapData from "lucide/dist/esm/icons/graduation-cap.mjs";
import folderOpenData from "lucide/dist/esm/icons/folder-open.mjs";
import linkData from "lucide/dist/esm/icons/link.mjs";
import targetData from "lucide/dist/esm/icons/target.mjs";
import messageCircleData from "lucide/dist/esm/icons/message-circle.mjs";
import messageSquareData from "lucide/dist/esm/icons/message-square.mjs";
import imageData from "lucide/dist/esm/icons/image.mjs";
import timerData from "lucide/dist/esm/icons/timer.mjs";
import bookOpenTextData from "lucide/dist/esm/icons/book-open-text.mjs";
import alignStartVerticalData from "lucide/dist/esm/icons/align-start-vertical.mjs";
import chartBarIncreasingData from "lucide/dist/esm/icons/chart-bar-increasing.mjs";
import triangleAlertData from "lucide/dist/esm/icons/triangle-alert.mjs";
import sparklesData from "lucide/dist/esm/icons/sparkles.mjs";
import volume2Data from "lucide/dist/esm/icons/volume-2.mjs";
import type { IconNode } from "lucide";

const ICON_MAP: Record<string, IconNode> = {
  brain: brainData,
  star: starData,
  x: xData,
  sun: sunData,
  moon: moonData,
  "refresh-cw": refreshCwData,
  "arrow-right": arrowRightData,
  "arrow-left-right": arrowLeftRightData,
  "file-text": fileTextData,
  film: filmData,
  globe: globeData,
  "graduation-cap": graduationCapData,
  "folder-open": folderOpenData,
  link: linkData,
  target: targetData,
  "message-circle": messageCircleData,
  "message-square": messageSquareData,
  image: imageData,
  timer: timerData,
  "book-open-text": bookOpenTextData,
  "align-start-vertical": alignStartVerticalData,
  "bar-chart-3": chartBarIncreasingData,
  "alert-triangle": triangleAlertData,
  sparkles: sparklesData,
  "volume-2": volume2Data,
};

function renderSVG(elements: IconNode, size = 20, className?: string): string {
  const attrs = [
    `width="${size}"`,
    `height="${size}"`,
    `viewBox="0 0 24 24"`,
    `fill="none"`,
    `stroke="currentColor"`,
    `stroke-width="2"`,
    `stroke-linecap="round"`,
    `stroke-linejoin="round"`,
  ];
  if (className) attrs.push(`class="${className}"`);
  const inner = elements
    .map(([tag, attrs]) => {
      const attrStr = Object.entries(attrs)
        .map(([k, v]) => `${k}="${v}"`)
        .join(" ");
      return `<${tag} ${attrStr}/>`;
    })
    .join("");
  return `<svg ${attrs.join(" ")}>${inner}</svg>`;
}

export function iconHTML(name: string, _className = ""): string {
  const data = ICON_MAP[name];
  if (!data) return "";
  return renderSVG(data, 18, _className || undefined);
}

import { createElement, icons } from "lucide";
import type { IconNode } from "lucide";

export function iconHTML(name: string, className = ""): string {
  const iconData = icons[name as keyof typeof icons] as IconNode | undefined;
  if (!iconData) {
    console.warn(`[Icons] Unknown icon: ${name}`);
    return "";
  }
  const svg = createElement(iconData, {
    class: className,
    width: "1em",
    height: "1em",
    stroke: "currentColor",
    fill: "none",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
  });
  return svg.outerHTML;
}

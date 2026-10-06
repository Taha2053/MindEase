import { useId } from "react";

export interface InkBackgroundProps {
  theme?: "light" | "dark";
  className?: string;
}

/**
 * InkBackground
 * Chinese shanshui (山水) royal blue landscape with classical Chinese silhouettes:
 * - Multi-tiered pagoda tower (宝塔)
 * - Arched moon bridge (拱桥)
 * - Solitary fisherman on sampan boat (渔舟唱晚)
 * - Soaring cranes in flight (仙鹤凌云)
 * - Ancient gnarled pine trees & ax-cut crags (松岩)
 * - Traditional red seal stamp (丹砂印章)
 * Palette: Royal Blue, Sapphire, Porcelain Mist, Night Ink
 */
export default function InkBackground({
  theme = "light",
  className = "",
}: InkBackgroundProps) {
  const isDark = theme === "dark";
  const idPrefix = useId().replace(/:/g, "_");

  return (
    <div
      className={`ink-background ink-background--${theme} ${className}`.trim()}
      style={{
        position: "fixed",
        inset: 0,
        width: "100vw",
        height: "100vh",
        zIndex: -1,
        pointerEvents: "none",
        overflow: "hidden",
      }}
      aria-hidden="true"
    >
      <style>{`
        @keyframes shanshuiMistDrift1 {
          0% {
            transform: translate3d(0, 0, 0);
            opacity: 0.52;
          }
          50% {
            transform: translate3d(36px, -3px, 0);
            opacity: 0.72;
          }
          100% {
            transform: translate3d(0, 0, 0);
            opacity: 0.52;
          }
        }
        @keyframes shanshuiMistDrift2 {
          0% {
            transform: translate3d(0, 0, 0);
            opacity: 0.40;
          }
          50% {
            transform: translate3d(-38px, 4px, 0);
            opacity: 0.64;
          }
          100% {
            transform: translate3d(0, 0, 0);
            opacity: 0.40;
          }
        }
        .shanshui-mist-layer-1 {
          animation: shanshuiMistDrift1 38s ease-in-out infinite;
          will-change: transform, opacity;
        }
        .shanshui-mist-layer-2 {
          animation: shanshuiMistDrift2 48s ease-in-out infinite;
          will-change: transform, opacity;
        }
        @media (prefers-reduced-motion: reduce) {
          .shanshui-mist-layer-1,
          .shanshui-mist-layer-2 {
            animation: none !important;
            transform: none !important;
          }
        }
      `}</style>

      <svg
        viewBox="0 0 1440 900"
        preserveAspectRatio="xMaxYMax slice"
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          pointerEvents: "none",
          display: "block",
        }}
        aria-hidden="true"
      >
        <defs>
          {/* Atmospheric sky gradient */}
          {/* Atmospheric sky wash: Royal Blue mist */}
          <linearGradient id={`${idPrefix}-sky`} x1="10%" y1="0%" x2="80%" y2="100%">
            <stop offset="0%" stopColor={isDark ? "#060d1e" : "#f0f6ff"} />
            <stop offset="40%" stopColor={isDark ? "#0a1738" : "#e0edff"} />
            <stop offset="75%" stopColor={isDark ? "#0e1f4d" : "#d4e6fe"} />
            <stop offset="100%" stopColor={isDark ? "#142862" : "#c6ddfc"} />
          </linearGradient>

          {/* Distant peaks gradient: Royal Blue atmospheric wash */}
          <linearGradient id={`${idPrefix}-distant`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={isDark ? "#1e3a8a" : "#2563eb"} stopOpacity={isDark ? 0.70 : 0.42} />
            <stop offset="50%" stopColor={isDark ? "#172554" : "#3b82f6"} stopOpacity={isDark ? 0.45 : 0.25} />
            <stop offset="100%" stopColor={isDark ? "#0c1735" : "#eff6ff"} stopOpacity={0.06} />
          </linearGradient>

          {/* Distant secondary ridge gradient */}
          <linearGradient id={`${idPrefix}-distant-sub`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={isDark ? "#1d4ed8" : "#3b82f6"} stopOpacity={isDark ? 0.60 : 0.36} />
            <stop offset="70%" stopColor={isDark ? "#1e3a8a" : "#60a5fa"} stopOpacity={isDark ? 0.35 : 0.16} />
            <stop offset="100%" stopColor={isDark ? "#0e1b3d" : "#eff6ff"} stopOpacity={0.04} />
          </linearGradient>

          {/* Midground mountain crags */}
          <linearGradient id={`${idPrefix}-mid`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={isDark ? "#1e40af" : "#1d4ed8"} stopOpacity={isDark ? 0.94 : 0.85} />
            <stop offset="40%" stopColor={isDark ? "#1e3a8a" : "#1e40af"} stopOpacity={isDark ? 0.90 : 0.75} />
            <stop offset="85%" stopColor={isDark ? "#172554" : "#1e3a8a"} stopOpacity={isDark ? 0.75 : 0.45} />
            <stop offset="100%" stopColor={isDark ? "#0c1530" : "#dbeafe"} stopOpacity={isDark ? 0.40 : 0.15} />
          </linearGradient>

          {/* Foreground inked cliff face */}
          <linearGradient id={`${idPrefix}-fg`} x1="0%" y1="0%" x2="0%" y2="100%">
            <stop offset="0%" stopColor={isDark ? "#0a1124" : "#0f172a"} stopOpacity={0.96} />
            <stop offset="50%" stopColor={isDark ? "#060a16" : "#1e293b"} stopOpacity={0.98} />
            <stop offset="100%" stopColor={isDark ? "#03060c" : "#0f172a"} stopOpacity={1} />
          </linearGradient>

          {/* Drifting mist layer 1 gradient */}
          <linearGradient id={`${idPrefix}-mist1`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={isDark ? "#1e3a8a" : "#eff6ff"} stopOpacity={isDark ? 0.08 : 0.35} />
            <stop offset="35%" stopColor={isDark ? "#2563eb" : "#ffffff"} stopOpacity={isDark ? 0.22 : 0.75} />
            <stop offset="70%" stopColor={isDark ? "#1d4ed8" : "#dbeafe"} stopOpacity={isDark ? 0.18 : 0.60} />
            <stop offset="100%" stopColor={isDark ? "#172554" : "#eff6ff"} stopOpacity={isDark ? 0.08 : 0.35} />
          </linearGradient>

          {/* Drifting mist layer 2 gradient */}
          <linearGradient id={`${idPrefix}-mist2`} x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor={isDark ? "#172554" : "#eff6ff"} stopOpacity={isDark ? 0.10 : 0.45} />
            <stop offset="45%" stopColor={isDark ? "#1e3a8a" : "#ffffff"} stopOpacity={isDark ? 0.26 : 0.82} />
            <stop offset="85%" stopColor={isDark ? "#1d4ed8" : "#dbeafe"} stopOpacity={isDark ? 0.18 : 0.58} />
            <stop offset="100%" stopColor={isDark ? "#0f172a" : "#bfdbfe"} stopOpacity={isDark ? 0.12 : 0.40} />
          </linearGradient>

          {/* Celestial royal disc glow */}
          <radialGradient id={`${idPrefix}-celestial`} cx="50%" cy="50%" r="50%">
            <stop offset="0%" stopColor={isDark ? "#dbeafe" : "#ffffff"} stopOpacity={isDark ? 0.35 : 0.95} />
            <stop offset="45%" stopColor={isDark ? "#60a5fa" : "#eff6ff"} stopOpacity={isDark ? 0.18 : 0.55} />
            <stop offset="80%" stopColor={isDark ? "#2563eb" : "#dbeafe"} stopOpacity={isDark ? 0.06 : 0.18} />
            <stop offset="100%" stopColor={isDark ? "#0f172a" : "#eff6ff"} stopOpacity={0} />
          </radialGradient>
        </defs>

        {/* 1. Atmospheric Canvas Sky Wash */}
        <rect width="1440" height="900" fill={`url(#${idPrefix}-sky)`} />

        {/* 2. Celestial Disc (Porcelain Sun / Jade Moon) */}
        <g className="shanshui-celestial">
          <circle
            cx="1160"
            cy="175"
            r="68"
            fill={`url(#${idPrefix}-celestial)`}
          />
          <circle
            cx="1160"
            cy="175"
            r="32"
            fill={isDark ? "#e5f0ed" : "#ffffff"}
            opacity={isDark ? 0.20 : 0.65}
          />
        </g>

        {/* 3. Wild Geese in Flight (飞雁) - Adding scale and tranquil movement */}
        {/* 3. Graceful Flying Cranes (仙鹤凌云) */}
        <g
          className="shanshui-cranes"
          fill={isDark ? "#bfdbfe" : "#1e3a8a"}
          opacity={isDark ? 0.70 : 0.75}
        >
          {/* Crane 1 */}
          <path d="M -12 3 Q -4 -3 0 0 Q 4 -3 12 3 Q 3 -1 0 1 Q -3 -1 -12 3 Z M 0 1 L 0 7 M -1 1 L -4 10 M 1 1 L 4 10" transform="translate(970, 160) scale(1.15) rotate(-12)" />
          {/* Crane 2 */}
          <path d="M -12 3 Q -4 -3 0 0 Q 4 -3 12 3 Q 3 -1 0 1 Q -3 -1 -12 3 Z" transform="translate(1008, 176) scale(0.95) rotate(-10)" />
          {/* Crane 3 */}
          <path d="M -12 3 Q -4 -3 0 0 Q 4 -3 12 3 Q 3 -1 0 1 Q -3 -1 -12 3 Z" transform="translate(1036, 196) scale(0.85) rotate(-8)" />
          {/* Crane 4 */}
          <path d="M -12 3 Q -4 -3 0 0 Q 4 -3 12 3 Q 3 -1 0 1 Q -3 -1 -12 3 Z" transform="translate(1066, 214) scale(0.72) rotate(-14)" />
          {/* Crane 5 */}
          <path d="M -12 3 Q -4 -3 0 0 Q 4 -3 12 3 Q 3 -1 0 1 Q -3 -1 -12 3 Z" transform="translate(992, 198) scale(0.80) rotate(-15)" />
        </g>

        {/* 4. Traditional Chinese Cinnabar Red Seal (印章: 山水) */}
        <g className="shanshui-seal" transform="translate(1332, 68)">
          {/* Square red chop in cinnabar #a33c35 */}
          <rect
            x="0"
            y="0"
            width="46"
            height="46"
            rx="4"
            fill="#a33c35"
            stroke={isDark ? "rgba(229, 240, 237, 0.25)" : "rgba(22, 48, 46, 0.15)"}
            strokeWidth="1"
          />
          {/* Inner hairline border */}
          <rect
            x="3"
            y="3"
            width="40"
            height="40"
            rx="2.5"
            fill="none"
            stroke="#f5f8f6"
            strokeWidth="0.8"
            opacity="0.65"
          />
          {/* Seal script: 右为山 (Mountain), 左为水 (Water) in intaglio porcelain relief */}
          <g stroke="#f5f8f6" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" fill="none" opacity="0.92">
            {/* Character: 水 (left half of seal) */}
            <path d="M 16 11 Q 13 18 16 23 Q 19 28 15 34" />
            <path d="M 8 16 Q 11 20 8 24" />
            <path d="M 9 29 L 8 33" />
            <path d="M 22 16 Q 19 20 22 24" />
            <path d="M 21 29 L 22 33" />

            {/* Character: 山 (right half of seal) */}
            <path d="M 34 11 L 34 34" />
            <path d="M 28 28 L 40 28" />
            <path d="M 28 17 L 28 28" />
            <path d="M 40 17 L 40 28" />
          </g>

          {/* Secondary small companion seal beneath */}
          <g transform="translate(13, 52)">
            <rect
              x="0"
              y="0"
              width="20"
              height="30"
              rx="9"
              fill="#a33c35"
              stroke={isDark ? "rgba(229, 240, 237, 0.25)" : "rgba(22, 48, 46, 0.15)"}
              strokeWidth="0.8"
            />
            {/* Delicate seal emblem for 静 (Serenity / Tranquility) */}
            <g stroke="#f5f8f6" strokeWidth="1.2" strokeLinecap="round" fill="none" opacity="0.85">
              <path d="M 10 6 L 10 24" />
              <path d="M 5 11 L 15 11" />
              <path d="M 5 18 L 15 18" />
              <circle cx="10" cy="8" r="0.8" fill="#f5f8f6" />
            </g>
          </g>
        </g>

        {/* 5. Layer 1: Distant Misty Peaks (远山) - Sweeping asymmetrical landscape */}
        <g className="shanshui-distant-peaks">
          {/* Main distant range */}
          <path
            d="M 0 760 C 120 740, 240 710, 360 690 C 460 670, 520 645, 620 640 C 700 635, 780 590, 860 550 C 920 520, 960 480, 1020 440 C 1060 410, 1100 330, 1150 280 C 1170 260, 1195 285, 1220 325 C 1250 310, 1285 240, 1330 250 C 1360 260, 1385 320, 1420 350 C 1435 365, 1440 375, 1440 380 L 1440 900 L 0 900 Z"
            fill={`url(#${idPrefix}-distant)`}
          />
          {/* Secondary distant ridge for ink wash depth */}
          <path
            d="M 740 620 C 810 590, 880 520, 950 470 C 990 440, 1030 380, 1070 340 C 1090 320, 1115 350, 1140 390 C 1170 440, 1220 420, 1260 450 C 1310 490, 1370 510, 1440 530 L 1440 900 L 740 900 Z"
            fill={`url(#${idPrefix}-distant-sub)`}
          />
        </g>

        {/* 6. Layer 2: Upper Valley Drifting Mist (高岚浮动) */}
        <g className="shanshui-mist-layer-1">
          <path
            d="M -60 620 C 80 580, 220 640, 360 600 C 500 560, 640 610, 780 570 C 920 530, 1060 580, 1200 540 C 1320 510, 1420 550, 1520 520 L 1520 720 C 1400 750, 1280 710, 1140 740 C 980 770, 840 720, 700 760 C 560 790, 420 740, 280 770 C 140 800, 20 750, -60 780 Z"
            fill={`url(#${idPrefix}-mist1)`}
          />
        </g>

        {/* 7. Layer 3: Midground Mountain Crags & Pavilion (中景奇峰 & 烟渚亭) */}
        <g className="shanshui-mid-crags">
          {/* Midground crag silhouettes */}
          <path
            d="M 180 900 C 260 840, 340 810, 420 780 C 500 750, 580 720, 650 690 C 710 660, 760 620, 820 570 C 860 535, 895 560, 930 520 C 960 485, 990 430, 1030 395 C 1055 370, 1080 390, 1100 440 C 1130 430, 1160 410, 1195 440 C 1230 470, 1260 440, 1300 430 C 1340 420, 1380 460, 1410 490 C 1425 510, 1435 525, 1440 530 L 1440 900 L 180 900 Z"
            fill={`url(#${idPrefix}-mid)`}
          />

          {/* Ax-cut texture facet contours (斧劈皴法) */}
          <path
            d="M 930 520 C 950 560, 970 610, 980 670 C 990 720, 1020 760, 1050 820 L 1020 830 C 980 760, 960 700, 940 640 Z"
            fill={isDark ? "#102624" : "#16302e"}
            opacity={isDark ? 0.45 : 0.22}
          />
          <path
            d="M 1030 395 C 1050 450, 1070 520, 1080 580 C 1090 640, 1110 700, 1120 760 L 1105 765 C 1090 700, 1070 640, 1050 560 Z"
            fill={isDark ? "#102624" : "#16302e"}
            opacity={isDark ? 0.50 : 0.26}
          />
          <path
            d="M 1195 440 C 1220 500, 1240 560, 1250 630 C 1260 690, 1280 750, 1300 810 L 1285 815 C 1265 750, 1245 680, 1225 610 Z"
            fill={isDark ? "#102624" : "#16302e"}
            opacity={isDark ? 0.45 : 0.24}
          />

          {/* Classical Mountain Pavilion (山中凉亭) nestled on the cliff ledge */}
          {/* Multi-tiered Chinese Pagoda Tower (宝塔) on mountain ridge */}
          <g
            className="shanshui-pagoda"
            transform="translate(1155, 360)"
            fill={isDark ? "#081024" : "#1e293b"}
            opacity={isDark ? 0.92 : 0.85}
          >
            {/* Spire / Finial */}
            <path d="M 20 -10 L 21 0 L 19 0 Z" />
            <circle cx="20" cy="-6" r="1.5" />
            {/* Tier 1 (top) */}
            <path d="M 10 4 Q 15 2 20 0 Q 25 2 30 4 Q 26 5 20 4.5 Q 14 5 10 4 Z" />
            <rect x="15" y="4" width="10" height="7" rx="0.5" />
            {/* Tier 2 */}
            <path d="M 7 12 Q 14 9 20 7 Q 26 9 33 12 Q 28 13.5 20 12.8 Q 12 13.5 7 12 Z" />
            <rect x="13" y="12" width="14" height="9" rx="0.5" />
            {/* Tier 3 */}
            <path d="M 4 22 Q 12 18 20 16 Q 28 18 36 22 Q 30 24 20 23 Q 10 24 4 22 Z" />
            <rect x="11" y="22" width="18" height="11" rx="0.5" />
            {/* Tier 4 (base) */}
            <path d="M 0 34 Q 10 29 20 27 Q 30 29 40 34 Q 32 36.5 20 35.5 Q 8 36.5 0 34 Z" />
            <rect x="9" y="34" width="22" height="15" rx="0.5" />
            {/* Foundation stone terrace */}
            <path d="M 5 49 L 35 49 L 32 54 L 8 54 Z" />
          </g>

          {/* Traditional Chinese Moon Bridge (拱桥) in misty inlet */}
          <g
            className="shanshui-bridge"
            transform="translate(820, 680)"
            fill={isDark ? "#09132a" : "#1e293b"}
            opacity={isDark ? 0.85 : 0.75}
          >
            {/* Semicircular arch bridge */}
            <path d="M 0 30 Q 30 0 60 30 Q 30 12 0 30 Z" />
            {/* Bridge deck & balustrades */}
            <path d="M -4 28 Q 30 -3 64 28 L 62 31 Q 30 2 -2 31 Z" />
          </g>

          {/* Fisherman on a Sampan Boat (渔舟孤影) */}
          <g
            className="shanshui-sampan"
            transform="translate(740, 715)"
            fill={isDark ? "#09132a" : "#1e293b"}
            opacity={isDark ? 0.90 : 0.80}
          >
            {/* Curved hull of the sampan boat */}
            <path d="M 0 6 Q 20 12 44 6 Q 36 9 20 9 Q 8 9 0 6 Z" />
            {/* Woven bamboo mat awning (篷) */}
            <path d="M 14 6 Q 20 -2 26 6 Z" />
            {/* Solitary fisherman in conical bamboo hat (斗笠) with oar */}
            <circle cx="34" cy="1" r="2.5" />
            <path d="M 31 1 Q 34 -2 37 1 Z" />
            <path d="M 34 3 L 34 7" stroke={isDark ? "#09132a" : "#1e293b"} strokeWidth="1.2" />
            <line x1="33" y1="4" x2="42" y2="12" stroke={isDark ? "#09132a" : "#1e293b"} strokeWidth="1" />
          </g>
        </g>
        {/* 8. Layer 4: Lower Ravine Drifting Mist (低壑岚烟) */}
        <g className="shanshui-mist-layer-2">
          <path
            d="M -80 720 C 100 690, 260 740, 420 710 C 580 670, 740 730, 900 690 C 1060 660, 1220 710, 1380 680 C 1460 670, 1510 690, 1560 670 L 1560 840 C 1420 860, 1280 820, 1140 850 C 980 880, 840 830, 700 870 C 540 890, 380 850, 220 880 C 80 900, -20 860, -80 890 Z"
            fill={`url(#${idPrefix}-mist2)`}
          />
        </g>

        {/* 9. Layer 5: Foreground Inked Cliffs & Ancient Gnarled Pine (近景苍石 & 悬崖古松) */}
        <g className="shanshui-fg-cliffs">
          {/* Dense rock bluff base anchored in lower right */}
          <path
            d="M 620 900 C 700 860, 780 830, 860 800 C 920 780, 970 750, 1020 700 C 1060 660, 1100 630, 1160 610 C 1200 600, 1240 625, 1280 615 C 1330 605, 1380 630, 1440 650 L 1440 900 L 620 900 Z"
            fill={`url(#${idPrefix}-fg)`}
          />

          {/* Ancient twisted cliff pine (古松) rooted in the rock face */}
          <g className="shanshui-pine" fill={isDark ? "#091413" : "#16302e"}>
            {/* Main gnarled trunk arching left over the ravine */}
            <path d="M 1168 625 C 1160 595, 1140 575, 1105 565 C 1075 558, 1045 565, 1015 550 C 990 538, 970 545, 945 540 C 965 548, 985 552, 1005 558 C 1030 572, 1060 570, 1085 580 C 1110 592, 1135 615, 1152 640 Z" />

            {/* Branch 2 arching upward */}
            <path d="M 1085 572 C 1075 540, 1055 525, 1025 515 C 1010 510, 995 512, 980 508 C 995 518, 1015 522, 1035 528 C 1055 536, 1070 555, 1076 575 Z" />

            {/* Branch 3 extending right-upward */}
            <path d="M 1120 580 C 1125 545, 1145 528, 1175 518 C 1190 514, 1205 518, 1220 512 C 1205 524, 1188 526, 1170 535 C 1150 546, 1138 565, 1130 585 Z" />

            {/* Stylized Shanshui Pine Needle Fans (松针簇) */}
            {/* Cluster 1 - far left branch tip */}
            <g transform="translate(945, 536)">
              <path d="M -22 4 C -20 -10, -12 -18, 0 -20 C 12 -18, 20 -10, 22 4 C 14 -2, -14 -2, -22 4 Z" />
              <path d="M -16 6 C -14 -4, -8 -11, 0 -13 C 8 -11, 14 -4, 16 6 C 10 1, -10 1, -16 6 Z" opacity="0.8" />
            </g>

            {/* Cluster 2 - upper branch tip */}
            <g transform="translate(980, 506)">
              <path d="M -20 4 C -18 -8, -10 -16, 0 -18 C 10 -16, 18 -8, 20 4 C 12 -2, -12 -2, -20 4 Z" />
              <path d="M -14 6 C -12 -3, -6 -10, 0 -11 C 6 -10, 12 -3, 14 6 C 8 1, -8 1, -14 6 Z" opacity="0.8" />
            </g>

            {/* Cluster 3 - mid branch */}
            <g transform="translate(1022, 514)">
              <path d="M -22 4 C -20 -10, -12 -18, 0 -20 C 12 -18, 20 -10, 22 4 C 14 -2, -14 -2, -22 4 Z" />
            </g>

            {/* Cluster 4 - right upper branch */}
            <g transform="translate(1175, 516)">
              <path d="M -22 4 C -20 -10, -12 -18, 0 -20 C 12 -18, 20 -10, 22 4 C 14 -2, -14 -2, -22 4 Z" />
              <path d="M -16 6 C -14 -4, -8 -11, 0 -13 C 8 -11, 14 -4, 16 6 C 10 1, -10 1, -16 6 Z" opacity="0.8" />
            </g>

            {/* Cluster 5 - right branch tip */}
            <g transform="translate(1220, 510)">
              <path d="M -18 3 C -16 -8, -9 -14, 0 -16 C 9 -14, 16 -8, 18 3 C 11 -2, -11 -2, -18 3 Z" />
            </g>

            {/* Cluster 6 - trunk shoulder */}
            <g transform="translate(1065, 558)">
              <path d="M -18 3 C -16 -8, -9 -14, 0 -16 C 9 -14, 16 -8, 18 3 C 11 -2, -11 -2, -18 3 Z" />
            </g>
          </g>

          {/* Gentle water/shoreline wash ripple contours along bottom */}
          <path
            d="M 620 890 C 740 875, 860 885, 980 870 C 1100 855, 1220 865, 1340 850 L 1440 855"
            stroke={isDark ? "rgba(229, 240, 237, 0.12)" : "rgba(31, 94, 85, 0.20)"}
            strokeWidth="1.2"
            fill="none"
          />
          <path
            d="M 720 895 C 840 885, 960 892, 1080 882 C 1200 872, 1320 880, 1440 870"
            stroke={isDark ? "rgba(229, 240, 237, 0.08)" : "rgba(31, 94, 85, 0.14)"}
            strokeWidth="1"
            fill="none"
          />
        </g>
      </svg>
    </div>
  );
}

import { useEffect, useRef, useState } from "react";
import Lottie from "lottie-react";
import paintStrokeData from "./assets/Paint Stroke 1.json";

interface StrokeInstance {
  id: number;
  x: number;
  y: number;
  scale: number;
  rotation: number;
}

export default function InkBackground({ theme }: { theme: "light" | "dark" }) {
  const [strokes, setStrokes] = useState<StrokeInstance[]>([]);
  const idCounter = useRef(0);

  useEffect(() => {
    let timeout: ReturnType<typeof setTimeout>;

    function spawn() {
      const delay = 3000 + Math.random() * 4000;
      timeout = setTimeout(() => {
        setStrokes((prev) => {
          if (prev.length >= 6) return prev;
          return [
            ...prev,
            {
              id: idCounter.current++,
              x: Math.random() * 90 + 5,
              y: Math.random() * 80 + 10,
              scale: 3 + Math.random() * 3,
              rotation: Math.random() * 360,
            },
          ];
        });
        spawn();
      }, delay);
    }

    const initialTimers: ReturnType<typeof setTimeout>[] = [];
    for (let i = 0; i < 3; i++) {
      const t = setTimeout(() => {
        setStrokes((prev) => {
          if (prev.length >= 6) return prev;
          return [
            ...prev,
            {
              id: idCounter.current++,
              x: Math.random() * 90 + 5,
              y: Math.random() * 80 + 10,
              scale: 3 + Math.random() * 3,
              rotation: Math.random() * 360,
            },
          ];
        });
      }, i * 800);
      initialTimers.push(t);
    }

    spawn();
    return () => {
      clearTimeout(timeout);
      initialTimers.forEach(clearTimeout);
    };
  }, []);

  function handleRemove(id: number) {
    setStrokes((prev) => prev.filter((s) => s.id !== id));
  }

  return (
    <div
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
      <svg style={{ position: "absolute", width: 0, height: 0 }}>
        <defs>
          <filter id="tint-light">
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.102  0 0 0 0 0.114  0 0 0 0 0.227  0 0 0 1 0"
            />
          </filter>
          <filter id="tint-dark">
            <feColorMatrix
              type="matrix"
              values="0 0 0 0 0.667  0 0 0 0 0.769  0 0 0 0 0.961  0 0 0 1 0"
            />
          </filter>
        </defs>
      </svg>

      {strokes.map((s) => (
        <InkStrokeInstance
          key={s.id}
          data={s}
          theme={theme}
          onRemove={handleRemove}
        />
      ))}
    </div>
  );
}

function InkStrokeInstance({
  data,
  theme,
  onRemove,
}: {
  data: StrokeInstance;
  theme: "light" | "dark";
  onRemove: (id: number) => void;
}) {
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    const lingerTimer = setTimeout(() => setMounted(false), 3500 + Math.random() * 4000);
    const removeTimer = setTimeout(
      () => onRemove(data.id),
      5500 + Math.random() * 4000,
    );
    return () => {
      clearTimeout(lingerTimer);
      clearTimeout(removeTimer);
    };
  }, []);

  return (
    <div
      style={{
        position: "absolute",
        left: `${data.x}%`,
        top: `${data.y}%`,
        transform: `rotate(${data.rotation}deg) scale(${data.scale})`,
        width: 160,
        height: 100,
        opacity: mounted ? 1 : 0,
        transition: "opacity 2.5s ease-in-out",
        filter: `url(#tint-${theme})`,
        transformOrigin: "center center",
      }}
    >
      <Lottie animationData={paintStrokeData} loop={false} />
    </div>
  );
}

"use client";

import { useEffect, useRef } from "react";
import type { TrackReferenceOrPlaceholder } from "@livekit/components-react";

// Renders the avatar's video track with its green-screen backdrop keyed out
// and a real background image showing through instead. LiveAvatar (and most
// real-time avatar providers) render against a flat chroma-key backdrop with
// no way to swap it server-side -- this does it client-side, per frame, using
// a 2D canvas: green-dominant pixels become transparent, and a plain <img>
// positioned behind the canvas shows through the resulting holes.
export function ChromaKeyVideo({
  trackRef,
  backgroundUrl,
  objectFit = "contain",
  className,
}: {
  trackRef: TrackReferenceOrPlaceholder | undefined;
  backgroundUrl: string;
  objectFit?: "contain" | "cover";
  className?: string;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const hiddenVideoContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const track = trackRef?.publication?.track;
    const canvas = canvasRef.current;
    const hiddenContainer = hiddenVideoContainerRef.current;
    if (!track || !canvas || !hiddenContainer) return;

    const videoEl = track.attach() as HTMLVideoElement;
    videoEl.muted = true;
    videoEl.playsInline = true;
    // Must actually be in the live DOM (not just referenced in JS) -- browsers
    // throttle or pause decode/rendering for a <video> that was never
    // attached anywhere, which showed up as video lagging behind audio.
    // Kept effectively invisible (1x1, opacity 0) rather than display:none,
    // since some browsers also stop decoding display:none video.
    hiddenContainer.appendChild(videoEl);

    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;

    let rafId: number;
    const draw = () => {
      if (videoEl.videoWidth > 0) {
        if (canvas.width !== videoEl.videoWidth || canvas.height !== videoEl.videoHeight) {
          canvas.width = videoEl.videoWidth;
          canvas.height = videoEl.videoHeight;
        }
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
        const frame = ctx.getImageData(0, 0, canvas.width, canvas.height);
        const data = frame.data;
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i];
          const g = data[i + 1];
          const b = data[i + 2];
          // Green-screen key: green channel clearly dominant over both red
          // and blue. Thresholds are intentionally loose to catch a range of
          // green-screen shades without eating into skin tones (which are
          // red/orange-dominant, not green-dominant).
          if (g > 80 && g > r * 1.3 && g > b * 1.3) {
            data[i + 3] = 0;
          }
        }
        ctx.putImageData(frame, 0, 0);
      }
      rafId = requestAnimationFrame(draw);
    };
    rafId = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(rafId);
      track.detach(videoEl);
      videoEl.remove();
    };
  }, [trackRef]);

  return (
    <div className={`relative w-full h-full overflow-hidden ${className ?? ""}`}>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={backgroundUrl}
        alt=""
        className="absolute inset-0 w-full h-full object-cover"
      />
      <canvas
        ref={canvasRef}
        className={`absolute inset-0 w-full h-full object-${objectFit}`}
      />
      <div
        ref={hiddenVideoContainerRef}
        style={{ position: "absolute", width: 1, height: 1, opacity: 0, overflow: "hidden", pointerEvents: "none" }}
      />
    </div>
  );
}

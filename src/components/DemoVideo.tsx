"use client";

import { useState } from "react";

const YOUTUBE_ID = "BQr63XjNZvA";

/**
 * The product walkthrough on YouTube. Shows the thumbnail until someone presses play, so YouTube's
 * player (and its cookies) only load on request; the embed uses youtube-nocookie.com.
 */
export function DemoVideo({ label }: { label: string }) {
  const [playing, setPlaying] = useState(false);
  return (
    <div className="lp-video">
      {playing ? (
        <iframe
          src={`https://www.youtube-nocookie.com/embed/${YOUTUBE_ID}?autoplay=1&rel=0`}
          title={label}
          allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
          allowFullScreen
        />
      ) : (
        <button className="lp-play" onClick={() => setPlaying(true)} aria-label={`Play: ${label}`}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`https://i.ytimg.com/vi/${YOUTUBE_ID}/maxresdefault.jpg`}
            alt=""
            // YouTube serves a 120px placeholder when there's no HD thumbnail; fall back to the standard one.
            onLoad={(e) => { const img = e.currentTarget; if (img.naturalWidth <= 120) img.src = `https://i.ytimg.com/vi/${YOUTUBE_ID}/hqdefault.jpg`; }}
          />
          <span className="lp-play-ico" aria-hidden="true">
            <svg width="22" height="22" viewBox="0 0 24 24"><path d="M8 5v14l11-7z" fill="currentColor" /></svg>
          </span>
          <span className="lp-play-txt"><b>Watch the walkthrough</b><span>reqroot, start to finish</span></span>
        </button>
      )}
    </div>
  );
}

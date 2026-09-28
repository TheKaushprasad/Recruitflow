import { ImageResponse } from "next/og";

// The preview card shown when the site is shared (LinkedIn, Slack, WhatsApp…).
export const alt = "reqroot — Hiring decisions, rooted in evidence";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

export default function OgImage() {
  const rows: [string, string, string][] = [
    ["✓", "Notice period ≤ 60 days", "+11%"],
    ["✓", "Shipped an AI/ML product", "+32%"],
    ["½", "Evidence-based prioritisation", "+10.5% of 21%"],
  ];
  return new ImageResponse(
    (
      <div style={{ width: "100%", height: "100%", display: "flex", background: "#f4f5ef", padding: 72, fontFamily: "sans-serif", color: "#14231d" }}>
        <div style={{ display: "flex", flexDirection: "column", justifyContent: "space-between", flex: 1 }}>
          <div style={{ display: "flex", fontSize: 40, fontWeight: 700 }}>req<span style={{ color: "#0f4a31" }}>root</span></div>
          <div style={{ display: "flex", flexDirection: "column" }}>
            <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.02, letterSpacing: -2 }}>Hiring decisions,</div>
            <div style={{ display: "flex", fontSize: 72, fontWeight: 800, lineHeight: 1.02, letterSpacing: -2 }}>
              rooted in&nbsp;<span style={{ color: "#1e6b4a" }}>evidence.</span>
            </div>
            <div style={{ fontSize: 28, color: "#4f5d56", marginTop: 24, maxWidth: 560 }}>AI candidate screening that shows its work — and leaves every call to you.</div>
          </div>
          <div style={{ display: "flex", alignSelf: "flex-start", background: "#c6f062", borderRadius: 99, padding: "14px 28px", fontSize: 26, fontWeight: 700 }}>Try the live demo — no sign-up</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", width: 440, alignSelf: "center", background: "#fff", borderRadius: 28, padding: 32, border: "1px solid #dde2d8" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
            <div style={{ display: "flex", flexDirection: "column" }}>
              <div style={{ fontSize: 28, fontWeight: 700 }}>Meera Pillai</div>
              <div style={{ fontSize: 20, color: "#4f5d56" }}>Product Manager — AI Platform</div>
            </div>
            <div style={{ fontSize: 52, fontWeight: 700 }}>89</div>
          </div>
          {rows.map(([mark, name, pts]) => (
            <div key={name} style={{ display: "flex", alignItems: "center", marginTop: 16, background: "#f4f5ef", borderRadius: 14, padding: "14px 16px", fontSize: 21 }}>
              {/* Drawn marks: the image renderer can't load a font for ✓ or ½. */}
              {mark === "✓" ? (
                <div style={{ display: "flex", width: 34, height: 34, borderRadius: 99, alignItems: "center", justifyContent: "center", background: "#dcf1e5", marginRight: 14 }}>
                  <svg width="18" height="18" viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5" fill="none" stroke="#1e6b4a" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" /></svg>
                </div>
              ) : (
                <div style={{ display: "flex", width: 34, height: 34, borderRadius: 99, alignItems: "center", justifyContent: "center", background: "#fbefd6", marginRight: 14 }}>
                  <div style={{ display: "flex", width: 16, height: 16, borderRadius: 99, border: "2.5px solid #9a6412", background: "linear-gradient(90deg, #9a6412 50%, transparent 50%)" }} />
                </div>
              )}
              <div style={{ display: "flex", flex: 1 }}>{name}</div>
              <div style={{ display: "flex", color: "#4f5d56" }}>{pts}</div>
            </div>
          ))}
        </div>
      </div>
    ),
    size,
  );
}

/** Instant placeholder shown while a page's data loads, so navigation responds immediately. */
export function PageSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <div aria-busy="true" aria-label="Loading" style={{ display: "grid", gap: 16, paddingTop: 8 }}>
      <div className="skel" style={{ width: 160, height: 12 }} />
      <div className="skel" style={{ width: "min(420px, 80%)", height: 26 }} />
      <div className="skel" style={{ width: "min(560px, 95%)", height: 14 }} />
      <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
        {Array.from({ length: rows }, (_, i) => (
          <div key={i} className="skel" style={{ height: 56, borderRadius: 14 }} />
        ))}
      </div>
    </div>
  );
}

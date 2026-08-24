import { ImageResponse } from "next/og";

export const socialImageAlt = "Mint Binder — your Pokémon collection, properly organised";
export const socialImageSize = { width: 1200, height: 630 };
export const socialImageContentType = "image/png";

export function createSocialImage() {
  return new ImageResponse(
    (
      <div
        style={{
          alignItems: "stretch",
          background: "#ecf3ed",
          color: "#16373a",
          display: "flex",
          fontFamily: "Arial, sans-serif",
          height: "100%",
          padding: 56,
          width: "100%",
        }}
      >
        <div
          style={{
            background: "#176f68",
            borderRadius: 42,
            boxShadow: "0 28px 70px rgba(16, 55, 51, 0.22)",
            display: "flex",
            flex: 1,
            flexDirection: "column",
            justifyContent: "space-between",
            overflow: "hidden",
            padding: "58px 64px",
            position: "relative",
          }}
        >
          <div style={{ color: "#f1d697", display: "flex", fontSize: 24, fontWeight: 800, letterSpacing: "0.16em" }}>
            MINT BINDER
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 22, maxWidth: 850 }}>
            <div style={{ color: "white", display: "flex", fontFamily: "Georgia, serif", fontSize: 72, fontWeight: 700, letterSpacing: "-0.045em", lineHeight: 1 }}>
              Your collection, properly organised.
            </div>
            <div style={{ color: "#d6ebe6", display: "flex", fontSize: 27, lineHeight: 1.35 }}>
              Track cards and sealed products, build binders and follow evidence-backed market values.
            </div>
          </div>
          <div style={{ display: "flex", gap: 12 }}>
            {["Cards", "Sealed", "Binders", "Price history"].map((label) => (
              <div key={label} style={{ background: "rgba(255,255,255,0.12)", borderRadius: 999, color: "white", display: "flex", fontSize: 18, padding: "10px 17px" }}>
                {label}
              </div>
            ))}
          </div>
          <div style={{ background: "rgba(241,214,151,0.18)", borderRadius: 999, display: "flex", height: 320, position: "absolute", right: -100, top: -135, width: 320 }} />
        </div>
      </div>
    ),
    socialImageSize,
  );
}

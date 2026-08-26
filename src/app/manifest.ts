import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    dir: "ltr",
    id: "/",
    lang: "en-GB",
    name: "Mint Binder",
    short_name: "Mint Binder",
    description:
      "Track Pokémon cards and sealed products, organise binders and follow market values.",
    start_url: "/",
    scope: "/",
    display: "standalone",
    background_color: "#101923",
    theme_color: "#101923",
    categories: ["lifestyle", "utilities"],
    icons: [
      {
        src: "/icons/icon-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
      {
        src: "/icons/icon-maskable-192.png",
        sizes: "192x192",
        type: "image/png",
        purpose: "maskable",
      },
      {
        src: "/icons/icon-maskable-512.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

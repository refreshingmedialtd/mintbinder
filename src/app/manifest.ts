import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Mint Binder",
    short_name: "Mint Binder",
    description:
      "Track Pokémon cards and sealed products, organise binders and follow market values.",
    start_url: "/",
    display: "standalone",
    background_color: "#101923",
    theme_color: "#101923",
    categories: ["lifestyle", "utilities"],
    icons: [
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "any",
      },
      {
        src: "/icon.svg",
        sizes: "any",
        type: "image/svg+xml",
        purpose: "maskable",
      },
    ],
  };
}

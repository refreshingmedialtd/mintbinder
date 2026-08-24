export const accountTokenPageMetadata = {
  robots: {
    follow: false,
    googleBot: {
      follow: false,
      index: false,
      noarchive: true,
      noimageindex: true,
    },
    index: false,
    nocache: true,
  },
};

export function accountTokenUrl(path: string, token: string, origin: string | URL) {
  const url = new URL(path, origin);
  url.searchParams.delete("token");
  url.hash = new URLSearchParams({ token }).toString();
  return url;
}

export function consumeAccountTokenFragment(
  location: { hash: string; pathname: string; search: string },
  replaceUrl: (url: string) => void,
) {
  const fragment = new URLSearchParams(location.hash.replace(/^#/, ""));
  const cleanSearch = new URLSearchParams(location.search);
  const token = fragment.get("token")?.trim() || cleanSearch.get("token")?.trim() || "";
  cleanSearch.delete("token");
  const query = cleanSearch.toString();

  replaceUrl(`${location.pathname}${query ? `?${query}` : ""}`);
  return token;
}

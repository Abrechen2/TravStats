// Prefetches the 3D-globe textures with idle priority so the first switch
// into globe mode paints instantly instead of streaming a blank sphere.
// Was previously eagerly fetched via <link rel="prefetch"> in index.html,
// which cost ~4.3 MB on every cold /login even when the user never opened
// the globe.

const TEXTURE_URLS = ["/earth-day.jpg", "/earth-topology.png", "/night-sky.png"];

let prefetched = false;

export function prefetchGlobeTextures(): void {
  if (prefetched || typeof document === "undefined") return;
  prefetched = true;

  for (const href of TEXTURE_URLS) {
    const link = document.createElement("link");
    link.rel = "prefetch";
    link.as = "image";
    link.href = href;
    document.head.appendChild(link);
  }
}

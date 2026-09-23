import { useEffect, useState, type JSX } from "react";
import { getLoginBackgrounds, loginBackgroundUrl } from "../lib/api/loginBackgrounds";

/**
 * The slideshow behind the left half of the sign-in page.
 *
 * Alex, 2026-09-21: "Man könnte in den Einstellungen die Möglichkeit bieten
 * Fotos hochzuladen die dann in der linken Hälfte als dezenter Hintergrund als
 * Slideshow durchlaufen."
 *
 * "Dezent" is the load-bearing word and it is why this renders a scrim over
 * every image rather than dimming the image itself: the headline and the body
 * text sit on top, and their contrast has to hold for a snow scene and a night
 * shot alike. The scrim is the same dark the page already uses, so an instance
 * with no images looks like the instance did before this existed — the
 * gradient behind it simply shows through.
 *
 * An instance with ONE image gets a still picture, not a cross-fade to itself.
 */

/** How long each image holds before the next one fades in. */
const SLIDE_MS = 9000;
/** The fade itself. Long enough to read as a drift rather than a cut. */
const FADE_MS = 1600;

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

export function LoginBackdrop(): JSX.Element | null {
  const [images, setImages] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // A failure here is silent ON PURPOSE. This is decoration on the page
    // where someone is trying to sign in; an error about the wallpaper would
    // be noise at the worst moment, and the page is complete without it.
    getLoginBackgrounds()
      .then((names) => {
        if (!cancelled) setImages(names);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    // One image never advances, and neither does a reader who asked for less
    // motion — for them the first image is simply the picture.
    if (images.length < 2 || prefersReducedMotion()) return;
    const timer = window.setInterval(
      () => setIndex((i) => (i + 1) % images.length),
      SLIDE_MS + FADE_MS
    );
    return () => window.clearInterval(timer);
  }, [images.length]);

  if (images.length === 0) return null;

  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
      {images.map((name, i) => (
        <div
          key={name}
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url("${loginBackgroundUrl(name)}")`,
            opacity: i === index ? 1 : 0,
            transition: `opacity ${FADE_MS}ms ease-in-out`,
          }}
        />
      ))}
      {/* The scrim. Heavier on the right, where the text is, and where the
          panel's border meets the form — a photograph running bright into
          that seam is what makes a split screen look like two screens. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, color-mix(in srgb, var(--ts-bg) 62%, transparent) 0%, " +
            "color-mix(in srgb, var(--ts-bg) 78%, transparent) 55%, var(--ts-bg) 100%)",
        }}
      />
    </div>
  );
}

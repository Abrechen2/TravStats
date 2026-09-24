import { useEffect, useState, type JSX } from "react";
import { getLoginBackgrounds, loginBackgroundUrl } from "../lib/api/loginBackgrounds";
import { DEFAULT_LOGIN_BACKGROUNDS } from "../lib/defaultLoginBackgrounds";

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
 * shot alike. The scrim is the same dark the page already uses, so the picture
 * reads as a surface the page is printed on rather than an illustration behind
 * it. Measured on 2026-09-23 against a near-white test image: the text stays
 * perfectly legible and the picture all but disappears, which is why the
 * shipped set is dark and why the admin tile asks for dark ones.
 *
 * An instance with ONE image gets a still picture, not a cross-fade to itself.
 *
 * An instance with NONE of its own falls back to the pictures TravStats ships
 * (`defaultLoginBackgrounds.ts`) — the screen every user meets before they
 * have any data is the one least able to fill itself. An admin's own uploads
 * REPLACE them rather than joining them: mixing the two would leave nobody
 * able to say which picture is theirs, and no way to get rid of ours.
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
  /** Ready-to-use URLs, whether uploaded or shipped. */
  const [images, setImages] = useState<string[]>([]);
  const [index, setIndex] = useState(0);

  useEffect(() => {
    let cancelled = false;
    // A failure here is silent ON PURPOSE, and falls back to the shipped
    // pictures. This is decoration on the page where someone is trying to
    // sign in; an error about the wallpaper would be noise at the worst
    // moment, and the shipped set needs no server to be there.
    getLoginBackgrounds()
      .then((names) => {
        if (cancelled) return;
        setImages(
          names.length > 0 ? names.map(loginBackgroundUrl) : [...DEFAULT_LOGIN_BACKGROUNDS]
        );
      })
      .catch(() => {
        if (!cancelled) setImages([...DEFAULT_LOGIN_BACKGROUNDS]);
      });
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
      {images.map((src, i) => (
        <div
          key={src}
          className="absolute inset-0 bg-cover bg-center"
          style={{
            backgroundImage: `url("${src}")`,
            opacity: i === index ? 1 : 0,
            transition: `opacity ${FADE_MS}ms ease-in-out`,
          }}
        />
      ))}
      {/* The scrim, which fades the picture into the form's edge — a
          photograph running bright into that seam is what makes a split
          screen look like two screens.

          It used to be far heavier (62% at the left edge). Measured in the
          browser on 2026-09-23: over the shipped pictures, which are dark by
          design, that left a panel where the photograph was barely findable.
          The text is protected by its OWN shadow now (`LoginPage`), which
          works whatever the picture underneath does — so the scrim only has
          to do the job it is named for. */}
      <div
        className="absolute inset-0"
        style={{
          background:
            "linear-gradient(90deg, color-mix(in srgb, var(--ts-bg) 28%, transparent) 0%, " +
            "color-mix(in srgb, var(--ts-bg) 48%, transparent) 55%, var(--ts-bg) 100%)",
        }}
      />
    </div>
  );
}

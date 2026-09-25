/**
 * The pictures every instance ships with, behind the sign-in page.
 *
 * They exist because the alternative was worse: an instance nobody has
 * configured would show a bare gradient, and the one screen every user meets
 * before they have any data of their own is the screen least able to fill
 * itself. An admin who uploads their own replaces these entirely — see
 * `LoginBackdrop`.
 *
 * They are NOT photographs of anywhere real: the owner generated them on
 * 2026-09-23 rather than taking them from a stock library, which settles the
 * licence question that kept them out on the first pass. Nothing in them is a
 * place, a person, a registration or a brand.
 *
 * Served from `public/`, so Vite copies them verbatim and they cost no bundle
 * — but they DO cost image size: 1.9 MB for the five. That is the reason
 * there are five and not fifteen.
 *
 * Each is portrait (1152x1728), dark, and composed with its subject to the
 * RIGHT. Both of those are requirements rather than taste: the strip fills
 * the left half of the window at full height, the scrim over it turns a
 * bright picture into grey mush (measured 2026-09-23 against a near-white
 * test image), and the headline sits over the left third.
 */
export const DEFAULT_LOGIN_BACKGROUNDS: readonly string[] = [
  "/login-backgrounds/01-flight-dusk.jpg",
  "/login-backgrounds/02-cruise-night.jpg",
  "/login-backgrounds/03-lodging-blue-hour.jpg",
  "/login-backgrounds/04-coast-road-dusk.jpg",
  "/login-backgrounds/05-night-sky-mountains.jpg",
];

// The route card's picture of what the journeys were made in — the ferry's
// ship, the rental's car model, the train category (owner, 2026-10-21). From
// Commons via this server, freely licensed, credited and linked right under
// it. Nothing is drawn until the server says there is a picture, and nothing
// at all on a miss, a failure or an image that does not load.

import { useEffect, useState, type JSX } from "react";
import {
  getSubjectImage,
  subjectImagePath,
  type SubjectImageCredit,
} from "../../../../lib/api/mapDetails";
import { tokens } from "../../../../theme/tokens";
import type { TFn } from "../cardChrome";
import type { JourneySubject } from "./journeySubject";

export function SubjectPicture({
  subject,
  t,
}: {
  subject: JourneySubject | null;
  t: TFn;
}): JSX.Element | null {
  const [credit, setCredit] = useState<SubjectImageCredit | null>(null);
  const [broken, setBroken] = useState(false);
  const kind = subject?.kind ?? null;
  const name = subject?.name ?? null;

  useEffect(() => {
    setCredit(null);
    setBroken(false);
    if (!kind || !name) return;
    let cancelled = false;
    void getSubjectImage(kind, name).then((picture) => {
      if (!cancelled && picture.available) setCredit(picture.credit);
    });
    return () => {
      cancelled = true;
    };
  }, [kind, name]);

  if (!kind || !name || !credit || broken) return null;
  return (
    <figure data-testid="subject-picture" className="mb-2.5">
      <img
        src={subjectImagePath(kind, name)}
        alt={name}
        className="h-24 w-full rounded-sm object-cover"
        onError={() => setBroken(true)}
      />
      <figcaption className="mt-0.5 text-[9.5px] leading-snug">
        <span className="block" style={{ color: tokens.color.muted }}>
          {name}
        </span>
        <a
          href={credit.sourceUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="block underline-offset-2 hover:underline pointer-coarse:min-h-(--ts-size-touch-min) pointer-coarse:leading-[44px]"
          style={{ color: tokens.color.faint }}
        >
          {`${t("map:journey.picture")}: ${[credit.licence, credit.artist, "Wikimedia Commons"]
            .filter(Boolean)
            .join(" · ")}`}
        </a>
      </figcaption>
    </figure>
  );
}

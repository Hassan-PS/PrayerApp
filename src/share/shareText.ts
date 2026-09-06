/**
 * What leaves the app as text — issue #24.
 *
 * A reader asked to be able to send a dua or a tafsir passage to family,
 * or into Notes, the way an ayah could already be sent. Sharing an ayah
 * as text was written inline in the ayah sheet; two more of these, each
 * assembling its own string somewhere else, is how three formats drift
 * apart and how one of them quietly loses its attribution.
 *
 * ── ATTRIBUTION IS NOT A FIELD, IT IS THE POINT ───────────────────────
 *
 * CLAUDE.md §4: religious content must be sourced and attributed. That
 * rule is easy to keep on a screen, where the source line is drawn beside
 * the text and nobody has to remember it. It is easy to LOSE in a share
 * body, because a share body is assembled by hand, read once by whoever
 * wrote it, and then travels without the app around it — a dua pasted
 * into a family group with no source is a claim about the religion with
 * nothing behind it, and the person who receives it has no way back to
 * where it came from.
 *
 * So every builder here takes its attribution as a required argument and
 * `attributed()` refuses to produce a body without one. A future fourth
 * share cannot forget: it will throw the first time it is used, in a
 * test, rather than ship a quotation with no chain.
 *
 * The shape is the one the ayah share already used, so the three read as
 * one app: blocks separated by a blank line, attribution last behind an
 * em dash.
 */

/** Joins non-empty blocks, and refuses to finish without attribution. */
function attributed(blocks: ReadonlyArray<string | undefined>, source: string): string {
  const attribution = source.trim();
  if (!attribution) {
    throw new Error('shareText: religious content cannot be shared unattributed');
  }
  const body = blocks
    .map(b => b?.trim())
    .filter((b): b is string => Boolean(b))
    .join('\n\n');
  return `${body}\n\n— ${attribution}`;
}

export type AyahShare = {
  arabic: string;
  translation: string;
  /** "Al-Baqarah 2:255". */
  reference: string;
};

/** One ayah: the Arabic, the reader's translation, and where it is from. */
export function ayahShareText({
  arabic,
  translation,
  reference,
}: AyahShare): string {
  return attributed([arabic, translation], reference);
}

export type DuaShare = {
  title: string;
  arabic: string;
  transliteration: string;
  translation: string;
  /** The citation carried on the dua itself; never optional. */
  source: string;
};

/**
 * One dua.
 *
 * The transliteration travels with it. It is behind a toggle on screen —
 * an aid, not the text — but the whole point of sending a dua to someone
 * is that they can say it, and a recipient who does not read Arabic
 * cannot say it from the Arabic. It costs a paragraph.
 */
export function duaShareText({
  title,
  arabic,
  transliteration,
  translation,
  source,
}: DuaShare): string {
  return attributed([title, arabic, transliteration, translation], source);
}

export type TafsirShare = {
  text: string;
  /** The edition's own name — "Ibn Kathir (abridged)". A proper noun. */
  edition: string;
  /** The ayah it explains: "Al-Baqarah 2:255". */
  reference: string;
};

/**
 * One tafsir passage.
 *
 * Its attribution has two halves and needs both. The edition alone does
 * not say which ayah is being explained, and the ayah alone credits a
 * classical commentary to nobody — a paragraph of Ibn Kathir arriving as
 * an anonymous explanation of a verse is exactly the shape of an
 * unsourced religious claim.
 */
export function tafsirShareText({
  text,
  edition,
  reference,
}: TafsirShare): string {
  // Both halves checked BEFORE they are joined. `attributed` sees one
  // string, and two empty halves joined by ", " is a non-empty string —
  // so without this a passage could ship credited to ", ".
  if (!edition.trim() || !reference.trim()) {
    throw new Error('shareText: religious content cannot be shared unattributed');
  }
  return attributed([text], `${edition}, ${reference}`);
}

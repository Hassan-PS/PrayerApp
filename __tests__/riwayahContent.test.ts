/**
 * A file that is not the Qur'an must not become a muṣḥaf.
 *
 * This is the test that was missing when a synthetic dataset — the words
 * "test text, not Qur'an" repeated 6236 times — passed every structural
 * check and rendered on a device with a surah band, a juz label, ayah
 * medallions and a page number. Nothing on that screen told the reader
 * what they were looking at.
 *
 * The check reads the incoming text at the sixty places a reader would
 * check it themselves — the first and last ayah of each of the thirty
 * ajzāʾ — against the Tanzil Hafs text the app already ships. So this
 * file asserts BOTH directions, and the second matters as much as the
 * first: a content check that refuses real scripture would be worse than
 * none at all.
 */
import { MUSHAF_PAGES } from '../src/quran/pages';
import {
  SURAHS,
  bundledSurahArabic,
  warmSurahCache,
} from '../src/quran/quran';
import { verifyRiwayahDataset } from '../src/quran/riwayahImport';
import {
  JUZ_COUNT,
  juzAnchors,
  skeleton,
  vocabularyOverlap,
} from '../src/quran/juzCheck';

/*
 * The Qur'an corpus is read from disk now rather than compiled into the
 * bundle, so a synchronous walk over it has to be warmed first — which is
 * exactly what `installRiwayahFromText` does around its own verification.
 * These suites build fixtures from the same corpus, so they warm it too.
 */
beforeAll(async () => {
  await warmSurahCache();
});


const BASMALAH =
  /^بِسْمِ\s*ٱللَّهِ\s*ٱلرَّحْمَٰنِ\s*ٱلرَّحِيمِ\s*/;

type Verse = {
  verse_key: string;
  text: string;
  page_number: number;
  juz_number: number;
};

const cmp = (a: { surah: number; ayah: number }, b: { surah: number; ayah: number }) =>
  a.surah !== b.surah ? a.surah - b.surah : a.ayah - b.ayah;

function pageMeta(surah: number, ayah: number) {
  for (const p of MUSHAF_PAGES) {
    const afterStart = cmp(p.start, { surah, ayah }) <= 0;
    const beforeEnd = p.end ? cmp(p.end, { surah, ayah }) > 0 : true;
    if (afterStart && beforeEnd) return { page: p.page, juz: p.juz };
  }
  return { page: 604, juz: 30 };
}

/**
 * The Qur'an the app already ships, in the shape a publisher exports.
 *
 * Built from the bundled text rather than fetched, so this test asserts
 * against the only corpus in the repository that is known to be right.
 */
function realDataset(transform?: (text: string, s: number, a: number) => string): Verse[] {
  const out: Verse[] = [];
  for (let s = 1; s <= 114; s++) {
    const arabic = bundledSurahArabic(s) ?? [];
    for (let a = 1; a <= SURAHS[s - 1].ayahCount; a++) {
      let text = arabic[a - 1] ?? '';
      // Every surah but al-Tawbah carries the basmalah at the front of its
      // first ayah in these files; al-Fātiḥah's first ayah IS the basmalah.
      if (a === 1 && s !== 9 && s !== 1) text = text.replace(BASMALAH, '');
      const meta = pageMeta(s, a);
      out.push({
        verse_key: `${s}:${a}`,
        text: transform ? transform(text, s, a) : text,
        page_number: meta.page,
        juz_number: meta.juz,
      });
    }
  }
  return out;
}

const verify = (verses: Verse[]) =>
  verifyRiwayahDataset(verses, [], MUSHAF_PAGES);

describe('the sixty anchors', () => {
  it('are the first and last ayah of each of the thirty juz', () => {
    const anchors = juzAnchors(MUSHAF_PAGES);
    expect(anchors).toHaveLength(JUZ_COUNT);
    expect(anchors[0].first).toEqual({ surah: 1, ayah: 1 });
    expect(anchors[JUZ_COUNT - 1].last).toEqual({ surah: 114, ayah: 6 });
    // Contiguous: each juz ends the ayah before the next one starts.
    for (let i = 0; i + 1 < anchors.length; i++) {
      const end = anchors[i].last;
      const next = anchors[i + 1].first;
      const rolled = end.surah !== next.surah;
      expect(rolled ? next.ayah : end.ayah + 1).toBe(next.ayah);
    }
  });
});

describe('reading an ayah down to its letters', () => {
  it('drops the marks and keeps the words', () => {
    const marked = 'بِسْمِ ٱللَّهِ';
    expect(skeleton(marked)).toBe('بسم الله');
  });

  it('drops the digits and punctuation a placeholder is full of', () => {
    // Note the ة folded to ه — spellings that differ between editions are
    // deliberately levelled, which is what lets a second riwayah through.
    expect(skeleton('نص 4:156 كلمة')).toBe('نص كلمه');
  });

  it('scores nothing for text that shares no words', () => {
    expect(vocabularyOverlap('الحمد لله رب العالمين', 'نص كلمة كلمة')).toBe(0);
  });

  it('scores everything for the same words', () => {
    expect(vocabularyOverlap('الحمد لله', 'الحمد لله')).toBe(1);
  });
});

describe('what the verifier accepts', () => {
  it('accepts the Qur’an', () => {
    const result = verify(realDataset());
    if (!result.ok) throw new Error(`refused the Qur’an: ${result.error}`);
    expect(result.ok).toBe(true);
    expect(result.totalPages).toBe(604);
  });

  it('accepts a different orthography of the same words', () => {
    // The whole point of a second riwayah: it is spelled differently. A
    // check that only accepted a byte-copy of Hafs would refuse every real
    // Warsh dataset, which is the failure mode opposite to the one that
    // prompted this.
    const respelled = realDataset(text =>
      text
        .replace(/ٱ/g, 'ا')
        .replace(/ٰ/g, '')
        .replace(/ي/g, 'ى'),
    );
    const result = verify(respelled);
    if (!result.ok) throw new Error(`refused a respelling: ${result.error}`);
    expect(result.ok).toBe(true);
  });
});

describe('what the verifier refuses', () => {
  it('refuses text that is not the Qur’an, and says where', () => {
    const placeholder = realDataset(
      (_t, s, a) => `نص تجريبي ليس قرآنًا ${s}:${a} كلمة كلمة كلمة`,
    );
    const result = verify(placeholder);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/juz 1 begins/);
    expect(result.error).toMatch(/is not the Qur’an/);
  });

  it('refuses real scripture put in the wrong places', () => {
    // Every count right, every page forwards, and the text shifted by one
    // ayah — the corruption that looks completely plausible on screen.
    const real = realDataset();
    const shifted = real.map((v, i) => ({
      ...v,
      text: real[(i + 1) % real.length].text,
    }));
    const result = verify(shifted);
    expect(result.ok).toBe(false);
  });

  it('refuses a file whose juz numbering is off by one', () => {
    const real = realDataset();
    const misjuz = real.map((v, i) => ({
      ...v,
      juz_number: real[Math.min(real.length - 1, i + 1)].juz_number,
    }));
    const result = verify(misjuz);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/juz 1 ends at 2:141, but this file puts/);
  });

  it('still refuses on shape before it ever looks at the text', () => {
    const short = realDataset().slice(0, 10);
    const result = verify(short);
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.error).toMatch(/expected 114 surahs, found 2/);
  });
});

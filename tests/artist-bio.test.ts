import assert from "node:assert/strict";
import { test } from "node:test";
import {
  ARTIST_BIO_PHOTOS,
  artistBioHeadline,
  buildArtistBioCaption,
  buildArtistBioNarration,
  buildArtistBioSourceComment,
  createArtistBio,
  parseArtistBio,
} from "../src/lib/artist-bio";

function sampleBio() {
  return {
    name: "Mina",
    facts: Array.from({ length: ARTIST_BIO_PHOTOS }, (_, index) => ({
      fact: `Fakta terverifikasi nomor ${index + 1} tentang karya Mina.`,
      sourceUrl: `https://source.example.test/fact-${index + 1}`,
      imageUrl: `https://images.example.test/mina-${index + 1}.jpg`,
    })),
  };
}

test("Artis Bio requires four source-backed facts and round-trips its editorial payload", () => {
  const bio = createArtistBio(sampleBio());
  assert.equal(bio.facts.length, 4);
  assert.equal(parseArtistBio(JSON.stringify(bio))?.facts[3]?.sourceUrl, "https://source.example.test/fact-4");
  assert.equal(artistBioHeadline("  Mina  "), "Kenalan dengan Mina");
  assert.throws(() => createArtistBio({ ...sampleBio(), facts: sampleBio().facts.slice(0, 3) }));
  assert.throws(() => createArtistBio({
    ...sampleBio(),
    facts: sampleBio().facts.map((fact, index) => index === 0 ? { ...fact, sourceUrl: "http://unsafe.example.test/fact" } : fact),
  }));
});

test("Artis Bio captions and narration repeat only supplied facts, with sources added only where requested", () => {
  const bio = createArtistBio(sampleBio());
  const caption = buildArtistBioCaption(bio);
  const sourcedCaption = buildArtistBioCaption(bio, { includeSources: true });
  const sourceComment = buildArtistBioSourceComment(bio);
  const narration = buildArtistBioNarration(bio);

  assert.doesNotMatch(caption, /source\.example\.test/);
  assert.match(sourcedCaption, /Sumber fakta Artis Bio — Mina:/);
  assert.match(sourceComment, /1\. https:\/\/source\.example\.test\/fact-1/);
  assert.match(sourceComment, /facebook\.com\/portalbeez/);
  for (let index = 1; index <= ARTIST_BIO_PHOTOS; index += 1) {
    assert.ok(narration.includes(`Fakta terverifikasi nomor ${index} tentang karya Mina.`));
  }
  assert.doesNotMatch(narration, /lahir pada|menikah|memiliki penghargaan/);
});

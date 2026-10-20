import assert from "node:assert/strict";
import { test } from "node:test";
import { NO_URL_FILTER, type UrlFilter } from "@/lib/photoFilter";
import { readTagVocabulary } from "@/lib/sceneTags";
import { TAGS_FIXTURE } from "@/lib/sceneTags.fixture";
import { complete, completionsFor } from "./completions";
import { filterChips } from "./filterChips";
import type { FilterVocabulary } from "./useFilterVocabulary";

const tags = readTagVocabulary(TAGS_FIXTURE).tags.map((t) => ({
  ...t,
  tagged: t.tag !== "chiot",
}));
const VOCABULARY: FilterVocabulary = {
  people: [
    { id: 4, name: "Céline", coverFaceId: 40 },
    { id: 5, name: "Stéphane", coverFaceId: 50 },
    { id: 1, name: "Suzie", coverFaceId: null },
  ],
  expressions: [],
  tags,
  tagged: tags.filter((t) => t.tagged),
  years: { from: 2008, to: 2026 },
};

const chipsOf = (filter: Partial<UrlFilter>) =>
  filterChips({ ...NO_URL_FILTER, ...filter }, VOCABULARY);

void test("a person and her look are one chip, from the words or the URL", () => {
  const fromWords = chipsOf({ q: "Céline qui sourit à la plage" });
  assert.deepEqual(
    fromWords.map((c) => c.label),
    ["Céline · Sourit", "Plage"],
  );
  assert.equal(fromWords[0]?.faceId, 40);
  const fromUrl = chipsOf({
    people: [5],
    faces: [{ person: 4, expression: "triste" }],
  });
  assert.deepEqual(
    fromUrl.map((c) => c.label),
    ["Stéphane", "Céline · Triste"],
  );
});

void test("removing a chip removes its words or its parameter only", () => {
  const filter: UrlFilter = {
    ...NO_URL_FILTER,
    q: "Céline qui sourit à la plage",
    colors: { color: "blue", tone: null },
    dates: ["été"],
  };
  const chips = filterChips(filter, VOCABULARY);
  const byLabel = (label: string) => {
    const chip = chips.find((c) => c.label === label);
    assert.ok(chip, label);
    return chip.remove(filter);
  };
  assert.equal(byLabel("Céline · Sourit").q, "à la plage");
  assert.equal(byLabel("Plage").q, "Céline qui sourit");
  assert.equal(byLabel("Bleu").colors.color, null);
  assert.deepEqual(byLabel("Été").dates, []);
});

void test("words left over, a tag not tagged yet, nobody, negations", () => {
  assert.deepEqual(
    chipsOf({ q: "que des chiots au jardin" }).map((c) => c.label),
    ["Sans personne", "Jardin", "«\u00a0chiots\u00a0»"],
  );
  assert.deepEqual(
    chipsOf({
      people: [1],
      only: true,
      tags: [{ tag: "vehicule", negated: true }],
    }).map((c) => c.label),
    ["Suzie", "Sans véhicule", "Personne d'autre"],
  );
});

void test("the URL's color replaces the one the words say", () => {
  assert.deepEqual(
    chipsOf({ q: "Suzie en rouge", colors: { color: "blue", tone: null } }).map(
      (c) => c.label,
    ),
    ["Suzie", "Bleu"],
  );
});

void test("the word being typed is finished by a person, a look, a scene or a color", () => {
  const labels = (value: string) =>
    completionsFor(value, VOCABULARY).map((c) => `${c.kind}:${c.label}`);
  assert.deepEqual(labels("cél"), ["person:Céline"]);
  assert.deepEqual(labels("Céline qui sou"), ["look:Sourit"]);
  assert.deepEqual(labels("Suzie pleu"), ["look:Triste"]);
  assert.deepEqual(labels("à la pla"), ["tag:Plage"]);
  assert.deepEqual(labels("ble"), ["color:Bleu"]);
  // Too short, or already whole
  assert.deepEqual(labels("c"), []);
  assert.deepEqual(labels("Suzie triste"), []);
  const [look] = completionsFor("Suzie en col", VOCABULARY);
  assert.ok(look);
  assert.equal(complete("Suzie en col", look), "Suzie en colère ");
  const [laugh] = completionsFor("Céline qui ri", VOCABULARY);
  assert.ok(laugh);
  assert.equal(complete("Céline qui ri", laugh), "Céline qui rit ");
});

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { NO_URL_FILTER, type UrlFilter } from "@/lib/photoFilter";
import { readTagVocabulary } from "@/lib/sceneTags";
import { complete, completionsFor } from "./completions";
import { filterChips } from "./filterChips";
import { understood } from "./understood";
import type { FilterVocabulary } from "./useFilterVocabulary";

/** The worker's vocabulary, every tag with photos but cheval */
const tags = readTagVocabulary(
  JSON.parse(readFileSync(path.join(process.cwd(), "db", "tags.json"), "utf8")),
).tags.map((t) => ({ ...t, tagged: t.tag !== "cheval" }));
const VOCABULARY: FilterVocabulary = {
  people: [
    { id: 4, name: "Céline", coverFaceId: 40 },
    { id: 5, name: "Stéphane", coverFaceId: 50 },
    { id: 1, name: "Suzie", coverFaceId: null },
  ],
  expressions: [],
  tags,
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
    ["Suzie", "Pas en voiture, train, avion", "Personne d'autre"],
  );
  assert.deepEqual(
    chipsOf({
      q: "Suzie sans Céline",
      tags: [{ tag: "plage", negated: true }],
    }).map((c) => c.label),
    ["Suzie", "Sans Céline", "Sans plage"],
  );
  assert.deepEqual(
    chipsOf({ withoutPeople: [5], q: "que des enfants qui sourient" }).map(
      (c) => c.label,
    ),
    ["Tout le monde", "Sourit", "Sans Stéphane"],
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
  assert.deepEqual(labels("à la pla"), ["tag:Plage", "tag:Nourriture"]);
  assert.deepEqual(labels("ble"), ["color:Bleu"]);
  // Too short, or already whole
  assert.deepEqual(labels("c"), []);
  assert.deepEqual(labels("Suzie triste"), []);
  // Anger is not offered (lib/database.ts EXPRESSION_SQL)
  assert.deepEqual(labels("Suzie en col"), []);
  const [eyes] = completionsFor("Céline les yeux fer", VOCABULARY);
  assert.ok(eyes);
  assert.equal(
    complete("Céline les yeux fer", eyes),
    "Céline les yeux fermés ",
  );
  const [laugh] = completionsFor("Céline qui ri", VOCABULARY);
  assert.ok(laugh);
  assert.equal(complete("Céline qui ri", laugh), "Céline qui rit ");
});

void test("the words are read with the people: « Rose en bleu » is Rose in blue", () => {
  const withRose: FilterVocabulary = {
    ...VOCABULARY,
    people: [...VOCABULARY.people, { id: 9, name: "Rose", coverFaceId: null }],
  };
  const read = understood("Rose en bleu", withRose);
  assert.deepEqual(read.people, [9]);
  assert.deepEqual(read.colors, { color: "blue", tone: null });
  // Before the vocabulary, « rose » is a color
  assert.equal(understood("Rose en bleu", null).people.length, 0);
  // Once per words and vocabulary
  assert.equal(understood("Rose en bleu", withRose), read);
});

void test("only, with people in the words, is « Personne d'autre » as the server reads it", () => {
  const label = (filter: Partial<UrlFilter>) =>
    chipsOf(filter).find((chip) => chip.kind === "only")?.label;
  assert.equal(label({ q: "Suzie", only: true }), "Personne d'autre");
  assert.equal(label({ only: true }), "Sans personne");
  assert.equal(
    label({ q: "quelqu'un qui sourit", only: true }),
    "Tout le monde",
  );
});

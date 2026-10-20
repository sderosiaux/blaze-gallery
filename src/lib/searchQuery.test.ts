import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { test } from "node:test";
import { readTagVocabulary } from "./sceneTags";
import {
  expressionPhrases,
  isStopword,
  readDate,
  removeParts,
  understandQuery,
  type NamedPerson,
  type QueryPart,
} from "./searchQuery";

const PEOPLE: NamedPerson[] = [
  { id: 1, name: "Suzie" },
  { id: 4, name: "Céline" },
  { id: 5, name: "Stéphane" },
  { id: 10, name: "Lucia" },
  { id: 14, name: "Mamie" },
  { id: 7, name: "Isa" },
];

/** The worker's vocabulary, as the app reads it */
const TAGS = readTagVocabulary(
  JSON.parse(readFileSync(path.join(process.cwd(), "db", "tags.json"), "utf8")),
).tags;

const read = (q: string, people: NamedPerson[] = PEOPLE) =>
  understandQuery(q, people);

const labels = (parts: QueryPart[]) => parts.map((p) => `${p.kind}:${p.label}`);

/** The query once the chip labelled `label` is removed */
function without(q: string, label: string, people = PEOPLE): string {
  const part = understandQuery(q, people, TAGS).parts.find(
    (p) => p.label === label,
  );
  assert.ok(part, `no part ${label} in ${q}`);
  return removeParts(q, [part]);
}

void test("a person, a year and what the photos show", () => {
  const u = read("Suzie à la plage en 2015");
  assert.deepEqual(labels(u.parts), ["person:Suzie", "date:2015"]);
  assert.deepEqual(u.people, [1]);
  assert.deepEqual(u.dates, {
    ranges: [{ from: "2015-01-01", before: "2016-01-01" }],
    annual: [],
  });
  assert.equal(u.text, "plage");
  assert.equal(u.content, "plage");
  assert.equal(u.cut, true);
  assert.equal(without("Suzie à la plage en 2015", "2015"), "Suzie à la plage");
  assert.equal(
    without("Suzie à la plage en 2015", "Suzie"),
    "à la plage en 2015",
  );
});

void test("two people at Christmas: the days of the holidays, ranked by Noël", () => {
  const u = read("Céline et Stéphane à Noël");
  assert.deepEqual(labels(u.parts), [
    "person:Céline",
    "person:Stéphane",
    "date:Noël",
  ]);
  assert.deepEqual(u.people, [4, 5]);
  assert.deepEqual(u.dates, {
    ranges: [],
    annual: [{ from: "12-15", to: "12-30" }],
  });
  // Nothing typed is left: no content chip, and Noël orders without cutting
  assert.equal(u.text, null);
  assert.equal(u.content, "noël");
  assert.equal(u.cut, false);
  assert.equal(
    without("Céline et Stéphane à Noël", "Stéphane"),
    "Céline à Noël",
  );
  assert.equal(
    without("Céline et Stéphane à Noël", "Céline"),
    "Stéphane à Noël",
  );
  assert.equal(
    without("Céline et Stéphane à Noël", "Noël"),
    "Céline et Stéphane",
  );
});

void test("a color of the photos and a year, nothing to rank by", () => {
  const u = read("photos rouges de 2012");
  assert.deepEqual(labels(u.parts), ["color:Rouge", "date:2012"]);
  assert.deepEqual(u.colors, { color: "red", tone: null });
  assert.equal(u.content, null);
  assert.equal(without("photos rouges de 2012", "Rouge"), "photos de 2012");
  assert.equal(without("photos rouges de 2012", "2012"), "photos rouges");
});

void test("a season of a year is its months that year", () => {
  const u = read("Lucia en été 2013");
  assert.deepEqual(labels(u.parts), ["person:Lucia", "date:Été 2013"]);
  assert.deepEqual(u.dates.ranges, [
    { from: "2013-06-01", before: "2013-09-01" },
  ]);
  assert.equal(u.content, null);
  assert.equal(without("Lucia en été 2013", "Été 2013"), "Lucia");
});

void test("a person and a scene", () => {
  const u = read("Mamie dans la neige");
  assert.deepEqual(labels(u.parts), ["person:Mamie"]);
  assert.equal(u.content, "neige");
  assert.equal(u.cut, true);
});

void test("accents and case aside", () => {
  const u = read("CELINE ET STEPHANE A NOEL");
  assert.deepEqual(u.people, [4, 5]);
  assert.deepEqual(labels(u.parts), [
    "person:Céline",
    "person:Stéphane",
    "date:Noël",
  ]);
  // The embedder reads the word, accented
  assert.equal(u.content, "noël");
  assert.deepEqual(
    read("lucia en ete 2013").dates,
    read("Lucia en été 2013").dates,
  );
  assert.deepEqual(read("DECEMBRE 2012").dates.ranges, [
    { from: "2012-12-01", before: "2013-01-01" },
  ]);
});

void test("a year inside a word is no date: the filename query stays whole", () => {
  for (const q of ["IMG_2015", "IMG_2015.JPG", "2015.jpg", "DSC2015"]) {
    const u = read(q);
    assert.deepEqual(u.parts, [], q);
    assert.equal(u.content, q, q);
  }
});

void test("only filters: the person's photos of that year, no content", () => {
  const u = read("Suzie 2015");
  assert.deepEqual(u.people, [1]);
  assert.equal(u.dates.ranges.length, 1);
  assert.equal(u.text, null);
  assert.equal(u.content, null);
  // Stopwords around them do not make a content either
  assert.equal(read("les photos de Suzie en 2015").content, null);
  assert.equal(read("Suzie et moi").content, null);
});

void test("nothing understood: the query is the content, as typed", () => {
  assert.equal(
    read("un gâteau d'anniversaire").content,
    "gâteau d'anniversaire",
  );
  assert.equal(read("photos").content, "photos");
  assert.equal(read("  la  ").content, "la");
  assert.equal(read("").content, null);
  assert.deepEqual(read("la tour eiffel").parts, []);
});

void test("a name that is also a word is the person, whole words only", () => {
  const rose: NamedPerson[] = [...PEOPLE, { id: 30, name: "Rose" }];
  // Named people come first: with a Rose, « rose » is her, not pink
  assert.deepEqual(read("Rose à la plage", rose).people, [30]);
  assert.deepEqual(read("rose", rose).colors, { color: null, tone: null });
  // « roses » is not her name: a color of the photos
  assert.deepEqual(read("roses", rose).colors, { color: "pink", tone: null });
  // A common noun as a name answers lower case too
  assert.deepEqual(read("mamie à noël").people, [14]);
  // Never inside a longer word
  assert.deepEqual(read("Isabelle à la plage").people, []);
  assert.deepEqual(read("Isa à la plage").people, [7]);
});

void test("a longer name, or its first name when nobody else has it", () => {
  const people: NamedPerson[] = [
    { id: 40, name: "Léa Martin" },
    { id: 41, name: "Léa Dupont" },
    { id: 42, name: "Paul Durand" },
  ];
  assert.deepEqual(read("Léa Martin en 2019", people).people, [40]);
  assert.deepEqual(read("Paul au ski", people).people, [42]);
  // Two Léa: the first name alone says nobody
  assert.deepEqual(read("Léa au ski", people).people, []);
});

void test("a color right after a thing describes the thing", () => {
  assert.deepEqual(read("un chat noir").parts, []);
  assert.equal(read("un chat noir").content, "chat noir");
  assert.deepEqual(read("voiture rouge").parts, []);
  // Led by « en » or « couleurs », it is the photo's
  const bw = read("plage en noir et blanc");
  assert.deepEqual(labels(bw.parts), ["tone:Noir et blanc"]);
  assert.equal(bw.content, "plage");
  assert.deepEqual(read("Suzie en rouge").colors, { color: "red", tone: null });
  assert.deepEqual(read("fleurs aux couleurs vives").colors, {
    color: null,
    tone: "vives",
  });
  // After a filter or alone, too
  assert.deepEqual(read("Suzie noir et blanc").colors, {
    color: null,
    tone: "nb",
  });
  assert.deepEqual(read("bleu").colors, { color: "blue", tone: null });
});

void test("one color and one tone at most: a second color is content", () => {
  const u = read("photos rouges sombres");
  assert.deepEqual(u.colors, { color: "red", tone: "sombre" });
  const two = read("rouge et bleu");
  assert.deepEqual(two.colors, { color: "red", tone: null });
  assert.equal(two.content, "bleu");
});

void test("year ranges, open ends and decades", () => {
  const range = { from: "2010-01-01", before: "2013-01-01" };
  for (const q of [
    "2010-2012",
    "2010 à 2012",
    "de 2010 à 2012",
    "entre 2010 et 2012",
    "2012-2010",
  ]) {
    const u = read(q);
    assert.deepEqual(u.dates.ranges, [range], q);
    assert.deepEqual(labels(u.parts), ["date:2010–2012"], q);
  }
  assert.deepEqual(read("avant 2010").dates.ranges, [
    { from: null, before: "2010-01-01" },
  ]);
  assert.deepEqual(read("après 2018").dates.ranges, [
    { from: "2019-01-01", before: null },
  ]);
  assert.deepEqual(read("depuis 2018").dates.ranges, [
    { from: "2018-01-01", before: null },
  ]);
  assert.deepEqual(read("les années 90").dates.ranges, [
    { from: "1990-01-01", before: "2000-01-01" },
  ]);
  assert.deepEqual(read("années 2000").dates.ranges, [
    { from: "2000-01-01", before: "2010-01-01" },
  ]);
});

void test("months, days and seasons, with a year or every year", () => {
  assert.deepEqual(
    read("décembre 2012").parts.map((p) => p.label),
    ["Décembre 2012"],
  );
  assert.deepEqual(read("en décembre").dates, {
    ranges: [],
    annual: [{ from: "12-01", to: "12-31" }],
  });
  assert.deepEqual(read("le 14 juillet 2019").dates.ranges, [
    { from: "2019-07-14", before: "2019-07-15" },
  ]);
  assert.deepEqual(read("1er janvier").dates.annual, [
    { from: "01-01", to: "01-01" },
  ]);
  assert.deepEqual(read("2012-07-14").dates.ranges, [
    { from: "2012-07-14", before: "2012-07-15" },
  ]);
  assert.deepEqual(read("14/07/2012").dates.ranges, [
    { from: "2012-07-14", before: "2012-07-15" },
  ]);
  assert.deepEqual(read("2012-07").dates.ranges, [
    { from: "2012-07-01", before: "2012-08-01" },
  ]);
  // Winter of a year: its January, February and December
  assert.deepEqual(read("hiver 2010").dates.ranges, [
    { from: "2010-01-01", before: "2010-03-01" },
    { from: "2010-12-01", before: "2011-01-01" },
  ]);
  assert.deepEqual(read("l'hiver").dates.annual, [
    { from: "12-01", to: "02-29" },
  ]);
  assert.deepEqual(read("à l'été 2019").dates.ranges, [
    { from: "2019-06-01", before: "2019-09-01" },
  ]);
  // Not a date: a day with no month, a month inside a word
  assert.deepEqual(read("3 chats").parts, []);
  assert.deepEqual(read("2021-02-29").parts, []);
});

void test("Noël of a year is its holidays; dates of a query add up", () => {
  const u = read("Noël 2011");
  assert.deepEqual(u.dates.ranges, [
    { from: "2011-12-15", before: "2011-12-31" },
  ]);
  assert.equal(u.content, "noël");
  // A year and a month apart: that month of that year
  assert.deepEqual(read("2012 en décembre").dates, {
    ranges: [{ from: "2012-01-01", before: "2013-01-01" }],
    annual: [{ from: "12-01", to: "12-31" }],
  });
  // Two years: either
  assert.equal(read("2015 et 2016").dates.ranges.length, 2);
  // A typed content keeps the relevance floor, Noël joins it
  const tree = read("Suzie à Noël avec le sapin");
  assert.equal(tree.text, "sapin");
  assert.equal(tree.content, "noël avec le sapin");
  assert.equal(tree.cut, true);
});

void test("removing a chip leaves no dangling « et » or comma", () => {
  const q = "Suzie, Céline et Stéphane";
  assert.equal(without(q, "Suzie"), "Céline et Stéphane");
  assert.equal(without(q, "Céline"), "Suzie et Stéphane");
  assert.equal(without(q, "Stéphane"), "Suzie, Céline");
  const u = read(q);
  assert.equal(removeParts(q, u.parts), "");
  // Two chips at once (the color bar dropping a color and a tone)
  const dark = read("photos rouges sombres de 2012");
  assert.equal(
    removeParts(
      "photos rouges sombres de 2012",
      dark.parts.filter((p) => p.kind !== "date"),
    ),
    "photos de 2012",
  );
});

void test("stopwords say nothing a photo shows", () => {
  assert.equal(isStopword("à"), true);
  assert.equal(isStopword("Photos"), true);
  assert.equal(isStopword("plage"), false);
});

// ---- how faces look, scene tags, nobody else ---------------------------------

const withTags = (q: string, people: NamedPerson[] = PEOPLE) =>
  understandQuery(q, people, TAGS);

void test("a person and how her face looks: that face, not anyone's", () => {
  const u = read("Céline qui sourit");
  assert.deepEqual(labels(u.parts), ["person:Céline", "expression:Sourit"]);
  assert.deepEqual(u.faces, [{ person: 4, expression: "sourit" }]);
  // Her smiling face says she is on the photo
  assert.deepEqual(u.people, []);
  assert.equal(u.content, null);
  assert.equal(without("Céline qui sourit", "Sourit"), "Céline");
  assert.equal(without("Céline qui sourit", "Céline"), "qui sourit");
});

void test("every word of each look, after a name", () => {
  const cases: [string, string][] = [
    ["Céline souriante", "sourit"],
    ["Céline heureuse", "sourit"],
    ["Stéphane qui rit", "rit"],
    ["Stéphane éclate de rire", "rit"],
    ["Stéphane mort de rire", "rit"],
    ["Suzie triste", "triste"],
    ["Suzie qui pleure", "triste"],
    ["Suzie en larmes", "triste"],
    ["Suzie en colère", "colere"],
    ["Suzie fâchée", "colere"],
    ["Suzie qui boude", "colere"],
    ["Suzie surprise", "surpris"],
    ["Suzie étonnée", "surpris"],
    ["Suzie a peur", "peur"],
    ["Suzie qui a peur", "peur"],
    ["Suzie effrayée", "peur"],
    ["Céline les yeux fermés", "yeux_fermes"],
    ["Céline qui a les yeux fermés", "yeux_fermes"],
    ["Céline yeux clos", "yeux_fermes"],
  ];
  for (const [q, expression] of cases) {
    const u = read(q);
    assert.equal(u.faces.length, 1, q);
    assert.equal(u.faces[0]?.expression, expression, q);
    assert.notEqual(u.faces[0]?.person, null, q);
    assert.equal(u.content, null, q);
  }
});

void test("a look after several names is each one's", () => {
  const u = read("Céline et Stéphane qui sourient");
  assert.deepEqual(u.faces, [
    { person: 4, expression: "sourit" },
    { person: 5, expression: "sourit" },
  ]);
  assert.deepEqual(u.people, []);
  // Only the names just before it
  const two = read("Céline qui sourit et Stéphane");
  assert.deepEqual(two.faces, [{ person: 4, expression: "sourit" }]);
  assert.deepEqual(two.people, [5]);
  // Two looks of one face
  assert.deepEqual(read("Céline qui sourit les yeux fermés").faces, [
    { person: 4, expression: "sourit" },
    { person: 4, expression: "yeux_fermes" },
  ]);
});

void test("a look with nobody named is anyone's", () => {
  for (const q of [
    "quelqu'un qui pleure",
    "photos tristes",
    "des gens qui pleurent",
    "triste",
  ]) {
    const u = read(q);
    assert.deepEqual(u.faces, [{ person: null, expression: "triste" }], q);
    assert.equal(u.content, null, q);
  }
  assert.deepEqual(read("quelqu'un qui a peur").faces, [
    { person: null, expression: "peur" },
  ]);
  assert.deepEqual(read("tout le monde rit").faces, [
    { person: null, expression: "rit" },
  ]);
});

void test("a look right after a thing, or a word that says something else, stays content", () => {
  assert.deepEqual(read("un chien heureux").parts, []);
  assert.equal(read("un chien heureux").content, "chien heureux");
  // Alone, « peur » is not a face
  assert.deepEqual(read("un film qui fait peur").faces, []);
  assert.deepEqual(read("gâteau surprise").faces, []);
});

void test("scene tags: their words, plurals and leading words", () => {
  const cats = withTags("photos de chats");
  assert.deepEqual(labels(cats.parts), ["tag:Chat"]);
  assert.deepEqual(cats.tags, [{ tag: "chat", negated: false }]);
  assert.equal(cats.content, null);
  assert.deepEqual(withTags("des oiseaux").tags, [
    { tag: "oiseau", negated: false },
  ]);
  assert.deepEqual(withTags("chevaux").tags, [
    { tag: "cheval", negated: false },
  ]);
  assert.deepEqual(withTags("un coucher de soleil").tags, [
    { tag: "coucher_de_soleil", negated: false },
  ]);
  assert.deepEqual(withTags("que des jeunes animaux").tags, [
    { tag: "jeune_animal", negated: false },
  ]);
  assert.deepEqual(withTags("un jeune animal").tags, [
    { tag: "jeune_animal", negated: false },
  ]);
  // Without the vocabulary, the words are what the photos show
  assert.equal(read("photos de chats").content, "chats");
});

void test("a person in a scene, in a color", () => {
  const u = withTags("Suzie en extérieur dans les tons bleus");
  assert.deepEqual(labels(u.parts), [
    "person:Suzie",
    "tag:Extérieur",
    "color:Bleu",
  ]);
  assert.deepEqual(u.people, [1]);
  assert.deepEqual(u.colors, { color: "blue", tone: null });
  assert.equal(u.content, null);
  assert.equal(
    without("Suzie en extérieur dans les tons bleus", "Bleu"),
    "Suzie en extérieur",
  );
  assert.equal(
    without("Suzie en extérieur dans les tons bleus", "Extérieur"),
    "Suzie dans les tons bleus",
  );
});

void test("two people at the beach in summer", () => {
  const u = withTags("Céline et Stéphane à la plage en été");
  assert.deepEqual(labels(u.parts), [
    "person:Céline",
    "person:Stéphane",
    "tag:Plage",
    "date:Été",
  ]);
  assert.deepEqual(u.people, [4, 5]);
  assert.deepEqual(u.tags, [{ tag: "plage", negated: false }]);
  assert.deepEqual(u.dates.annual, [{ from: "06-01", to: "08-31" }]);
  assert.equal(u.content, null);
});

void test("a tag's words join the content when other words are left", () => {
  const u = withTags("un chat qui court sur la plage");
  assert.deepEqual(u.tags, [
    { tag: "chat", negated: false },
    { tag: "plage", negated: false },
  ]);
  assert.equal(u.text, "court");
  assert.equal(u.content, "chat qui court sur la plage");
  // A color after a tag's thing is that thing's
  const black = withTags("un chat noir");
  assert.deepEqual(black.colors, { color: null, tone: null });
  assert.equal(black.content, "chat noir");
});

void test("« sans » or « pas de » before a tag: not that", () => {
  assert.deepEqual(withTags("plage sans véhicule").tags, [
    { tag: "plage", negated: false },
    { tag: "vehicule", negated: true },
  ]);
  const dog = withTags("jardin pas de chien");
  assert.deepEqual(dog.tags, [
    { tag: "jardin", negated: false },
    { tag: "chien", negated: true },
  ]);
  assert.equal(
    without("plage sans véhicule", "En voiture, train, avion"),
    "plage",
  );
});

void test("what a negation says is never what the photos show", () => {
  // No tag says « parasol »: no content, and certainly not « parasol »
  const u = withTags("plage sans parasol");
  assert.deepEqual(u.tags, [{ tag: "plage", negated: false }]);
  assert.equal(u.content, null);
  assert.equal(read("sans").content, "sans");
  assert.equal(read("un chien pas de laisse").content, "chien");
  assert.equal(read("ni vent ni pluie").content, null);
});

void test("« sans » or « ni » before a name: not on the photos", () => {
  const u = read("Suzie sans Céline");
  assert.deepEqual(labels(u.parts), ["person:Suzie", "without:Céline"]);
  assert.deepEqual(u.people, [1]);
  assert.deepEqual(u.withoutPeople, [4]);
  assert.equal(u.content, null);
  assert.deepEqual(read("Céline ni Stéphane ni Suzie").withoutPeople, [5, 1]);
  assert.deepEqual(read("pas Isa").withoutPeople, [7]);
  assert.equal(without("Suzie sans Céline", "Céline"), "Suzie");
});

void test("« que » says only at the start or after « ne », « rien », « juste »", () => {
  for (const q of [
    "la maison que les enfants ont construite",
    "le chat que la voisine a adopté",
    "Suzie et le gâteau que Mamie a fait",
  ])
    assert.equal(withTags(q).only, false, q);
  for (const q of [
    "que des chats",
    "il n'y a que des chats",
    "juste que Suzie",
  ])
    assert.equal(withTags(q).only, true, q);
});

void test("only with a look on anyone's face: everyone looks so", () => {
  const u = read("que des enfants qui sourient");
  assert.equal(u.only, true);
  assert.deepEqual(u.faces, [{ person: null, expression: "sourit" }]);
  assert.deepEqual(labels(u.parts), [
    "only:Tout le monde",
    "expression:Sourit",
  ]);
  assert.equal(read("seulement des gens qui rient").only, true);
});

void test("nobody on the photos, or nobody else than the people named", () => {
  const kittens = withTags("que des chatons");
  assert.deepEqual(labels(kittens.parts), ["only:Sans personne", "tag:Chaton"]);
  assert.equal(kittens.only, true);
  assert.deepEqual(kittens.tags, [{ tag: "chaton", negated: false }]);
  assert.equal(without("que des chatons", "Sans personne"), "des chatons");
  for (const q of [
    "seulement des chats",
    "uniquement des chats",
    "chats sans personne",
    "chats, personne d'autre",
  ]) {
    const u = withTags(q);
    assert.equal(u.only, true, q);
    assert.deepEqual(u.tags, [{ tag: "chat", negated: false }], q);
  }
  const alone = read("Suzie seule");
  assert.deepEqual(labels(alone.parts), [
    "person:Suzie",
    "only:Personne d'autre",
  ]);
  assert.deepEqual(alone.people, [1]);
  assert.equal(read("que Suzie").only, true);
  assert.equal(read("rien que Suzie et Céline").only, true);
  // « que » alone says nothing
  assert.equal(read("ce que j'aime").only, false);
});

void test("a date as the URL carries it", () => {
  assert.deepEqual(readDate("2015"), {
    label: "2015",
    dates: {
      ranges: [{ from: "2015-01-01", before: "2016-01-01" }],
      annual: [],
    },
  });
  assert.equal(readDate("été 2015")?.label, "Été 2015");
  assert.deepEqual(readDate("en été")?.dates.annual, [
    { from: "06-01", to: "08-31" },
  ]);
  assert.equal(readDate("noël")?.label, "Noël");
  assert.equal(readDate("2010-2012")?.label, "2010–2012");
  // No date, or more than one
  assert.equal(readDate("plage"), null);
  assert.equal(readDate("2015 plage"), null);
  assert.equal(readDate(""), null);
});

void test("every phrase of every look reads after a name", () => {
  for (const { phrase, expression } of expressionPhrases()) {
    const u = read(`Suzie ${phrase}`);
    assert.deepEqual(u.faces, [{ person: 1, expression }], phrase);
    assert.equal(u.content, null, phrase);
  }
});

void test("every word of every tag reads as it", () => {
  for (const entry of TAGS)
    for (const word of entry.words)
      for (const q of [word, `photos de ${word}`, `sans ${word}`]) {
        // Noël is a date first: the tag only comes from the menu
        if (entry.tag === "noel") continue;
        const u = withTags(q);
        assert.deepEqual(
          u.tags,
          [{ tag: entry.tag, negated: q.startsWith("sans") }],
          q,
        );
      }
});

void test("every way to say nobody else", () => {
  for (const q of [
    "sans personne",
    "sans personnes",
    "sans gens",
    "sans visage",
    "sans humains",
    "personne d'autre",
    "sans personne d'autre",
    "seulement des chats",
    "uniquement des chats",
    "rien que des chats",
    "que des chats",
    "que les chats",
  ])
    assert.equal(withTags(q).only, true, q);
  for (const q of [
    "Suzie seule",
    "Suzie toute seule",
    "Suzie et Lucia seules",
    "Stéphane tout seul",
  ])
    assert.equal(read(q).only, true, q);
  // « seul » with no name before it is no one
  assert.equal(read("seul").only, false);
});

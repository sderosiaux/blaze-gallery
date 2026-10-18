import assert from "node:assert/strict";
import { test } from "node:test";
import {
  isStopword,
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

const read = (q: string, people: NamedPerson[] = PEOPLE) =>
  understandQuery(q, people);

const labels = (parts: QueryPart[]) => parts.map((p) => `${p.kind}:${p.label}`);

/** The query once the chip labelled `label` is removed */
function without(q: string, label: string, people = PEOPLE): string {
  const part = read(q, people).parts.find((p) => p.label === label);
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

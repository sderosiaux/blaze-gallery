# Using Blaze Gallery

How to find photos, name the people in them, keep the library up to date,
and pick it all up again on a new machine. Setup and hosting are in
[SETUP.md](SETUP.md) and [DEPLOYMENT.md](DEPLOYMENT.md).

## Finding photos

Open the search box with ⌘K or `/` and type the way you'd say it, in
French: « Alice qui sourit à la plage en été », « que des chatons »,
« Paul et Alice en 2019 dans les tons bleus ». The box shows what it
understood as chips under the field before you press Enter.

It reads:

- **People:** a full name, or a first name nobody else has. « et » or
  « avec » between names keeps the photos where all of them are.
  « sans Paul » leaves out the photos where Paul is.
- **Looks, on that person's own face:** « sourit », « rit » (laughing,
  mouth open), « triste », « yeux fermés ». Without a name they apply to
  anyone's face. « triste » only counts people you have named.
- **Scenes and places:** indoors and outdoors, animals, places and moments.
  The full list, with the words each one answers to, is in
  `db/tags.json`.
- **Colours and tones:** « en bleu », « dans les tons rouges », « noir et
  blanc », « couleurs vives ». A colour right after a noun describes that
  thing instead: « un chat noir » searches for a black cat.
- **Dates:** a year, a range (« 2010 à 2012 », « avant 2015 »), a month, a
  day, a season, « Noël ».
- **Nobody else:** « que des », « seulement », « sans personne » keep the
  photos with no faces at all (« que des chatons »), or with nobody but the
  people you named (« Alice seule »).

Whatever is left (« un gâteau », « au bord d'un lac ») is matched by
meaning. That part needs the embedder running (see DEPLOYMENT.md); when it
doesn't answer, the other filters still apply.

Press Enter to filter the page you're on. « Chercher partout » opens the
Recherche page. Every page of photos (Chronologie, Couleurs, a person,
a Bibliothèque folder, Carte, Favoris) has the same filter bar: remove a
chip with its ×, add one with « + Filtre », drop them all with
« Effacer ». The filter follows you from one page to the next.

What a filter promises: a look or a scene is offered only if it was right at
least 9 times in 10 on the photos checked by hand. That rule left out
anger, surprise, fear and puppies, and made « plage » strict (a beach in
the picture, not just the sea behind someone). The thresholds and how they
were measured are in [TAGS.md](TAGS.md). While the library is being tagged
again, a line under the chips says how much of it has been read so far.

## Stacks of near-duplicates

A burst, a shot taken again within seconds, an edit, a resized copy and the
same file in two folders show as one tile: the best of them, with the number
of photos behind it. In the viewer the others sit under the photo; ↑ and ↓
go through them. With a filter on, the tile is the best photo the filter
keeps, and the viewer still opens the whole stack. The worker makes the
stacks (DEPLOYMENT.md); a new photo joins its stack at the weekly run.

## Throwing photos away

The trash on a tile (held one second), Suppr in the viewer and « Garder
celle-ci » under a stack (the photo shown stays, the others go) send photos
to the Corbeille, under Admin. They leave every view at once; « Annuler »
just after, or « Restaurer » in the Corbeille, brings them back. After 30
days the weekly script erases them from the bucket, every version of the
file; « Vider la corbeille » does it at once. Admin › Doublons goes through
the stacks in bulk: the photo kept is ticked, a click picks another, and the
button says how many photos will go.

`npm run dedupe -- copies`, then `-- near`, does the same without you, only
where nothing is in doubt (`src/lib/autoTrash.ts` lists what holds a photo
back). It prints what would go; `--plan` writes that to a file and
`--apply` throws exactly that away, as one lot. The Corbeille lists each
lot beside the photos kept, and « Restaurer le lot » puts it back.

## Naming people

The worker finds faces; you say who they are.

In the app, name a face from the photo viewer. Each person's page has an
« À trier » tab with the faces that look like them: accept or reject them
there. Naming or accepting a face straight away proposes its look-alikes.

On the worker machine, `blaze-people` does the same in bulk:

| Command                                                   | What it's for                                                                                                                                  |
| --------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `create --name "Alice"`                                   | A new person.                                                                                                                                  |
| `seed --person Alice --faces 12,34`                       | A few faces you're sure of, to start from.                                                                                                     |
| `expand --person Alice`                                   | Accepts the faces very close to the known ones (from 0.60) and puts those fairly close (from 0.30) in « À trier ». `--dry-run` writes nothing. |
| `label --person Alice --accept 1,2 --reject 3 --by owner` | Your yes and no, as the « À trier » tab records them.                                                                                          |
| `status --person Alice`                                   | Faces per year, and how far the faces pass has got.                                                                                            |

A face is compared with the person's faces taken within 18 months of it,
so a child is matched against the child, not the adult. Faces you reject
are never proposed again for that person.

## Keeping the library up to date

Drop new photos into the bucket. Once a week (Sunday 03:30, from cron),
`worker/weekly.sh` on the worker machine indexes them: bucket sync, folder
colours, then thumbnails and colours, faces, embeddings, scene tags and
stacks of near-duplicates, each worker stopping when its queue is empty so
the database can suspend. It also erases what has waited 30 days in the
Corbeille (`npm run trash` says how much). To see new photos sooner, run the
script by hand.

Changing the scene vocabulary has an order to follow, written at the end of
TAGS.md.

The app is deployed with the Vercel CLI from a clean checkout of `main`.
Before deploying, run `git status` in your working copy and
`vercel ls <project>`: if the working copy has changes, or production runs a
deployment that didn't come from `main`, put that work on `main` first, or
the deploy will remove it.

## Moving to a new machine

Everything in Git comes back with a clone. What doesn't, and has to be
carried over by hand:

- **The app's environment:** `.env.local` (database, bucket, thumbnail
  bucket, `API_KEY`, `EMBEDDER_*`). The same values live in the Vercel
  project's settings. Run `vercel link` once in the new clone to point the
  CLI at the project again.
- **The worker machine,** if it moves too: the env files in
  `~/blaze-worker/`, the embedder's certificate and token, the clone in
  `~/blaze-sync/repo`, and the cron line for `worker/weekly.sh`. The images
  are rebuilt as DEPLOYMENT.md describes.
- **The `describe` task** runs on Apple silicon only (MLX): set it up again
  with `uv sync --extra describe` in `worker/` on the new Mac.

Then `npm ci && npm run dev` for the app, `uv sync` in `worker/` for the
worker. Both read the same database, so nothing else needs restoring.

# Tags: how they are scored, how the thresholds were set

`photo_tags` holds, for each photo, a score per tag of `db/tags.json`. This
note records why the scores are made the way they are and where each
threshold comes from. The formula itself is in
`worker/src/blaze_worker/tags.py`.

## Method

Zero-shot, from the SigLIP2 embeddings the embed task already stores. The
worker reads no images and needs no training labels. The text tower embeds a
few short English prompts per tag, once per vocabulary.

- Immich's ONNX export holds the two towers only. SigLIP's logit scale and
  bias come from the checkpoint it was exported from
  (`timm/ViT-B-16-SigLIP2`, and the same values in
  `google/siglip2-base-patch16-224`): scale exp(4.7245) = 112.67, bias
  −16.77. With the model's own bias, a short prompt like "a photo of a cat"
  scores p = 0.013 on an obvious cat ("a cat lying on a shoe" gets 0.90).
  So I kept the model's slope and gave each tag its own bias. Every tag then
  spreads over 0..1, and one storage floor (0.05) works for all of them.
- Indoors, outdoors and screen or document share one softmax. On the 2,061
  photos Qwen3-VL described (used to measure, never to tag), the softmax
  ranks indoor against outdoor at AUC 0.9993, against 0.978 for each
  prompt's sigmoid alone. Without the screen/document class, screenshots
  fell on either side at random.
- "In a vehicle" is a tag of its own, scored against those three. It was a
  fourth class of the softmax until the owner's answers: he files a car's or
  a plane's interior as indoors and the view through the windscreen as
  outdoors (5 photos out of 5), so a vehicle class must not take their
  share.
- Prompts are short and plain. Ensembles of content-laden paraphrases
  ("inside a restaurant", "a street outside") pulled the scene ranking down
  (AUC 0.998) and the cat ranking too (AP 0.75 against 0.81). French prompts
  added nothing.
- A tag has rivals only where the library fools the model. With ~7,000 cat
  photos, half of the top "a photo of a dog" were cats, so a dog must also
  look more like a dog than like a cat, a bear, a statue or a stuffed toy.
  "A photo of snow" brought up white cats and became snowy landscapes. Normalizing
  against generic backgrounds ("a photo", "a room") made 4 tags out of 6
  worse, so I dropped it.
- Places and moments also have descriptions with people in them (v3).
  Measured on the photos the faces task found faces on (56,297), v2 tagged
  0.00% of them "plage", 0.01% "foret", 0.05% "jardin": "a photo of a
  beach" scores low as soon as someone stands in front of it, and in a
  family library that is most beaches. Each of these tags now takes the
  larger of two logits, its own and that of "a photo of people at the
  beach", "a family on the beach"... (averaged like any match), each with
  its own bias. Averaging the four people prompts ranked a hard set of 60
  seaside photos of Céline better than any one of them or their max (AUC
  0.74 against 0.67 to 0.70). The people bias is set from the people
  photos only, by the same band checks as the thresholds, so a threshold
  means the same thing with or without someone in the frame.
- Some tags build on others. A kitten is a cat that looks more like a
  kitten than like an adult cat. "animal" and "jeune_animal" take the largest of their own
  score and their species' scores, moved in logit so that each species'
  threshold lands on theirs: a photo that has "chat" always has "animal".
  Those thresholds therefore change stored scores, so they are part of the
  job's model.

## Thresholds

Target: at least 90% precision at the threshold, as much recall as that
leaves.

The owner judged indoor/outdoor, "chaton" and "jeune_animal" on 40 photos.
I set the others by eye, on two samples per tag:

- A stratified sample: 30 photos drawn across score bands, each standing
  for its band's population. It gives a weighted precision and a recall.
  The recall only counts the positives inside the sampled range, so it
  runs high.
- A band check: 24 photos drawn from just above the threshold, where the
  errors gather.

| tag | threshold | photos | band check | sample precision | sample recall |
|---|---|---|---|---|---|
| vehicule | 0.85 | 689 | 22/24, 23/24 drawn from all above | 0.92 | 0.38 |
| ecran_document | 0.88 | 1,961 | 24/24 | 1.00 | 0.66 |
| chat | 0.60 | 6,955 | 24/24 | 0.96 | 0.95 |
| chien | 0.65 | 108 | 22/24 | 1.00 | 0.35 |
| cheval | 0.80 | 131 | 24/24 | 1.00 | 0.55 |
| oiseau | 0.94 | 96 | 22/24 | 1.00 | 0.09 |
| animal | 0.80 | 9,490 | 20/24, 24/24 drawn from all above | 0.95 | 0.61 |
| plage | 0.75 | 777 | 23/24 | 1.00 | 0.25 |
| mer | 0.80 | 13,790 | 21/24 | 1.00 | 0.73 |
| montagne | 0.90 | 14,799 | 21/24 | 1.00 | 0.48 |
| neige | 0.70 | 1,165 | 24/24 | 1.00 | 0.45 |
| foret | 0.60 | 1,606 | 22/24 | 0.92 | 0.37 |
| jardin | 0.70 | 1,632 | 22/24 | 1.00 | 0.25 |
| ville | 0.40 | 13,882 | 24/24 | 1.00 | 0.75 |
| piscine | 0.90 | 134 | 21/24 | 1.00 | 0.29 |
| nuit | 0.85 | 2,648 | 20/24, 24/24 drawn from all above | 1.00 | 0.44 |
| coucher_de_soleil | 0.90 | 525 | 24/24 | 1.00 | 0.39 |
| anniversaire | 0.80 | 254 | 21/24 | 1.00 | 0.79 |
| noel | 0.80 | 341 | 21/24, 22/24 drawn from all above | 0.91 | 0.26 |
| mariage | 0.80 | 7,489 | 24/24 | 1.00 | 0.86 |
| nourriture | 0.65 | 636 | 21/24 | 1.00 | 0.36 |

For animal, nuit and noel, where the band check came out weakest, a second
draw of 24 from everything above the threshold gives the overall precision.
The three animal photos that first looked wrong held one when enlarged (a
white horse in the dark, zoo animals among rocks, a sleeper on a branch).
I checked vehicule again once it was scored against the three scene
classes (v2). Taking it out of the softmax moved 166 more photos above the
ecran_document threshold; 24 of them checked, all screens or documents.

The owner's thresholds:

| tag | threshold | photos | his answers | other measure |
|---|---|---|---|---|
| interieur | 0.50 | 47,949 | 9/10 above the threshold | Qwen labels: precision 0.984, recall 0.993 |
| exterieur | 0.60 | 165,651 | 8/10 above the threshold | Qwen labels: precision 0.996, recall 0.937 |
| chaton | 0.80 | 433 | 4/4 above 0.75 | my band check at 0.75 to 0.85: about 20/24 |
| jeune_animal | 0.75 | 597 | 4/4 non-cat young animals, scored 0.30 to 0.65 | my band check: about 23/24 above 0.75, 17/24 from 0.60 to 0.75 |

His 24 indoor/outdoor photos were the traps: 10 near the boundary, 9 covered
terraces, verandas or glass roofs, 5 inside a vehicle. The errors left are
covered terraces, which he files on both sides, and a dark arcade read as
indoors. A photo below both thresholds (5,989 of 219,589) has neither tag.

For chaton and jeune_animal his answers were too few to set a threshold
alone, so my band checks raised them. All four non-cat young animals he said
yes to sit below 0.75, so jeune_animal finds kittens, chicks and little else.

Where precision is weak:

- `oiseau`: small birds in foliage keep precision near 50% until 0.9.
  Above 0.94 it is precise but finds few birds.
- `montagne`: canyons and mesas (Bryce, Grand Canyon) score like
  mountains at every level. Counted as wrong above; whether they belong is a
  matter of taste.
- `mer` loses precision under 0.8 because lakes, fjords and rivers read
  as sea.
- `noel` is wrong on some festive dinners and city lights unrelated to
  Christmas.
- `animal`: below 0.8, foliage with no visible animal comes up.

People in the frame (v3), share of the photos with faces above each
threshold, and the photos of Céline (person 4) tagged, before and after:

| tag | photos with faces, v2 | v3 | Céline, v2 | v3 | v3 band check | v3 drawn from all above |
|---|---|---|---|---|---|---|
| plage (v4) | 0.00% | 0.70% | 0 | 210 | 24/24 | 23/24 |
| mer | 0.56% | 2.46% | 184 | 1,060 | 20/24 | 24/24 |
| montagne | 0.82% | 6.75% | 335 | 2,766 | 21/24 | 24/24 |
| neige | 0.19% | 0.42% | 74 | 155 | 22/24 | 24/24 |
| foret | 0.01% | 1.26% | 0 | 428 | 20/24 | 23/24 |
| jardin | 0.05% | 1.61% | 12 | 226 | 21/24 | 23/24 |
| ville | 0.98% | 5.51% | 118 | 1,972 | 20/24 | 22/24 |
| piscine | 0.02% | 0.05% | 1 | 1 | 20/24 | 22/24 |
| nuit | 0.50% | 0.90% | 102 | 201 | 21/24 | 21/24 |
| coucher_de_soleil | 0.00% | 0.07% | 0 | 33 | 24/24 | 24/24 |

On the 2,061 photos Qwen3-VL described, nearly all with people, "jardin"
went from 2 photos to 206 (Qwen's garden label: precision 1.00, recall
0.005 to 0.48). For each tag I also drew 24 of the photos v3 adds, at
random and among the lowest scored: most errors there are seaside promenades
read as beaches, fjords and lakes read as sea, and parks read as gardens.
Photos without faces barely move (plage 0.48% to 1.13% of them).

The owner's side (filters) then checked plage on the photos with people,
strictly: sand or pebbles at the water, not just the sea behind. "Céline et
Stéphane à la plage en été" gave 107 photos, 16 to 22 of 30 on a beach:
my v3 checks had counted a selfie in front of the sea as a beach. In v4 the
people description of plage must also beat "a selfie by the sea" and "a
photo of people by the sea" (`versus` inside `also`, with `versus_bias`
-4: a rival must win clearly), with a bias of -9.0. On 108 photos with
faces I labelled the same strict way (60 to set it, 48 to check it), 0.91
of the photos above the threshold are on a beach, against about 0.60 in
v3. The price is recall: 396 photos with faces tagged instead of 702, 11 of
filters' 20 obvious beaches instead of 13, and all 8 of the false positives
filters found are now under the threshold. Photos without faces are
unchanged (1,834 against 1,846), and so is every other tag.

anniversaire, noel and mariage keep their v2 prompts. Their photos are
already full of people, and people prompts made them worse: on the Qwen
labels, precision fell from 0.94 to 0.79 for noel and from 0.96 to 0.67
for mariage (guests at any party).

Left out of v1:

- `chiot`: the library holds a handful of puppies. Its top ranks are dogs
  of every age and the dog statues of Canary Wharf, and no threshold
  reached 90%.

## Changing the vocabulary

A threshold, a label or a search word is read by the app from the file,
except the thresholds `any` maps (chat, chien, cheval, oiseau, animal,
chaton, jeune_animal), which are stored in the scores. Anything else that
changes a score (a prompt, a bias, a rival, a mapped threshold) changes
the job's model, and `blaze-enqueue --task tags --all` queues every photo
again. Bump `version` with it so the rows say which vocabulary made them.

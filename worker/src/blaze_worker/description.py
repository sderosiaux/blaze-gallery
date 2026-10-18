"""The describe task's contract: prompt, reply parsing, validation. No model here.

A model's reply becomes a photo_descriptions row only if it passes the JSON
Schema (photo_description.schema.json, shared with readers of the table) and
the checks a schema cannot express: French texts, a single sentence, a
framing that agrees with the people count. Fluent output is not correct
output: a reply that fails gets one retry with the errors, then the job fails
(except for English objects the retry repeats: those are dropped).

The language check is a heuristic: English function words, -ing forms and a
list of nouns the models were seen slipping in. An English noun outside the
list passes.
"""

from __future__ import annotations

import json
import re
from functools import cache
from importlib.resources import files
from typing import Any

from jsonschema import Draft202012Validator

# Bump when the prompt or the checks change what a description means
PROMPT_VERSION = "describe-v2"

PROMPT = """\
Tu indexes les photos d'une bibliothèque familiale. Regarde la photo et réponds par un seul \
objet JSON, sans texte autour.

Règles :
- Décris seulement ce qui est visible. N'invente rien : pas de prénom, pas de nom de lieu, \
pas de date, pas de lien de parenté.
- Mentionne toujours les personnes visibles (« une jeune fille », « deux hommes »), même en \
gros plan, mais pas leur visage (expression, sourire, larmes, regard) : une autre analyse \
s'en charge.
- Les textes (caption, activity, objects) sont en français, jamais en anglais.
- Dans le doute, choisis "unknown" ou "other".

Champs :
- caption : une seule phrase factuelle en français, 25 mots au plus, qui dit ce qu'on voit \
(qui, où, ce qui se passe), sans prénom.
- activity : ce qui se passe, en quelques mots en français (ex. « repas de famille », \
« ouverture des cadeaux », « promenade sur la plage ») ; si personne ne fait rien de \
particulier : « pose pour la photo » ; sans personne : ce qu'on regarde (« vue sur la mer »).
- setting : indoor (intérieur), outdoor (extérieur), vehicle (dans un véhicule), unknown.
- place_type : home, garden, restaurant, beach, mountain, city, school, party_venue (salle des \
fêtes, salle de réception), car, nature, other.
- occasion : christmas, birthday, wedding, holiday (vacances, voyage, tourisme), everyday, \
party, school_event, sport, other, unknown. Seulement d'après des indices visibles (sapin, \
bougies sur un gâteau, robe de mariée, monument...) ; sans indice : everyday ou unknown.
- people_count : nombre de personnes visibles, 0 s'il n'y en a pas.
- framing : close_up (un visage ou un détail remplit l'image), portrait (une ou deux \
personnes, tête et épaules), half_body (une ou deux personnes, jusqu'à la taille), full_body \
(une ou deux personnes, en pied), group (trois personnes ou plus), landscape (le lieu domine, \
personnes petites ou absentes), object (un objet, un plat, un animal, un document, sans \
personne).
- objects : jusqu'à 8 objets notables visibles, noms communs français au singulier \
(ex. « sapin », « gâteau », « échelle », pas « ladder »).
- mood : l'ambiance de la scène : joyful, calm, tender, funny, tired, sad, focused, festive, \
neutral.

Format :
{"caption": "...", "activity": "...", "setting": "...", "place_type": "...", \
"occasion": "...", "people_count": 0, "framing": "...", "objects": ["..."], "mood": "..."}"""

_CORRECTION = """\
Cette réponse ne respecte pas les consignes :
{errors}
Corrige ces points et renvoie l'objet JSON complet, sans texte autour."""

MAX_OBJECTS = 8
_PERSON_FRAMINGS = frozenset({"portrait", "half_body", "full_body", "group"})
# Enum words or empty answers where a phrase is expected
_PLACEHOLDERS = frozenset(
    {"unknown", "other", "none", "n/a", "inconnu", "inconnue", "aucun", "aucune", "rien"}
)

# Words that only one of the two languages uses. "a" and "on" are both (the
# French verb and pronoun), so they count for neither.
_FRENCH_WORDS = frozenset(
    {
        "le", "la", "les", "un", "une", "des", "du", "de", "et", "dans", "sur", "sous",
        "avec", "en", "au", "aux", "est", "sont", "qui", "que", "pour", "par", "à", "devant",
        "derrière", "près", "autour", "entre", "son", "sa", "ses", "leur", "leurs", "ce",
        "cette", "ces", "il", "elle", "ils", "elles", "d", "l", "qu", "se", "lors",
        "pendant", "chez",
    }
)  # fmt: skip
_ENGLISH_WORDS = frozenset(
    {
        "the", "an", "and", "in", "of", "with", "is", "are", "at", "his", "her", "their",
        "its", "this", "that", "these", "those", "while", "near", "behind", "under", "from",
        "for", "by", "they", "he", "she", "some", "who", "which", "there", "being", "has",
        "have",
    }
)  # fmt: skip
# English nouns that slip into the models' French answers, French does not
# use them, and they are not half of a French compound ("t-shirt", "week-end")
_ENGLISH_NOUNS = frozenset(
    {
        "person", "man", "men", "woman", "women", "child", "children", "girl", "kid",
        "kids", "tree", "trees", "flower", "flowers", "glass", "glasses", "cup", "bottle",
        "window", "door", "wall", "floor", "sky", "cloud", "clouds", "grass", "sea", "sand",
        "snow", "mountain", "road", "house", "sign", "dress", "hat", "bag", "phone", "toy",
        "toys", "ball", "dog", "cat", "bird", "candle", "candles", "gift", "gifts", "lamp",
        "curtain", "ladder", "nose", "hair", "eye", "eyes", "wine", "beer", "bread",
        "cheese", "fork", "knife", "spoon", "couch", "rug", "carpet", "shelf", "picture",
        "frame", "clock", "bike", "boat", "bench", "fence", "path", "hill", "field", "lake",
        "river", "bed", "shoe", "shoes", "jacket", "coat", "scarf",
    }
)  # fmt: skip
# French words ending in -ing: borrowed from English, or French all along
_FRENCH_ING = frozenset(
    {
        "camping", "parking", "shopping", "jogging", "footing", "bowling", "karting",
        "smoking", "brushing", "piercing", "pressing", "meeting", "planning", "casting",
        "coaching", "marketing", "lifting", "living", "dancing", "rafting", "trekking",
        "zapping", "training", "briefing", "building", "dressing", "pudding", "swing",
        "string", "looping", "relooking", "clubbing", "shampoing", "poing", "coing",
    }
)  # fmt: skip
_WORD = re.compile(r"[a-zà-öø-ÿœæ]+")
# A sentence end followed by another sentence
_SECOND_SENTENCE = re.compile(r"[.!?…]\s+[A-ZÀ-ÖØ-Þ]")


class InvalidReply(Exception):
    def __init__(self, errors: list[str], reply: str) -> None:
        super().__init__("; ".join(errors))
        self.errors = errors
        self.reply = reply


@cache
def schema() -> dict[str, Any]:
    return json.loads(
        files("blaze_worker").joinpath("photo_description.schema.json").read_text("utf-8")
    )


@cache
def _validator() -> Draft202012Validator:
    return Draft202012Validator(schema())


def correction(errors: list[str]) -> str:
    """The follow-up message after an invalid reply (the reply itself stays in the chat)."""
    return _CORRECTION.format(errors="\n".join(f"- {error}" for error in errors))


def _words(text: str) -> list[str]:
    return _WORD.findall(text.lower())


def english_words(text: str) -> list[str]:
    """English words of text: nouns and -ing forms French does not use, and function
    words when they outnumber French ones (an English sentence)."""
    words = _words(text)
    function = [w for w in words if w in _ENGLISH_WORDS]
    french = sum(1 for w in words if w in _FRENCH_WORDS)
    content = [
        w
        for w in words
        if w in _ENGLISH_NOUNS or (len(w) > 4 and w.endswith("ing") and w not in _FRENCH_ING)
    ]
    return (function if len(function) > french else []) + content


def parse(reply: str) -> dict[str, Any]:
    """The JSON object of a reply; tolerates a code fence or text around it."""
    start, end = reply.find("{"), reply.rfind("}")
    if start < 0 or end < start:
        raise InvalidReply(["la réponse ne contient pas d'objet JSON"], reply)
    try:
        value = json.loads(reply[start : end + 1])
    except json.JSONDecodeError as error:
        problem = f"JSON illisible : {error.msg} (position {error.pos})"
        raise InvalidReply([problem], reply) from None
    if not isinstance(value, dict):
        raise InvalidReply(["la réponse doit être un objet JSON"], reply)
    return value


def _clean(text: Any) -> Any:
    return " ".join(text.split()) if isinstance(text, str) else text


def normalize(data: dict[str, Any]) -> dict[str, Any]:
    """Harmless fixes that need no second opinion: spacing, case, duplicates, end period."""
    out = {key: _clean(value) for key, value in data.items()}
    for key in ("setting", "place_type", "occasion", "framing", "mood"):
        if isinstance(out.get(key), str):
            out[key] = out[key].lower()
    caption = out.get("caption")
    if isinstance(caption, str) and caption and caption[-1] not in ".!?…":
        out["caption"] = caption + "."
    objects = out.get("objects")
    if isinstance(objects, list):
        seen: list[Any] = []
        for item in objects:
            item = _clean(item)
            if isinstance(item, str):
                item = item.lower().strip(" .,;")
                if not item:
                    continue
            if item not in seen:
                seen.append(item)
        out["objects"] = seen[:MAX_OBJECTS]
    return out


def problems(data: dict[str, Any]) -> list[str]:
    """Everything wrong with a description, in words the model can act on."""
    errors = []
    for error in sorted(_validator().iter_errors(data), key=lambda e: list(e.path)):
        where = ".".join(str(part) for part in error.path) or "objet"
        errors.append(f"{where} : {error.message}")
    if errors:
        return errors

    caption, activity = data["caption"], data["activity"]
    if _SECOND_SENTENCE.search(caption):
        errors.append("caption : une seule phrase")
    if activity.lower().strip(" .") in _PLACEHOLDERS:
        errors.append(
            f"activity : quelques mots en français, pas « {activity} » (rien de particulier : "
            "« pose pour la photo » ; sans personne : « vue sur ... »)"
        )
    for field, text in (("caption", caption), ("activity", activity)):
        english = english_words(text)
        if english:
            errors.append(f"{field} doit être en français (mots anglais : {', '.join(english)})")
    english_objects = _english_objects(data["objects"])
    if english_objects:
        errors.append(
            f"objects doit être en français : remplace {', '.join(english_objects)} par le nom "
            "français ou retire-les"
        )
    count, framing = data["people_count"], data["framing"]
    if count == 0 and framing in _PERSON_FRAMINGS:
        errors.append(
            f"framing {framing} suppose des personnes visibles, or people_count vaut 0 : "
            "corrige l'un des deux (sans personne : landscape ou object)"
        )
    if framing == "group" and count < 3:
        errors.append(
            f"framing group veut dire trois personnes ou plus, or people_count vaut {count}"
        )
    if data["place_type"] == "car" and data["setting"] != "vehicle":
        errors.append("place_type car demande setting vehicle")
    return errors


def _english_objects(objects: list[Any]) -> list[str]:
    return [item for item in objects if isinstance(item, str) and english_words(item)]


def read_last_reply(reply: str) -> tuple[dict[str, Any], list[str]]:
    """The retry's reply, and the objects dropped from it.

    An English object left after the retry is dropped instead of failing the
    photo: objects is a best-effort list, and the model tends to repeat a word
    it lacks in French. Anything else wrong still fails.
    """
    data = normalize(parse(reply))
    objects = data.get("objects")
    dropped = _english_objects(objects) if isinstance(objects, list) else []
    if dropped:
        data["objects"] = [item for item in objects if item not in dropped]
    errors = problems(data)
    if errors:
        raise InvalidReply(errors, reply)
    return data, dropped


def read_reply(reply: str) -> dict[str, Any]:
    """The validated description of a reply, or InvalidReply with what to fix."""
    data = normalize(parse(reply))
    errors = problems(data)
    if errors:
        raise InvalidReply(errors, reply)
    return data

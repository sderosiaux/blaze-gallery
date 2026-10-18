"""The describe contract without a model or a database: parsing, normalizing, validating."""

from __future__ import annotations

import json
import platform
import sys

import numpy as np
import pytest

from blaze_worker.decode import Picture
from blaze_worker.describe import rendition, require_apple_silicon, user_rotation
from blaze_worker.description import (
    PROMPT,
    InvalidReply,
    correction,
    english_words,
    parse,
    problems,
    read_last_reply,
    read_reply,
    schema,
)

GOOD = {
    "caption": "Deux enfants ouvrent des cadeaux devant un sapin décoré dans un salon.",
    "activity": "ouverture des cadeaux",
    "setting": "indoor",
    "place_type": "home",
    "occasion": "christmas",
    "people_count": 2,
    "framing": "half_body",
    "objects": ["sapin", "cadeau", "papier cadeau", "canapé"],
    "mood": "festive",
}


def reply(**changes) -> str:
    return json.dumps({**GOOD, **changes}, ensure_ascii=False)


def test_a_good_reply_passes_unchanged():
    assert read_reply(reply()) == GOOD


def test_text_around_the_json_is_ignored():
    assert read_reply(f"```json\n{reply()}\n```") == GOOD
    assert read_reply(f"Voici la description : {reply()} Bonne journée") == GOOD


@pytest.mark.parametrize(
    "text",
    ["", "Une photo de Noël.", '{"caption": "Un sapin.",', "[1, 2]"],
)
def test_no_json_object_is_an_invalid_reply(text):
    with pytest.raises(InvalidReply) as error:
        parse(text)
    assert error.value.errors and error.value.reply == text


def test_harmless_slips_are_fixed_without_a_retry():
    data = read_reply(
        reply(
            caption="  Deux enfants   ouvrent des cadeaux devant un sapin  ",
            mood="Festive",
            objects=["Sapin", "sapin", " cadeau.", "", "canapé"],
        )
    )
    assert data["caption"] == "Deux enfants ouvrent des cadeaux devant un sapin."
    assert data["mood"] == "festive"
    assert data["objects"] == ["sapin", "cadeau", "canapé"]


def test_more_than_eight_objects_keeps_the_first_eight():
    many = [f"objet {n}" for n in range(12)]
    assert read_reply(reply(objects=many))["objects"] == many[:8]


@pytest.mark.parametrize(
    ("changes", "fragment"),
    [
        ({"setting": "inside"}, "setting"),
        ({"occasion": "noel"}, "occasion"),
        ({"framing": "wide"}, "framing"),
        ({"people_count": -1}, "people_count"),
        ({"people_count": "2"}, "people_count"),
        ({"caption": "Sapin."}, "caption"),
        ({"objects": "sapin"}, "objects"),
        ({"extra": "x"}, "extra"),
    ],
)
def test_schema_violations_name_the_field(changes, fragment):
    with pytest.raises(InvalidReply) as error:
        read_reply(reply(**changes))
    assert any(fragment in e for e in error.value.errors), error.value.errors


def test_a_missing_field_is_reported():
    data = dict(GOOD)
    del data["mood"]
    with pytest.raises(InvalidReply) as error:
        read_reply(json.dumps(data))
    assert any("mood" in e for e in error.value.errors)


def test_english_texts_are_rejected():
    errors = problems(
        {
            **GOOD,
            "caption": "Two children are opening presents in front of the Christmas tree.",
            "activity": "opening presents with the family",
            "objects": ["sapin", "bottle of wine"],
        }
    )
    assert any(e.startswith("caption doit être en français") for e in errors)
    assert any(e.startswith("activity doit être en français") for e in errors)
    assert any("bottle of wine" in e for e in errors)


@pytest.mark.parametrize(
    ("text", "english"),
    [
        ("sitting", ["sitting"]),
        ("Une femme en train de walking sur la plage.", ["walking"]),
        ("ladder", ["ladder"]),
        ("verre de wine", ["wine"]),
        ("nose", ["nose"]),
    ],
)
def test_an_english_word_in_french_text_is_caught(text, english):
    assert english_words(text) == english


@pytest.mark.parametrize(
    "text",
    [
        "Un homme fait du camping sur la plage avec un ami.",
        "Un enfant a un gâteau et on voit le jardin.",
        "pique-nique",
        "t-shirt",
        "Un enfant joue au baby-foot pendant le week-end.",
        "Une fille se lave les cheveux avec du shampoing.",
        "Un cake aux fruits sur la table du living.",
        "Un parking en face d'un building.",
    ],
)
def test_french_with_borrowed_words_is_french(text):
    assert english_words(text) == []


def test_two_sentences_are_one_too_many():
    errors = problems({**GOOD, "caption": "Un sapin dans un salon. Des enfants jouent devant."})
    assert "caption : une seule phrase" in errors
    # Abbreviations and decimals are not sentence ends
    assert problems({**GOOD, "caption": "Un panneau indique 2.5 km vers le lac."}) == []


@pytest.mark.parametrize(
    ("people_count", "framing", "ok"),
    [
        (0, "portrait", False),
        (0, "group", False),
        (2, "group", False),
        (3, "group", True),
        (0, "landscape", True),
        (0, "object", True),
        (5, "landscape", True),
    ],
)
def test_framing_agrees_with_the_people_count(people_count, framing, ok):
    errors = problems({**GOOD, "people_count": people_count, "framing": framing})
    assert (errors == []) is ok, errors


def test_nobody_poses_on_a_photo_without_people():
    landscape = {**GOOD, "people_count": 0, "framing": "landscape"}
    assert problems({**landscape, "activity": "pose pour la photo"})
    assert problems({**landscape, "activity": "Personnes qui posent"})
    assert problems({**landscape, "activity": "vue sur la montagne"}) == []
    assert problems({**GOOD, "activity": "pose pour la photo"}) == []


def test_a_car_is_a_vehicle():
    assert problems({**GOOD, "place_type": "car", "setting": "outdoor"})
    assert problems({**GOOD, "place_type": "car", "setting": "vehicle"}) == []


def test_the_retry_drops_english_objects_rather_than_failing_the_photo():
    with pytest.raises(InvalidReply) as error:
        read_reply(reply(objects=["clôture", "fence", "arbre"]))
    assert "fence" in error.value.errors[0]

    data, dropped = read_last_reply(reply(objects=["clôture", "fence", "arbre"]))
    assert data["objects"] == ["clôture", "arbre"] and dropped == ["fence"]
    assert read_last_reply(reply()) == (GOOD, [])


def test_the_retry_still_fails_on_anything_else():
    with pytest.raises(InvalidReply):
        read_last_reply(reply(objects=["fence"], people_count=0))


def test_the_correction_lists_every_error():
    text = correction(["mood : 'happy' is not one of [...]", "caption : une seule phrase"])
    assert "- mood : 'happy' is not one of [...]\n- caption : une seule phrase\n" in text


@pytest.mark.parametrize("activity", ["unknown", "Other", "inconnu.", "rien"])
def test_an_activity_must_say_something(activity):
    errors = problems({**GOOD, "activity": activity})
    assert any(e.startswith("activity :") for e in errors), errors


def test_the_prompt_lists_every_allowed_value():
    for field, spec in schema()["properties"].items():
        assert field in PROMPT
        for value in spec.get("enum", []):
            assert value in PROMPT, (field, value)


def picture(width: int, height: int) -> Picture:
    small = np.zeros((height, width, 3), np.uint8)
    small[0, 0] = (255, 0, 0)  # blue in BGR, at the displayed top-left
    return Picture(small, small, "image", 0, 0.0, 0.0)


@pytest.mark.parametrize(
    ("rotation", "size", "corner"),
    [
        (0, (40, 30), (0, 0)),
        (90, (30, 40), (29, 0)),
        (180, (40, 30), (39, 29)),
        (270, (30, 40), (0, 39)),
    ],
)
def test_the_owner_rotation_turns_the_rendition_clockwise(rotation, size, corner):
    image = rendition(picture(40, 30), rotation)
    assert image.size == size
    assert image.getpixel(corner) == (0, 0, 255)


def test_describe_refuses_to_start_off_apple_silicon(monkeypatch):
    monkeypatch.setattr(sys, "platform", "linux")
    monkeypatch.setattr(platform, "system", lambda: "Linux")
    monkeypatch.setattr(platform, "machine", lambda: "x86_64")
    with pytest.raises(SystemExit, match=r"Apple silicon.*Linux x86_64"):
        require_apple_silicon()


def test_user_rotation_reads_only_quarter_turns():
    assert user_rotation({"user_rotation": 90}) == 90
    assert user_rotation({"user_rotation": 45}) == 0
    assert user_rotation({"user_rotation": "90"}) == 0
    assert user_rotation(None) == 0

"""Stable references for PictoFlow's bundled vector drawings; no rendering dependencies."""

from enum import StrEnum


class PictogramKey(StrEnum):
    TOILETS = "toilets"
    TOY = "toy"
    BOOK = "book"
    MOTHER = "mother"
    FATHER = "father"
    STOP = "stop"
    YES = "yes"
    NO = "no"
    LOVE = "love"
    CAR = "car"
    CAT = "cat"
    SUN = "sun"
    DRINK = "drink"
    SLEEP = "sleep"
    PHONE = "phone"
    EAT = "eat"
    WATER = "water"
    HELP = "help"
    HOME = "home"
    SCHOOL = "school"
    OUTSIDE = "outside"
    WALK = "walk"
    DOG = "dog"
    MUSIC = "music"
    HAPPY = "happy"
    SAD = "sad"
    PAIN = "pain"
    SHOWER = "shower"


PICTOGRAM_SOURCE = "pictoflow-builtin-v1"


def pictogram_reference(key: PictogramKey) -> str:
    return f"pictoflow:pictogram:v1:{PictogramKey(key).value}"

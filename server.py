import json
import logging
import random
import string
import threading
import time
from copy import deepcopy
from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import parse_qs, urlparse


ROOT = Path(__file__).resolve().parent
HOST = "0.0.0.0"
PORT = 8000

ROOMS = {}
ROOM_LOCK = threading.Lock()
ROOM_MAX_AGE_SECONDS = 12 * 60 * 60  # 12 hours

logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

SUITS = [
    {"symbol": "♠", "color": "black", "name": "Pikk"},
    {"symbol": "♥", "color": "red", "name": "Kőr"},
    {"symbol": "♦", "color": "red", "name": "Káró"},
    {"symbol": "♣", "color": "black", "name": "Treff"},
]
RANKS = ["A", "2", "3", "4", "5", "6", "7", "8", "9", "10", "J", "Q", "K"]

KINGS_RULES = {
    "A": {"title": "Vízesés", "text": "Mindenki egyszerre kezd inni, és csak akkor állhatsz le, ha az előtted ülő már letette az italát."},
    "2": {"title": "Te iszol", "text": "Válassz valakit, aki iszik két kortyot vagy egy felest."},
    "3": {"title": "Én iszom", "text": "A lap húzója iszik."},
    "4": {"title": "Padló", "text": "Az utolsó, aki megérinti a padlót, iszik."},
    "5": {"title": "Fiúk", "text": "Minden fiú iszik."},
    "6": {"title": "Lányok", "text": "Minden lány iszik."},
    "7": {"title": "Mennyország", "text": "Az utolsó, aki a kezét a levegőbe emeli, iszik."},
    "8": {"title": "Haver", "text": "Válassz ivópajtást. Amíg új havert nem húznak, együtt isztok."},
    "9": {"title": "Rímelés", "text": "Mondj egy szót, és körben mindenki mondjon rá rímelő szót. Aki hibázik, iszik."},
    "10": {"title": "Kategória", "text": "Mondj egy kategóriát, és körben soroljatok elemeket. Aki megakad, iszik."},
    "J": {"title": "Szabály", "text": "Találj ki egy új szabályt, ami a játék végéig él."},
    "Q": {"title": "Kérdésmester", "text": "Te leszel a kérdésmester. Aki válaszol egy kérdésedre, iszik."},
    "K": {"title": "Király kupa", "text": "Önts a közös kupába. A negyedik király húzója megissza az egészet."},
}


def now_ts():
    return int(time.time())


def make_id(prefix):
    return prefix + "_" + "".join(random.choices(string.ascii_lowercase + string.digits, k=8))


def make_room_code():
    return "".join(random.choices(string.ascii_uppercase + string.digits, k=6))


def card_value(rank):
    if rank == "A":
        return 14
    if rank == "K":
        return 13
    if rank == "Q":
        return 12
    if rank == "J":
        return 11
    return int(rank)


def make_deck(deck_count):
    deck = []
    for deck_index in range(deck_count):
        for rank in RANKS:
            for suit in SUITS:
                deck.append(
                    {
                        "id": f"{rank}{suit['symbol']}-{deck_index}-" + "".join(random.choices(string.ascii_lowercase + string.digits, k=4)),
                        "rank": rank,
                        "suit": suit["symbol"],
                        "color": suit["color"],
                        "value": card_value(rank),
                    }
                )
    random.shuffle(deck)
    return deck


def recommended_decks(player_count):
    if player_count <= 4:
        return 1
    if player_count <= 8:
        return 2
    if player_count <= 12:
        return 3
    return 4


def ensure_room_exists(room_code):
    room = ROOMS.get(room_code)
    if not room:
        raise ValueError("A szoba nem található.")
    return room


def create_room(game, client_id):
    code = make_room_code()
    while code in ROOMS:
        code = make_room_code()

    room = {
        "code": code,
        "game": game,
        "host_id": client_id,
        "created_at": now_ts(),
        "updated_at": now_ts(),
        "watchers": {client_id: {"id": client_id, "joined_at": now_ts()}},
    }

    if game == "kings":
        room["state"] = {
            "phase": "lobby",
            "players": [],
            "started": False,
            "current_player_index": None,
            "deck": [],
            "discard": [],
            "last_card": None,
            "status": "Adj hozzá játékosokat, aztán indítsd el a játékot.",
        }
    elif game == "bus":
        room["state"] = {
            "phase": "lobby",
            "deck_count": 1,
            "recommended_decks": 1,
            "players": [],
            "deck": [],
            "discard": [],
            "pyramid": [],
            "pyramid_index": 0,
            "last_revealed_index": -1,
            "refill_choice_needed": False,
            "bus_queue": [],
            "active_bus_index": 0,
            "bus_state": None,
            "status": "Mindenki állítsa be a nevét és a képét, aztán lehet indulni.",
        }
    else:
        raise ValueError("Ismeretlen játék.")

    ROOMS[code] = room
    return room


def touch(room):
    room["updated_at"] = now_ts()


def sort_bus_players(room):
    room["state"]["players"].sort(key=lambda player: player["joined_at"])


def push_notification(player, title, text):
    player.setdefault("notifications", []).append(
        {
            "id": make_id("notif"),
            "title": title,
            "text": text,
        }
    )


def get_bus_player(room, client_id):
    for player in room["state"]["players"]:
        if player["client_id"] == client_id:
            return player
    return None


def add_or_update_bus_player(room, client_id, name, avatar):
    player = get_bus_player(room, client_id)
    if player:
        player["name"] = name or player["name"]
        player["avatar"] = avatar if avatar is not None else player["avatar"]
        return player

    player = {
        "id": make_id("player"),
        "client_id": client_id,
        "name": name or "Játékos",
        "avatar": avatar or "",
        "joined_at": now_ts(),
        "hand": [],
        "question_index": 0,
        "completed_questions": False,
        "ready_for_next": False,
        "is_bus_rider": False,
        "bus_done": False,
        "bus_total_sips": 0,
        "notifications": [],
    }
    room["state"]["players"].append(player)
    sort_bus_players(room)
    room["state"]["recommended_decks"] = recommended_decks(len(room["state"]["players"]))
    if room["state"]["phase"] == "lobby":
        room["state"]["deck_count"] = room["state"]["recommended_decks"]
    return player


def sanitize_room(room, client_id):
    base = {
        "code": room["code"],
        "game": room["game"],
        "host_id": room["host_id"],
        "updated_at": room["updated_at"],
    }

    if room["game"] == "kings":
        state = room["state"]
        players = deepcopy(state["players"])
        current_player_name = None
        if state["started"] and players and state["current_player_index"] is not None:
            current_player_name = players[state["current_player_index"]]["name"]

        base["state"] = {
            "phase": state["phase"],
            "players": players,
            "started": state["started"],
            "current_player_index": state["current_player_index"],
            "current_player_name": current_player_name,
            "deck_count": len(state["deck"]),
            "last_card": deepcopy(state["last_card"]),
            "status": state["status"],
            "is_host": client_id == room["host_id"],
        }
        return base

    state = room["state"]
    public_players = []
    private_hand = []
    for player in state["players"]:
        public_player = {
            "id": player["id"],
            "client_id": player["client_id"],
            "name": player["name"],
            "avatar": player["avatar"],
            "completed_questions": player["completed_questions"],
            "ready_for_next": player["ready_for_next"],
            "hand_count": len(player["hand"]),
            "is_bus_rider": player["is_bus_rider"],
            "bus_done": player["bus_done"],
            "bus_total_sips": player["bus_total_sips"],
        }
        public_players.append(public_player)
        if player["client_id"] == client_id:
            private_hand = deepcopy(player["hand"])

    pyramid = []
    for index, slot in enumerate(state["pyramid"]):
        public_slot = {
            "placed_count": len(slot["placed_by"]),
            "revealed": index < state["pyramid_index"],
            "card": deepcopy(slot["card"]) if index < state["pyramid_index"] else None,
        }
        pyramid.append(public_slot)

    bus_state = deepcopy(state["bus_state"])
    base["state"] = {
        "phase": state["phase"],
        "players": public_players,
        "private_hand": private_hand,
        "deck_count": len(state["deck"]),
        "deck_setting": state["deck_count"],
        "recommended_decks": state["recommended_decks"],
        "status": state["status"],
        "pyramid": pyramid,
        "pyramid_index": state["pyramid_index"],
        "last_revealed_index": state["last_revealed_index"],
        "bus_queue": deepcopy(state["bus_queue"]),
        "active_bus_index": state["active_bus_index"],
        "bus_state": bus_state,
        "refill_choice_needed": state["refill_choice_needed"],
        "is_host": client_id == room["host_id"],
        "my_player": deepcopy(next((player for player in public_players if player["client_id"] == client_id), None)),
        "notifications": deepcopy(next((player.get("notifications", []) for player in state["players"] if player["client_id"] == client_id), [])),
    }
    return base


def advance_kings_player(state):
    if not state["players"]:
        state["current_player_index"] = None
        return
    if state["current_player_index"] is None:
        state["current_player_index"] = 0
        return
    state["current_player_index"] = (state["current_player_index"] + 1) % len(state["players"])


def action_create_room(payload):
    game = payload.get("game")
    client_id = payload.get("client_id")
    if not client_id:
      raise ValueError("Hiányzik a kliens azonosító.")
    room = create_room(game, client_id)
    return {"room": sanitize_room(room, client_id)}


def action_join_room(payload):
    room = ensure_room_exists(payload.get("room"))
    client_id = payload.get("client_id")
    room["watchers"][client_id] = {"id": client_id, "joined_at": now_ts()}

    if room["game"] == "bus":
        add_or_update_bus_player(room, client_id, payload.get("name"), payload.get("avatar"))
    touch(room)
    return {"room": sanitize_room(room, client_id)}


def action_update_bus_profile(payload):
    room = ensure_room_exists(payload.get("room"))
    client_id = payload.get("client_id")
    if room["game"] != "bus":
        raise ValueError("Ez nem buszos szoba.")
    add_or_update_bus_player(room, client_id, payload.get("name"), payload.get("avatar"))
    touch(room)
    return {"room": sanitize_room(room, client_id)}


def action_set_bus_decks(payload):
    room = ensure_room_exists(payload.get("room"))
    if room["game"] != "bus":
        raise ValueError("Ez nem buszos szoba.")
    state = room["state"]
    deck_count = max(1, min(8, int(payload.get("deck_count", 1))))
    state["deck_count"] = deck_count
    touch(room)
    return {"room": sanitize_room(room, payload.get("client_id"))}


def action_start_bus(payload):
    room = ensure_room_exists(payload.get("room"))
    if room["game"] != "bus":
        raise ValueError("Ez nem buszos szoba.")

    state = room["state"]
    if len(state["players"]) < 2:
        raise ValueError("Legalább két játékos kell a buszozáshoz.")

    state["phase"] = "questions"
    state["deck"] = make_deck(state["deck_count"])
    state["discard"] = []
    state["pyramid"] = []
    state["pyramid_index"] = 0
    state["last_revealed_index"] = -1
    state["bus_queue"] = []
    state["active_bus_index"] = 0
    state["bus_state"] = None
    state["refill_choice_needed"] = False
    state["status"] = "Megy az első 5 kérdés."

    for player in state["players"]:
        player["hand"] = []
        player["question_index"] = 0
        player["completed_questions"] = False
        player["ready_for_next"] = False
        player["is_bus_rider"] = False
        player["bus_done"] = False
        player["bus_total_sips"] = 0

    touch(room)
    return {"room": sanitize_room(room, payload.get("client_id"))}


def maybe_prepare_pyramid(room):
    state = room["state"]
    if not all(player["completed_questions"] for player in state["players"]):
        return
    if len(state["deck"]) < 15:
        state["phase"] = "pyramid_refill"
        state["refill_choice_needed"] = True
        state["status"] = "Nincs elég lap a piramishoz. Válasszatok utántöltést."
        return

    state["phase"] = "pyramid"
    state["refill_choice_needed"] = False
    state["pyramid"] = [{"card": state["deck"].pop(), "placed_by": []} for _ in range(15)]
    state["pyramid_index"] = 0
    state["last_revealed_index"] = -1
    state["status"] = "Mindenki végzett az első 5 kérdéssel. Jöhet a piramis."


def action_choose_pyramid_refill(payload):
    room = ensure_room_exists(payload.get("room"))
    if room["game"] != "bus":
        raise ValueError("Ez nem buszos szoba.")
    state = room["state"]
    if not state["refill_choice_needed"]:
        raise ValueError("Most nincs szükség utántöltésre.")

    mode = payload.get("mode")
    if mode not in {"full", "random"}:
        raise ValueError("Érvénytelen utántöltési mód.")

    fresh = make_deck(1)
    needed = max(0, 15 - len(state["deck"]))
    if mode == "full":
        state["deck"] = shuffle(state["deck"] + fresh)
    else:
        state["deck"] = shuffle(state["deck"] + fresh[:needed])

    maybe_prepare_pyramid(room)
    touch(room)
    return {"room": sanitize_room(room, payload.get("client_id"))}


def evaluate_question(player, step, card, guess):
    if step == 0:
        correct = guess == card["color"]
        return correct, "Eltaláltad, megúsztad." if correct else "Nem találtad el, iszol."
    if step == 1:
        first = player["hand"][0]
        correct = (guess == "higher" and card["value"] > first["value"]) or (guess == "lower" and card["value"] < first["value"])
        return correct, "Jó tipp volt." if correct else "Rossz tipp, jön az ivás."
    if step == 2:
        a = player["hand"][0]["value"]
        b = player["hand"][1]["value"]
        low = min(a, b)
        high = max(a, b)
        inside = a != b and low < card["value"] < high
        correct = guess == ("inside" if inside else "outside")
        return correct, "Bent volt a jó válasz." if correct else "Ez most nem jött be, iszol."
    if step == 3:
        correct = guess == card["suit"]
        return correct, "Eltaláltad a színt. Ossz ki 4 kortyot." if correct else "Nem találtad el, igyál egy kortyot."
    correct = guess.get("rank") == card["rank"] and guess.get("suit") == card["suit"]
    return correct, "Telitalálat. Ossz ki 5 kortyot." if correct else "Nem lett pontos. Igyál 5 kortyot."

def evaluate_question_v2(player, step, card, guess):
    if step == 0:
        correct = guess == card["color"]
        return correct, "Eltaláltad, megúsztad." if correct else "Nem találtad el, iszol.", 0
    if step == 1:
        first = player["hand"][0]
        correct = (guess == "higher" and card["value"] > first["value"]) or (guess == "lower" and card["value"] < first["value"])
        return correct, "Jó tipp volt." if correct else "Rossz tipp, jön az ivás.", 0
    if step == 2:
        a = player["hand"][0]["value"]
        b = player["hand"][1]["value"]
        low = min(a, b)
        high = max(a, b)
        inside = a != b and low < card["value"] < high
        correct = guess == ("inside" if inside else "outside")
        return correct, "Bent volt a jó válasz." if correct else "Ez most nem jött be, iszol.", 0
    if step == 3:
        correct = guess == card["suit"]
        return correct, "Eltaláltad a színt. Ossz ki 4 kortyot." if correct else "Nem találtad el, igyál egy kortyot.", 4 if correct else 0
    correct = guess.get("rank") == card["rank"] and guess.get("suit") == card["suit"]
    return correct, "Telitalálat. Ossz ki 5 kortyot." if correct else "Nem lett pontos. Igyál 5 kortyot.", 5 if correct else 0


def pyramid_sip_value(index):
    if index < 5:
        return 1
    if index < 9:
        return 2
    if index < 12:
        return 3
    if index < 14:
        return 4
    return 5


def action_bus_answer_question(payload):
    room = ensure_room_exists(payload.get("room"))
    if room["game"] != "bus":
        raise ValueError("Ez nem buszos szoba.")
    state = room["state"]
    if state["phase"] != "questions":
        raise ValueError("A kérdéskör most nem aktív.")

    player = get_bus_player(room, payload.get("client_id"))
    if not player:
        raise ValueError("Nem vagy a szoba játékosa.")
    if player["completed_questions"]:
        raise ValueError("Ezzel a játékossal már megvagy az első 5 kérdéssel.")

    step = player["question_index"]
    card = state["deck"].pop()
    if step == 1:
        while player["hand"] and card["value"] == player["hand"][0]["value"] and state["deck"]:
            state["deck"].insert(0, card)
            random.shuffle(state["deck"])
            card = state["deck"].pop()

    player["hand"].append(card)
    guess = payload.get("guess")
    correct, message, award_sips = evaluate_question_v2(player, step, card, guess)
    player["question_index"] += 1
    if player["question_index"] >= 5:
        player["completed_questions"] = True

    state["status"] = f"{player['name']} húzott egy {card['rank']}{card['suit']} lapot."
    maybe_prepare_pyramid(room)
    touch(room)
    return {
        "room": sanitize_room(room, payload.get("client_id")),
        "result": {
            "card": card,
            "correct": correct,
            "message": message,
            "award_sips": award_sips,
        },
    }


def action_bus_claim_match(payload):
    room = ensure_room_exists(payload.get("room"))
    state = room["state"]
    if room["game"] != "bus" or state["phase"] != "pyramid":
        raise ValueError("Most nem lehet piramislapra rakni.")
    if state["last_revealed_index"] < 0:
        raise ValueError("Még nincs felfordított piramislap.")

    player = get_bus_player(room, payload.get("client_id"))
    if not player:
        raise ValueError("Nem vagy a szoba játékosa.")

    hand_card_id = payload.get("hand_card_id")
    hand_index = next((idx for idx, card in enumerate(player["hand"]) if card["id"] == hand_card_id), -1)
    if hand_index < 0:
        raise ValueError("Ez a lap nincs a kezedben.")

    target_slot = state["pyramid"][state["last_revealed_index"]]
    hand_card = player["hand"][hand_index]
    if hand_card["rank"] != target_slot["card"]["rank"]:
        raise ValueError("Ez a lap most nem rakható rá.")

    player["hand"].pop(hand_index)
    target_slot["placed_by"].append(player["id"])
    award_sips = pyramid_sip_value(state["last_revealed_index"])
    state["status"] = f"{player['name']} rátett egy {hand_card['rank']}{hand_card['suit']} lapot a piramisra."
    touch(room)
    return {
        "room": sanitize_room(room, payload.get("client_id")),
        "result": {
            "award_sips": award_sips,
            "message": f"Rátetted a lapot. Ossz ki {award_sips} kortyot.",
        },
    }


def action_bus_ready_next(payload):
    room = ensure_room_exists(payload.get("room"))
    state = room["state"]
    if room["game"] != "bus" or state["phase"] != "pyramid":
        raise ValueError("Most nincs köztes jóváhagyás.")
    player = get_bus_player(room, payload.get("client_id"))
    if not player:
        raise ValueError("Nem vagy a szoba játékosa.")
    player["ready_for_next"] = True
    touch(room)
    return {"room": sanitize_room(room, payload.get("client_id"))}


def action_bus_reveal_pyramid(payload):
    room = ensure_room_exists(payload.get("room"))
    state = room["state"]
    if room["game"] != "bus" or state["phase"] != "pyramid":
        raise ValueError("Most nem lehet piramislapot fordítani.")
    if payload.get("client_id") != room["host_id"]:
        raise ValueError("A következő piramislapot csak a szoba létrehozója fordíthatja fel.")

    if state["last_revealed_index"] >= 0 and state["last_revealed_index"] < 14:
        if not all(player["ready_for_next"] for player in state["players"]):
            raise ValueError("Mindenkinek jóvá kell hagynia a következő lapot.")

    if state["pyramid_index"] >= len(state["pyramid"]):
        max_hand = max((len(player["hand"]) for player in state["players"]), default=0)
        riders = [player["id"] for player in state["players"] if len(player["hand"]) == max_hand and max_hand > 0]
        state["bus_queue"] = riders
        for player in state["players"]:
            player["is_bus_rider"] = player["id"] in riders
            player["ready_for_next"] = False
        if not riders:
            state["phase"] = "finished"
            state["status"] = "Senki nem buszozik, elfogytak a lapok."
        else:
            state["phase"] = "bus"
            state["active_bus_index"] = 0
            prepare_next_bus_rider(room)
        touch(room)
        return {"room": sanitize_room(room, payload.get("client_id"))}

    slot = state["pyramid"][state["pyramid_index"]]
    state["last_revealed_index"] = state["pyramid_index"]
    state["pyramid_index"] += 1
    for player in state["players"]:
        player["ready_for_next"] = False
    state["status"] = f"Felfordítva: {slot['card']['rank']}{slot['card']['suit']}."
    touch(room)
    return {"room": sanitize_room(room, payload.get("client_id"))}


def prepare_next_bus_rider(room):
    state = room["state"]
    if state["active_bus_index"] >= len(state["bus_queue"]):
        state["phase"] = "finished"
        state["bus_state"] = None
        state["status"] = "Minden buszozó végzett."
        return

    rider_id = state["bus_queue"][state["active_bus_index"]]
    rider = next(player for player in state["players"] if player["id"] == rider_id)
    ensure_cards_for_bus(room, 2)
    state["bus_state"] = {
        "rider_id": rider_id,
        "rider_name": rider["name"],
        "previous_card": None,
        "current_card": state["deck"].pop(),
        "round": 0,
        "streak": 0,
        "last_penalty": 0,
        "observer_votes": {},
        "last_message": f"{rider['name']} buszozik. Az első lap fel van fordítva.",
    }
    state["status"] = f"{rider['name']} buszozik."


def ensure_cards_for_bus(room, count):
    state = room["state"]
    if len(state["deck"]) >= count:
        return
    state["deck"] = shuffle(state["deck"] + make_deck(max(1, state["deck_count"])))


def get_bus_rider_player(room):
    state = room["state"]
    if not state["bus_state"]:
        return None
    rider_id = state["bus_state"]["rider_id"]
    return next((player for player in state["players"] if player["id"] == rider_id), None)


def action_bus_vote(payload):
    room = ensure_room_exists(payload.get("room"))
    state = room["state"]
    if room["game"] != "bus" or state["phase"] != "bus" or not state["bus_state"]:
        raise ValueError("Most nincs aktív buszszavazás.")
    player = get_bus_player(room, payload.get("client_id"))
    if not player:
        raise ValueError("Nem vagy a szoba játékosa.")
    if player["id"] == state["bus_state"]["rider_id"]:
        raise ValueError("A buszozó nem szavazhat.")
    vote = payload.get("vote")
    if vote not in {"higher", "lower"}:
        raise ValueError("Érvénytelen szavazat.")
    state["bus_state"]["observer_votes"][player["id"]] = vote
    touch(room)
    return {"room": sanitize_room(room, payload.get("client_id"))}


def action_bus_guess(payload):
    room = ensure_room_exists(payload.get("room"))
    state = room["state"]
    if room["game"] != "bus" or state["phase"] != "bus" or not state["bus_state"]:
        raise ValueError("Most nincs aktív buszozás.")
    rider = get_bus_rider_player(room)
    if not rider or rider["client_id"] != payload.get("client_id"):
        raise ValueError("Most nem te buszozol.")

    guess = payload.get("guess")
    if guess not in {"higher", "lower", "same"}:
        raise ValueError("Érvénytelen tipp.")

    ensure_cards_for_bus(room, 1)
    bus_state = state["bus_state"]
    previous = bus_state["current_card"]
    current = state["deck"].pop()
    bus_state["previous_card"] = previous
    bus_state["current_card"] = current
    current_round = bus_state["round"] + 1

    if guess == "higher":
        success = current["value"] > previous["value"]
    elif guess == "lower":
        success = current["value"] < previous["value"]
    else:
        success = current["value"] == previous["value"]

    if success:
        bus_state["round"] = current_round
        bus_state["streak"] += 1
        bus_state["last_penalty"] = 0
        bus_state["last_message"] = f"Helyes tipp: {previous['rank']}{previous['suit']} → {current['rank']}{current['suit']}."
        if bus_state["streak"] >= 5:
            rider["bus_done"] = True
            bus_state["last_message"] = f"{rider['name']} megnyerte a buszozást."
            state["active_bus_index"] += 1
            prepare_next_bus_rider(room)
    else:
        penalty = 5 if guess == "same" else min(current_round, 5)
        rider["bus_total_sips"] += penalty
        bus_state["round"] = 0
        bus_state["streak"] = 0
        bus_state["last_penalty"] = penalty
        bus_state["last_message"] = f"Rossz tipp. {rider['name']} {penalty} kortyot iszik."

    if state["bus_state"]:
      state["bus_state"]["observer_votes"] = {}
    touch(room)
    return {"room": sanitize_room(room, payload.get("client_id"))}


def action_bus_distribute_sips(payload):
    room = ensure_room_exists(payload.get("room"))
    state = room["state"]
    if room["game"] != "bus":
        raise ValueError("Ez nem buszos szoba.")

    giver = get_bus_player(room, payload.get("client_id"))
    if not giver:
        raise ValueError("Nem vagy a szoba játékosa.")

    total = int(payload.get("total") or 0)
    allocations = payload.get("allocations") or []
    if total <= 0:
        raise ValueError("Nincs kiosztható korty.")

    assigned = 0
    notified_names = []
    for allocation in allocations:
        player_id = allocation.get("player_id")
        sips = int(allocation.get("sips") or 0)
        if sips <= 0:
            continue
        target = next((player for player in state["players"] if player["id"] == player_id), None)
        if not target:
            raise ValueError("Az egyik kiválasztott játékos nem található.")
        if target["id"] == giver["id"]:
            raise ValueError("Magadnak nem oszthatsz kortyot.")
        assigned += sips
        notified_names.append(f"{target['name']} ({sips})")
        push_notification(
            target,
            "Kortyot kaptál",
            f"{giver['name']} {sips} kortyot osztott neked.",
        )

    if assigned != total:
        raise ValueError(f"Pontosan {total} kortyot kell kiosztanod.")

    state["status"] = f"{giver['name']} kiosztotta a kortyokat: {', '.join(notified_names)}."
    touch(room)
    return {"room": sanitize_room(room, payload.get("client_id"))}


def action_bus_ack_notification(payload):
    room = ensure_room_exists(payload.get("room"))
    state = room["state"]
    if room["game"] != "bus":
        raise ValueError("Ez nem buszos szoba.")
    player = get_bus_player(room, payload.get("client_id"))
    if not player:
        raise ValueError("Nem vagy a szoba játékosa.")
    notification_id = payload.get("notification_id")
    player["notifications"] = [
        notification for notification in player.get("notifications", [])
        if notification["id"] != notification_id
    ]
    touch(room)
    return {"room": sanitize_room(room, payload.get("client_id"))}


def action_kings_add_player(payload):
    room = ensure_room_exists(payload.get("room"))
    if room["game"] != "kings":
        raise ValueError("Ez nem Kings Cup szoba.")
    state = room["state"]
    state["players"].append({"id": make_id("kp"), "name": payload.get("name") or "Játékos"})
    state["status"] = "Játékos hozzáadva."
    touch(room)
    return {"room": sanitize_room(room, payload.get("client_id"))}


def action_kings_update_player(payload):
    room = ensure_room_exists(payload.get("room"))
    state = room["state"]
    player_id = payload.get("player_id")
    player = next((item for item in state["players"] if item["id"] == player_id), None)
    if not player:
        raise ValueError("A játékos nem található.")
    player["name"] = payload.get("name") or player["name"]
    touch(room)
    return {"room": sanitize_room(room, payload.get("client_id"))}


def action_kings_remove_player(payload):
    room = ensure_room_exists(payload.get("room"))
    state = room["state"]
    player_id = payload.get("player_id")
    state["players"] = [item for item in state["players"] if item["id"] != player_id]
    if state["current_player_index"] is not None and state["players"]:
        state["current_player_index"] %= len(state["players"])
    elif not state["players"]:
        state["current_player_index"] = None
    touch(room)
    return {"room": sanitize_room(room, payload.get("client_id"))}


def action_kings_start(payload):
    room = ensure_room_exists(payload.get("room"))
    state = room["state"]
    if len(state["players"]) < 2:
        raise ValueError("Legalább két játékos kell a Kings Cuphoz.")
    state["deck"] = make_deck(1)
    state["discard"] = []
    state["started"] = True
    state["phase"] = "active"
    state["current_player_index"] = random.randrange(len(state["players"]))
    current_name = state["players"][state["current_player_index"]]["name"]
    state["status"] = f"A kezdő játékos: {current_name}."
    state["last_card"] = None
    touch(room)
    return {"room": sanitize_room(room, payload.get("client_id"))}


def action_kings_draw(payload):
    room = ensure_room_exists(payload.get("room"))
    state = room["state"]
    if not state["started"]:
        raise ValueError("A játék még nem indult el.")
    if not state["deck"]:
        state["deck"] = make_deck(1)

    current_player = state["players"][state["current_player_index"]]
    card = state["deck"].pop()
    rule = KINGS_RULES[card["rank"]]
    state["last_card"] = {"card": card, "rule": rule, "player_name": current_player["name"]}
    state["status"] = f"{current_player['name']} húzott egy {card['rank']}{card['suit']} lapot."
    advance_kings_player(state)
    touch(room)
    return {"room": sanitize_room(room, payload.get("client_id"))}


def action_kings_skip(payload):
    room = ensure_room_exists(payload.get("room"))
    state = room["state"]
    if not state["started"]:
        raise ValueError("A játék még nem indult el.")
    skipped = state["players"][state["current_player_index"]]["name"]
    advance_kings_player(state)
    next_name = state["players"][state["current_player_index"]]["name"] if state["players"] else "-"
    state["status"] = f"{skipped} köre át lett ugorva. Következik: {next_name}."
    touch(room)
    return {"room": sanitize_room(room, payload.get("client_id"))}


ACTIONS = {
    "create_room": action_create_room,
    "join_room": action_join_room,
    "update_bus_profile": action_update_bus_profile,
    "set_bus_decks": action_set_bus_decks,
    "start_bus": action_start_bus,
    "choose_pyramid_refill": action_choose_pyramid_refill,
    "bus_answer_question": action_bus_answer_question,
    "bus_distribute_sips": action_bus_distribute_sips,
    "bus_ack_notification": action_bus_ack_notification,
    "bus_claim_match": action_bus_claim_match,
    "bus_ready_next": action_bus_ready_next,
    "bus_reveal_pyramid": action_bus_reveal_pyramid,
    "bus_vote": action_bus_vote,
    "bus_guess": action_bus_guess,
    "kings_add_player": action_kings_add_player,
    "kings_update_player": action_kings_update_player,
    "kings_remove_player": action_kings_remove_player,
    "kings_start": action_kings_start,
    "kings_draw": action_kings_draw,
    "kings_skip": action_kings_skip,
}


class AppHandler(SimpleHTTPRequestHandler):
    def translate_path(self, path):
        parsed = urlparse(path)
        cleaned = parsed.path.lstrip("/") or "index.html"
        resolved = (ROOT / cleaned).resolve()
        # Prevent path traversal: reject anything outside the app root
        try:
            resolved.relative_to(ROOT)
        except ValueError:
            return str(ROOT / "index.html")
        return str(resolved)

    def do_GET(self):
        parsed = urlparse(self.path)
        if parsed.path == "/api/state":
            self.handle_state(parsed)
            return
        super().do_GET()

    def do_POST(self):
        parsed = urlparse(self.path)
        if parsed.path != "/api/action":
            self.send_error(404, "Ismeretlen API végpont.")
            return

        length = int(self.headers.get("Content-Length", "0"))
        data = json.loads(self.rfile.read(length) or b"{}")
        action = data.get("action")
        handler = ACTIONS.get(action)
        if not handler:
            self.send_json({"error": "Ismeretlen művelet."}, status=400)
            return

        try:
            with ROOM_LOCK:
                payload = data.get("payload") or {}
                response = handler(payload)
        except ValueError as exc:
            self.send_json({"error": str(exc)}, status=400)
            return
        except Exception as exc:
            logging.exception("Unhandled error in action handler")
            self.send_json({"error": "Belső szerverhiba történt."}, status=500)
            return

        self.send_json(response)

    def handle_state(self, parsed):
        params = parse_qs(parsed.query)
        room_code = (params.get("room") or [""])[0]
        client_id = (params.get("client_id") or [""])[0]
        if not room_code or not client_id:
            self.send_json({"error": "Hiányzó room vagy client_id."}, status=400)
            return

        try:
            with ROOM_LOCK:
                room = ensure_room_exists(room_code)
                room["watchers"][client_id] = {"id": client_id, "joined_at": now_ts()}
                response = {"room": sanitize_room(room, client_id)}
        except ValueError as exc:
            self.send_json({"error": str(exc)}, status=404)
            return

        self.send_json(response)

    def send_json(self, payload, status=200):
        encoded = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(encoded)))
        self.end_headers()
        self.wfile.write(encoded)


def _cleanup_old_rooms():
    """Background thread: delete rooms not updated in the last ROOM_MAX_AGE_SECONDS."""
    while True:
        time.sleep(60 * 30)  # run every 30 minutes
        cutoff = int(time.time()) - ROOM_MAX_AGE_SECONDS
        with ROOM_LOCK:
            stale = [code for code, room in ROOMS.items() if room.get("updated_at", 0) < cutoff]
            for code in stale:
                del ROOMS[code]
            if stale:
                logging.info("Cleaned up %d stale room(s): %s", len(stale), stale)


if __name__ == "__main__":
    cleaner = threading.Thread(target=_cleanup_old_rooms, daemon=True)
    cleaner.start()
    server = ThreadingHTTPServer((HOST, PORT), AppHandler)
    logging.info("Multiplayer szerver fut: http://0.0.0.0:%d", PORT)
    server.serve_forever()

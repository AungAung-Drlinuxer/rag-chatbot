"""Persisted connector scope — validation on write, forgiveness on read.

WHY VALIDATION IS THE POINT: a stored scope becomes the tool list for every later turn. Store
one bogus name and `build_tools()` returns nothing, so every question in that conversation
answers "no tools matched" — a symptom three screens away from the typo, in a conversation the
user cannot fix by asking differently. So the name is checked against the LIVE server list
BEFORE it is written, not when it is used.

And the read side is deliberately forgiving in the opposite direction: anything unreadable
decodes to `[]` = unscoped = every server. A corrupt row must widen a conversation back to the
default, never narrow it to nothing.
"""
import json

import app.mcp.infra_agent as ia
from app.api.conversations import _decode_scope


def test_an_empty_or_missing_scope_stores_nothing():
    # [] means unscoped. Storing "[]" would be indistinguishable from "restricted to no
    # connectors" to anyone reading the column later.
    assert ia.validate_scope([]) == []
    assert ia.validate_scope(None) == []
    assert ia.validate_scope([None, "", "   "]) == []
    assert ia.validate_scope("grafana") == []      # a bare string is not a list of names


def test_names_are_lowercased_and_deduplicated():
    assert ia.validate_scope(["GRAFANA", "grafana ", "Grafana"]) == ["grafana"]


def test_an_unknown_name_is_DROPPED_not_stored():
    # The failure this prevents: a scope that matches no enabled server, i.e. an empty tool
    # list and "no tools matched" for every question in the conversation.
    assert ia.validate_scope(["bogus"]) == []
    assert ia.validate_scope(["bogus", "grafana"]) == ["grafana"]
    assert ia.validate_scope(["kubeconfig:local", "rancher"]) == ["rancher"]


def test_stored_order_follows_the_configuration_not_the_request():
    known = [s["name"] for s in ia.enabled_servers()]
    if len(known) < 2:
        return                                     # nothing to order; nothing to assert
    reversed_req = list(reversed(known))
    assert ia.validate_scope(reversed_req) == known


def test_every_validated_name_is_an_enabled_server():
    # The invariant that makes validate_scope safe to call on untrusted input.
    known = {s["name"] for s in ia.enabled_servers()}
    for candidate in ("grafana", "rancher", "proxmox", "postgres", "nope", "GRAFANA"):
        for name in ia.validate_scope([candidate]):
            assert name in known, f"{name} survived validation but is not enabled"


# ------------------------------------------------------------------ the read side


def test_a_null_column_reads_as_unscoped():
    assert _decode_scope(None) == []
    assert _decode_scope("") == []


def test_corrupt_json_reads_as_unscoped_not_as_a_lockdown():
    # Deliberately the safe direction: widen, never narrow.
    assert _decode_scope("not json") == []
    assert _decode_scope('{"grafana": true}') == []     # an object is not a list of names
    assert _decode_scope("[]") == []


def test_a_stored_array_round_trips():
    stored = json.dumps(["grafana", "proxmox"])
    assert _decode_scope(stored) == ["grafana", "proxmox"]


def test_blank_entries_are_stripped_on_read():
    assert _decode_scope(json.dumps(["grafana", "", "  "])) == ["grafana"]

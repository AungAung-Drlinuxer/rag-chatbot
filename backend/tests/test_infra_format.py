"""Unit tests for the infrastructure answer formatters.

WHY THESE EXIST: `_fmt_pair` shipped a bug that rendered EVERY memory figure as
`0.0 / 0.0 GB` — it scaled the values inside its unit loop and then divided by the unit
exponent again. Nothing raised, the table was well formed, and the column was simply full
of zeroes; it was caught by reading live output, not by any test. A formatter is pure
arithmetic on known inputs, so it is the cheapest possible thing to pin down.
"""
import pytest

from app.mcp.infra_agent import _fmt_bytes, _fmt_pair, _md_table, summarise_proxmox


@pytest.mark.parametrize(
    "used,total,expected",
    [
        (16546213888, 17179869184, "15.4 / 16.0 GB"),      # a 16 GB VM, 15.4 used
        (66129920, 536870912, "63.1 / 512.0 MB"),          # an LXC container
        (0, 4294967296, "0.0 / 4.0 GB"),                   # a stopped guest
        (196981268480, 270337454080, "183.5 / 251.8 GB"),  # the pve01 node itself
        (48 * 1024 * 1024, 512 * 1024 * 1024, "48.0 / 512.0 MB"),
        (512, 900, "512 / 900 B"),                         # genuinely sub-KB stays in bytes
    ],
)
def test_fmt_pair_never_collapses_to_zero(used, total, expected):
    """The regression: any pair must show the numbers, never `0.0 / 0.0`."""
    got = _fmt_pair(used, total)
    assert got == expected
    if used and total:
        assert got != "0.0 / 0.0 GB"


@pytest.mark.parametrize(
    "value,expected",
    [(1024, "1.0 KB"), (1048576, "1.0 MB"), (17179869184, "16.0 GB"), (0, "0 B")],
)
def test_fmt_bytes(value, expected):
    assert _fmt_bytes(value) == expected


def test_fmt_pair_survives_missing_values():
    """A payload without mem/maxmem must not raise — it renders as unknown."""
    assert _fmt_pair(None, None) == "? / ?"


def test_md_table_header_and_rows():
    table = _md_table(["A", "B"], [["1", "2"], ["3", "4"]])
    assert table.splitlines() == ["| A | B |", "|---|---|", "| 1 | 2 |", "| 3 | 4 |"]


@pytest.fixture
def vms_payload():
    # The shape proxmox_list_vms actually returns, trimmed to two guests.
    return """
    {
      "count": 2,
      "vms": [
        {"vmid": 100, "name": "drlinuxer-prod-worker-7nc7k-kpd7b", "node": "pve01",
         "status": "running", "cpu": 0.09, "mem": 16546213888, "maxmem": 17179869184,
         "uptime": 464400, "template": 0, "type": "qemu"},
        {"vmid": 9301, "name": "k8s-worker", "node": "pve01",
         "status": "stopped", "cpu": 0, "mem": 0, "maxmem": 0,
         "uptime": 0, "template": 1, "type": "qemu"}
      ]
    }
    """


def test_summarise_proxmox_guest_table(vms_payload):
    out = summarise_proxmox(vms_payload)
    assert out is not None
    assert "**2 VMs**" in out
    header = out.splitlines()[2]
    # Node and Kind are dropped because they carry no information here: one node, one kind.
    # Six columns fit a 735px bubble; eight pushed Uptime off the edge.
    assert header == "| VMID | Name | Status | CPU | Memory | Uptime |"
    # The memory pair must carry real numbers, and only ONE unit.
    assert "15.4 / 16.0 GB" in out
    assert "GB / " not in out, "the unit must appear once per cell, not twice"
    # A template is marked so it is not mistaken for a running guest.
    assert "k8s-worker (template)" in out
    # Two guests => two rows below the separator.
    assert len([ln for ln in out.splitlines() if ln.startswith("| 100 ")]) == 1
    assert len([ln for ln in out.splitlines() if ln.startswith("| 9301 ")]) == 1


def test_summarise_proxmox_returns_none_for_a_non_proxmox_payload():
    """A Kubernetes object must fall through to the other summariser, not mis-render."""
    assert summarise_proxmox('{"kind":"Node","metadata":{"name":"pve01"}}') is None
    assert summarise_proxmox("not json at all") is None


def test_guest_node_column_appears_only_when_it_distinguishes_rows():
    """A multi-node cluster must keep the Node column — then it says something."""
    payload = """
    {"count": 2, "vms": [
      {"vmid": 1, "name": "a", "node": "pve01", "status": "running", "cpu": 0,
       "mem": 0, "maxmem": 0, "uptime": 0, "template": 0},
      {"vmid": 2, "name": "b", "node": "pve02", "status": "running", "cpu": 0,
       "mem": 0, "maxmem": 0, "uptime": 0, "template": 0}
    ]}
    """
    out = summarise_proxmox(payload)
    assert out is not None
    assert out.splitlines()[2] == "| VMID | Name | Node | Status | CPU | Memory | Uptime |"
    assert "| 2 | b | pve02 |" in out


def test_container_payload_says_container_not_guest():
    payload = """
    {"count": 1, "containers": [
      {"vmid": 102, "name": "cloudflared", "node": "pve01", "status": "running",
       "cpu": 0.003, "mem": 49356800, "maxmem": 536870912, "uptime": 100, "template": 0}
    ]}
    """
    out = summarise_proxmox(payload)
    assert out is not None
    assert "**1 container**" in out, "singular, and named for what it is"
    assert "0.3%" in out

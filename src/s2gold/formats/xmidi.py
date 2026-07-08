"""XMIDI (XMI/XMID) to Standard MIDI File (SMF) converter.

Clean-room implementation from the public XMI specifications (vgmpf.com XMI page and the
AIL XMIDI format notes linked in docs/format-notes/LINKS.md). No GPL reference code is
used or transliterated.

Container layout (IFF, big-endian chunk lengths, chunks padded to even sizes)::

    FORM <len> XDIR
        INFO <len=2> <u16 sequence count>
    CAT  <len> XMID
        FORM <len> XMID
            TIMB <len> <timbre table>        (patch/bank preload; not needed for SMF)
            [RBRN <len> ...]                 (branch points; ignored)
            EVNT <len> <event stream>
        [FORM <len> XMID ...]                (additional sequences)

Event stream quirks handled here:

* Delta times are encoded as a run of bytes each in ``0x00..0x7F`` that are *summed*
  (not the MIDI variable-length quantity used elsewhere in the stream). A run may be
  empty, in which case the event happens at the current tick.
* Note-on events (``0x9n``) carry an inline MIDI variable-length ``duration`` after the
  velocity byte instead of a paired note-off. We synthesize a note-off event
  ``duration`` ticks later and merge it into the output stream at the right position.
* Meta (``0xFF``) and sysex (``0xF0``/``0xF7``) events use a MIDI variable-length
  length field. Controller / program / pitch / aftertouch events pass through verbatim.

Timing decision (documented, from the vgmpf XMI spec):
    XMI sequences play at a fixed AIL clock of 120 Hz, and any tempo meta events found in
    the stream are vestigial leftovers of the original pre-conversion MIDI file and must
    be ignored. The delta values already encode real timing at 120 ticks per second. We
    therefore emit a single format-0 track with PPQN = 60 and one initial tempo of
    500000 us/quarter (120 BPM), which yields exactly 500000 / 60 = 8333.3 us per tick =
    120 ticks per second. (The equivalent PPQN=120 / 1000000 us pairing is identical.)
"""

from __future__ import annotations

# PPQN (ticks per quarter note) and initial tempo chosen so that one XMI tick equals
# 1/120 s, matching the fixed 120 Hz AIL playback clock.
SMF_PPQN = 60
SMF_TEMPO_US_PER_QUARTER = 500_000  # 120 BPM


def _iter_chunks(buf: bytes, start: int, end: int):  # type: ignore[no-untyped-def]
    """Yield ``(chunk_id, body_start, body_len)`` for each IFF chunk in ``buf[start:end]``.

    Args:
        buf: The full container buffer.
        start: Offset of the first chunk header.
        end: Exclusive offset bounding the chunk region.

    Yields:
        Tuples of the 4-byte chunk id, the offset of the chunk body, and its length
        (excluding the even-padding byte).
    """
    pos = start
    while pos + 8 <= end:
        cid = buf[pos : pos + 4]
        clen = int.from_bytes(buf[pos + 4 : pos + 8], "big")
        body_start = pos + 8
        yield cid, body_start, clen
        pos = body_start + clen + (clen & 1)


def _find_xmid_forms(buf: bytes) -> list[tuple[int, int]]:
    """Locate every ``FORM XMID`` sub-form and return its body ``(start, end)`` bounds.

    Args:
        buf: The full XMI container buffer.

    Returns:
        A list of ``(body_start, body_end)`` pairs, one per sequence, in file order.
        ``body_start`` points just past the ``XMID`` form-type tag.
    """
    forms: list[tuple[int, int]] = []

    def walk(start: int, end: int) -> None:
        for cid, bstart, clen in _iter_chunks(buf, start, end):
            body_end = bstart + clen
            if cid in (b"FORM", b"CAT ", b"LIST"):
                ftype = buf[bstart : bstart + 4]
                if cid == b"FORM" and ftype == b"XMID":
                    forms.append((bstart + 4, body_end))
                else:
                    walk(bstart + 4, body_end)

    walk(0, len(buf))
    return forms


def _read_varlen(buf: bytes, pos: int) -> tuple[int, int]:
    """Read a MIDI variable-length quantity.

    Args:
        buf: Source buffer.
        pos: Offset of the first byte.

    Returns:
        A ``(value, new_pos)`` tuple.
    """
    value = 0
    while True:
        b = buf[pos]
        pos += 1
        value = (value << 7) | (b & 0x7F)
        if not (b & 0x80):
            return value, pos


def _write_varlen(value: int) -> bytes:
    """Encode an integer as a MIDI variable-length quantity."""
    if value < 0:
        raise ValueError(f"cannot encode negative varlen {value}")
    out = bytearray([value & 0x7F])
    value >>= 7
    while value:
        out.insert(0, (value & 0x7F) | 0x80)
        value >>= 7
    return bytes(out)


# Number of trailing data bytes for each channel-voice status nibble (0x8n..0xEn).
_CHANNEL_EVENT_LEN = {
    0x80: 2,  # note off
    0x90: 2,  # note on (plus an inline varlen duration handled separately)
    0xA0: 2,  # polyphonic aftertouch
    0xB0: 2,  # control change
    0xC0: 1,  # program change
    0xD0: 1,  # channel pressure
    0xE0: 2,  # pitch bend
}


def _parse_events(buf: bytes, start: int, end: int) -> list[tuple[int, int, bytes]]:
    """Parse one XMI ``EVNT`` stream into absolute-timed MIDI events.

    Note-off events are synthesized from note-on durations. Tempo meta events are dropped
    (they are vestigial, see the module docstring).

    Args:
        buf: The full container buffer.
        start: Offset of the first byte of the event stream.
        end: Exclusive offset bounding the event stream.

    Returns:
        A list of ``(abs_tick, sort_rank, event_bytes)`` where ``event_bytes`` is a
        complete MIDI event (status + data) with no delta prefix. ``sort_rank`` orders
        events that share a tick: synthesized note-offs (rank 0) precede other events
        (rank 1) so a re-struck note is not immediately cut.
    """
    events: list[tuple[int, int, bytes]] = []
    pos = start
    abs_tick = 0

    while pos < end:
        b = buf[pos]
        # Accumulate a run of delay bytes (< 0x80).
        if b < 0x80:
            abs_tick += b
            pos += 1
            continue

        status = b
        high = status & 0xF0
        channel = status & 0x0F

        if status == 0xFF:
            meta_type = buf[pos + 1]
            length, data_pos = _read_varlen(buf, pos + 2)
            data = buf[data_pos : data_pos + length]
            pos = data_pos + length
            if meta_type == 0x2F:  # end of track: stop; we emit our own later
                break
            if meta_type == 0x51:  # tempo: vestigial in XMI, drop it
                continue
            events.append((abs_tick, 1, bytes([0xFF, meta_type]) + _write_varlen(length) + data))
            continue

        if status in (0xF0, 0xF7):  # sysex
            length, data_pos = _read_varlen(buf, pos + 1)
            data = buf[data_pos : data_pos + length]
            pos = data_pos + length
            events.append((abs_tick, 1, bytes([status]) + _write_varlen(length) + data))
            continue

        if high == 0x90:  # note on with inline duration
            note = buf[pos + 1]
            velocity = buf[pos + 2]
            duration, pos = _read_varlen(buf, pos + 3)
            events.append((abs_tick, 1, bytes([0x90 | channel, note, velocity])))
            # Synthesize the matching note-off; a zero-velocity note-on works everywhere.
            events.append((abs_tick + duration, 0, bytes([0x90 | channel, note, 0])))
            continue

        nbytes = _CHANNEL_EVENT_LEN.get(high)
        if nbytes is None:
            raise ValueError(f"unexpected XMI status byte {status:#04x} at offset {pos}")
        data = buf[pos + 1 : pos + 1 + nbytes]
        pos += 1 + nbytes
        events.append((abs_tick, 1, bytes([status]) + data))

    return events


def _build_track(events: list[tuple[int, int, bytes]]) -> bytes:
    """Serialize absolute-timed events into an ``MTrk`` chunk body (with delta prefixes).

    A single initial tempo meta event is prepended and an explicit end-of-track meta is
    appended at the final tick.

    Args:
        events: Output of :func:`_parse_events`.

    Returns:
        The raw bytes of the ``MTrk`` chunk including its 8-byte header.
    """
    ordered = sorted(events, key=lambda e: (e[0], e[1]))
    body = bytearray()

    # Initial tempo at tick 0.
    tempo = SMF_TEMPO_US_PER_QUARTER
    body += _write_varlen(0)
    body += bytes([0xFF, 0x51, 0x03]) + tempo.to_bytes(3, "big")

    last_tick = 0
    for abs_tick, _rank, event in ordered:
        body += _write_varlen(abs_tick - last_tick)
        body += event
        last_tick = abs_tick

    # End of track.
    body += _write_varlen(0)
    body += bytes([0xFF, 0x2F, 0x00])

    return b"MTrk" + len(body).to_bytes(4, "big") + bytes(body)


def count_sequences(data: bytes) -> int:
    """Return the number of XMI sequences contained in ``data``."""
    return len(_find_xmid_forms(data))


def xmidi_to_smf(data: bytes, index: int = 0) -> bytes:
    """Convert one XMI sequence to a Standard MIDI File (format 0).

    Args:
        data: The raw XMI container bytes (``FORM XDIR`` + ``CAT XMID``, or a bare
            ``FORM XMID``).
        index: Which sequence to convert when the container holds several (default 0).

    Returns:
        A complete SMF (format 0, single track) as bytes, beginning with ``MThd``.

    Raises:
        ValueError: If the container has no XMI sequence at ``index``.
    """
    forms = _find_xmid_forms(data)
    if not forms:
        raise ValueError("no FORM XMID sequence found in XMI container")
    if index >= len(forms):
        raise ValueError(f"sequence index {index} out of range ({len(forms)} present)")

    start, end = forms[index]
    evnt: tuple[int, int] | None = None
    for cid, bstart, clen in _iter_chunks(data, start, end):
        if cid == b"EVNT":
            evnt = (bstart, bstart + clen)
            break
    if evnt is None:
        raise ValueError("XMI sequence has no EVNT chunk")

    events = _parse_events(data, evnt[0], evnt[1])
    track = _build_track(events)

    header = (
        b"MThd" + (6).to_bytes(4, "big") + (0).to_bytes(2, "big") + (1).to_bytes(2, "big") + SMF_PPQN.to_bytes(2, "big")
    )
    return header + track

def test_palette_cycles_parses_active_crng_ranges():
    """Only CRNG chunks with a non-zero rate are active cycles."""
    from s2gold.formats.palette import palette_cycles

    def chunk(cid: bytes, body: bytes) -> bytes:
        pad = b"\x00" if len(body) % 2 else b""
        return cid + len(body).to_bytes(4, "big") + body + pad

    def crng(rate: int, low: int, high: int) -> bytes:
        return chunk(b"CRNG", b"\x00\x00" + rate.to_bytes(2, "big") + b"\x00\x00" + bytes((low, high)))

    inner = chunk(b"CMAP", bytes(768)) + crng(0, 1, 7) + crng(2148, 240, 247) + crng(1689, 248, 251)
    form = b"FORM" + (len(inner) + 4).to_bytes(4, "big") + b"PBM " + inner

    cycles = palette_cycles(form)
    assert [(c.low, c.high) for c in cycles] == [(240, 247), (248, 251)]
    assert abs(cycles[0].ms_per_step - 127.126) < 0.01
    assert abs(cycles[1].ms_per_step - 161.674) < 0.01

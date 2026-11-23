"""Record a reference trace of the real SQUID1.COM running in a sandboxed CPU.

Emulates just enough PC: VGA BIOS calls (1A00h, 1124h, 1100h), the 3DAh
retrace bits, the AdLib ports and the keyboard port. Every frame (each time
the main loop reaches its vertical-retrace wait) we hash the text screen and
the palette table, and we log every AdLib register write with its frame.

The JS remake is tested against this trace (tools/test_core.cjs).

usage: python tools/squid_ref.py assets/SQUID1.COM assets/vga8x16.bin out.json [frames]
"""
import sys, json, struct, hashlib
from unicorn import *
from unicorn.x86_const import *

com_path, font_path, out_path = sys.argv[1:4]
FRAMES = int(sys.argv[4]) if len(sys.argv) > 4 else 3000
SEG, BASE, BIOS = 0x1000, 0x10000, 0xF000
FONT_LIN = 0xF1000
MAINLOOP = 0x029F
PAL_TABLE, PAL_LEN = 0x189D, 8 * 290
EXTENDED, FONTBUF = 0x21FD, 0x089D

com = open(com_path, "rb").read()
font = open(font_path, "rb").read()

mu = Uc(UC_ARCH_X86, UC_MODE_16)
mu.mem_map(0, 0x110000)
for n in range(256):
    mu.mem_write(n * 4, struct.pack("<HH", n, BIOS))
mu.mem_write(BIOS * 16, b"\xcf" * 256)
mu.mem_write(FONT_LIN, font)
psp = bytearray(0x100); psp[0:2] = b"\xcd\x20"; psp[0x81] = 0x0D
mu.mem_write(BASE, bytes(psp))
mu.mem_write(BASE + 0x100, com)
for r in (UC_X86_REG_CS, UC_X86_REG_DS, UC_X86_REG_ES, UC_X86_REG_SS):
    mu.reg_write(r, SEG)
mu.reg_write(UC_X86_REG_SP, 0xFFFE)

rd = mu.reg_read
st = {"frame": -1, "dav": 0, "oplreg": 0, "upload": None, "stop": False}
opl = []          # [frame, reg, val]
frames = []       # per frame: [screen_sha1, pal_sha1]
snaps = {}
SNAP_AT = {0, 1, 2, 3, 50, 333, 1000, 2999}

def on_int(uc, n, _):
    ax = rd(UC_X86_REG_AX)
    if n == 0x10:
        if ax == 0x1A00:
            uc.reg_write(UC_X86_REG_AX, 0x001A); uc.reg_write(UC_X86_REG_BX, 0x0008)
        elif ax == 0x1124:
            uc.mem_write(0x43 * 4, struct.pack("<HH", FONT_LIN & 0xF, FONT_LIN >> 4))
        elif ax >> 8 == 0x11 and (ax & 0xFF) == 0:
            es, bp, cx, dx, bx = (rd(r) for r in (UC_X86_REG_ES, UC_X86_REG_BP, UC_X86_REG_CX, UC_X86_REG_DX, UC_X86_REG_BX))
            h = bx >> 8
            data = bytes(uc.mem_read(es * 16 + bp, cx * h))
            st["upload"] = {"first": dx, "count": cx, "height": h, "hex": data.hex()}
    elif n == 0x21 and ax >> 8 == 0x4C:
        st["stop"] = True; uc.emu_stop()
    elif n == 0x20:
        st["stop"] = True; uc.emu_stop()

def on_in(uc, port, size, _):
    if port == 0x3DA:
        st["dav"] ^= 1
        return 0x09 if st["dav"] else 0x00
    return 0

def on_out(uc, port, size, value, _):
    if port == 0x388:
        st["oplreg"] = value & 0xFF
    elif port == 0x389:
        opl.append([st["frame"], st["oplreg"], value & 0xFF])

def on_frame(uc, addr, size, _):
    st["frame"] += 1
    f = st["frame"]
    screen = bytes(uc.mem_read(0xB8000, 4000))
    pal = bytes(uc.mem_read(BASE + PAL_TABLE, PAL_LEN))
    frames.append([hashlib.sha1(screen).hexdigest()[:16], hashlib.sha1(pal).hexdigest()[:16]])
    if f in SNAP_AT:
        snaps[f] = {"screen": screen.hex(), "pal": pal.hex()}
    if f == 0:
        snaps["init"] = {
            "extended": bytes(uc.mem_read(BASE + EXTENDED, 0x8000)).hex(),
            "fontbuffer": bytes(uc.mem_read(BASE + FONTBUF, 4096)).hex(),
        }
    if f >= FRAMES:
        uc.emu_stop()

mu.hook_add(UC_HOOK_INTR, on_int)
mu.hook_add(UC_HOOK_INSN, on_in, None, 1, 0, UC_X86_INS_IN)
mu.hook_add(UC_HOOK_INSN, on_out, None, 1, 0, UC_X86_INS_OUT)
mu.hook_add(UC_HOOK_CODE, on_frame, begin=BASE + MAINLOOP, end=BASE + MAINLOOP)
try:
    mu.emu_start(BASE + 0x100, 0xFFFFF)
except UcError as e:
    print("emu error", e, hex(rd(UC_X86_REG_IP)))

print(f"frames={st['frame']} opl_writes={len(opl)} upload={'yes' if st['upload'] else 'no'} stopped={st['stop']}")
json.dump({"frames": frames, "opl": opl, "snaps": snaps, "upload": st["upload"]}, open(out_path, "w"))

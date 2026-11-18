# Move sounds

All files come from [PyChess](https://github.com/pychess/pychess) (`sounds/` directory, master branch),
© the PyChess authors (Thomas Dybdahl Ahle et al.), licensed **GPL-3.0-or-later** — the same licence as Chess Coach.
PyChess's repository is GPL-3.0, and Debian's packaging lists every upstream file, sounds included, as GPL-3+
(<https://sources.debian.org/data/main/p/pychess/1.2.0-1/debian/copyright>). KDE's Knights ships the same move and
capture recordings under the GPL as well.

| File | PyChess source | Used for | Changes |
| --- | --- | --- | --- |
| `move.wav` | [`sounds/mov2.wav`](https://raw.githubusercontent.com/pychess/pychess/master/sounds/mov2.wav) | a move; a capture, castling, check, the toppling king after mate, a draw and a promotion are built from it (no tones), one move back = a quiet one | mono, leading silence trimmed, 6 ms fade-out, peak −1 dBFS |
| `capture.wav` | [`sounds/capture2.wav`](https://raw.githubusercontent.com/pychess/pychess/master/sounds/capture2.wav) | checkmate (the mating move, before the king topples) | trimmed, 15 ms fade-out, peak −1 dBFS |
| `capture-2.wav` … `capture-5.wav` | cut from `sounds/capture2.wav` (and `capture-4.wav`: with `sounds/mov2.wav`) | variations of the same, one picked at random | the two knocks re-spaced (90–140 ms apart), the first one lighter in some; at or below the original level |

`sounds.json` maps the app's sounds to these files (client/src/lib/sound.ts `preloadSounds`).

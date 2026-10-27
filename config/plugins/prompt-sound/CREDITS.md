# Credits

## sound.mp3

The recording is "Whip-sound" by **Mike Koenig** (SoundBible), published on
Wikimedia Commons:

- Source: <https://commons.wikimedia.org/wiki/File:Whip-sound.ogg>
- Original: <http://soundbible.com/1150-Whip.html>
- License: **CC BY 3.0** (<https://creativecommons.org/licenses/by/3.0/>)
- File used here: the MP3 transcode from Commons (`Whip-sound.ogg.mp3`), stored
  as `sound.mp3`, because OpenCode's audio engine decodes WAV/FLAC/MP3 but not
  Vorbis. The only change is the filename.

Attribution is required if this file is redistributed; this use does not imply
endorsement by the author. `./scripts/fetch-mp3.py` re-downloads it;
`./scripts/fetch-mp3.py --check` re-validates the local copy (Windows:
`python scripts\fetch-mp3.py`).

## fallback.wav

Synthetic fallback generated locally by `scripts/generate-sound.py`. No
third-party rights involved.

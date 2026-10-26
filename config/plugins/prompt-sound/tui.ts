// prompt-sound — Play a short cue when the user submits a prompt.
// Uses OpenTUI's native audio engine directly, not a subprocess or the
// `attention` sound setting, so it works even when the terminal is focused.

import { Plugin } from "@opencode/plugin/tui"
import { Audio, type AudioSound } from "@opentui/core"
import path from "node:path"
import { fileURLToPath } from "node:url"

const VOLUME = 0.7
const DEBOUNCE_MS = 400
const PREFIX = "[prompt-sound]"

export default Plugin.define({
  id: "opencode-kit.prompt-sound",
  async setup(context) {
    const loggedKinds = new Set<string>()

    function logOnce(kind: string, message: string): void {
      if (loggedKinds.has(kind)) return
      loggedKinds.add(kind)
      console.error(`${PREFIX} ${message}`)
    }

    // Resolve the audio files relative to this plugin file, not the cwd.
    // sound.mp3 is the recorded clip (see CREDITS.md); fallback.wav is the
    // synthesized take from scripts/generate-sound.py.
    const here = path.dirname(fileURLToPath(import.meta.url))
    const candidates = [path.join(here, "sound.mp3"), path.join(here, "fallback.wav")]

    let audio: ReturnType<typeof Audio.create> | null = null
    let sound: AudioSound | null = null
    let started = false
    let lastPlayedAt = -Infinity

    function onError(error: Error, ctx: { action: string }): void {
      logOnce("audio-error", `audio engine error (${ctx.action}): ${error.message}`)
    }

    try {
      audio = Audio.create({ autoStart: false })
      audio.on("error", onError)
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error)
      logOnce("create", `failed to create audio engine: ${msg}`)
      return () => {}
    }

    function maybePlay(event: { data?: { sessionID?: string } }): void {
      try {
        const sessionID = event?.data?.sessionID
        if (!sessionID) return

        // Ignore subagent sessions; only play for the root session. When the
        // hierarchy is not cached yet (`root` gives nothing), allow playback
        // instead of staying silent, since the parent chain is unknown.
        const root = context.data.session.root(sessionID)
        if (root != null && root !== sessionID) return

        const now = Date.now()
        if (now - lastPlayedAt < DEBOUNCE_MS) return

        if (sound == null || !started || audio == null) return

        const voice = audio.play(sound, { volume: VOLUME })
        if (voice == null) {
          logOnce("play-null", "audio.play() returned null")
          return
        }
        lastPlayedAt = now
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        logOnce("play-throw", `audio.play() threw: ${msg}`)
      }
    }

    // Subscribe before loading so we do not miss a fast first prompt.
    const stopInbox = context.data.on("session.inbox.enqueued", maybePlay)
    const stopExec = context.data.on("session.execution.started", maybePlay)

    for (const file of candidates) {
      try {
        sound = await audio.loadSoundFile(file)
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        logOnce("load", `loadSoundFile threw on ${path.basename(file)}: ${msg}`)
        sound = null
      }
      if (sound != null) break
      logOnce(`load-${path.basename(file)}`, `could not load ${file}`)
    }

    if (sound != null) {
      try {
        started = audio.start() === true
        if (!started) {
          logOnce("start", "audio.start() returned false (no playback device?)")
        }
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        logOnce("start", `audio.start() threw: ${msg}`)
      }
    }

    return () => {
      try {
        stopInbox()
      } catch {
        // Swallow cleanup errors so plugin reload is not blocked.
      }
      try {
        stopExec()
      } catch {
        // Swallow cleanup errors.
      }

      if (audio != null) {
        audio.off("error", onError)
        if (sound != null) {
          try {
            audio.unloadSound(sound)
          } catch {
            // Best-effort unload.
          }
          sound = null
        }
        try {
          audio.stop()
        } catch {
          // Best-effort stop.
        }
        try {
          Promise.resolve(audio.dispose()).catch(() => {})
        } catch {
          // If dispose throws synchronously, ignore; the engine will be
          // cleaned up on process exit.
        }
        audio = null
      }
    }
  },
})

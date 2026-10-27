// Shared audio player for the flair plugin.
// Owns a single Audio engine + decoded clip, ref-counted so reloads do not
// dispose an engine that is still in use.
//
// This module intentionally imports no bare specifiers; the plugin host only
// resolves @opentui/core for plugin entry files. The entry file passes a
// factory that produces the audio engine.

import path from "node:path"

const VOLUME = 0.7
const PREFIX = "[flair]"

// Structural subset of OpenTUI's Audio engine used by this module.
export type AudioEngine = {
  on(event: "error", cb: (error: Error) => void): void
  off(event: "error", cb: (error: Error) => void): void
  start(): boolean
  play(sound: unknown, opts: { volume: number }): unknown
  loadSoundFile(file: string): Promise<unknown>
  unloadSound(sound: unknown): void
  stop(): void
  dispose(): unknown
}

export type AudioFactory = (opts: { autoStart: boolean }) => AudioEngine

export type CuePlayer = {
  ready: boolean
  play(): boolean
  release(): void
}

let audio: AudioEngine | null = null
let sound: unknown = null
let started = false
let refCount = 0
let initPromise: Promise<CuePlayer | null> | null = null
let factory: AudioFactory | null = null
const loggedKinds = new Set<string>()

function logOnce(kind: string, message: string): void {
  if (loggedKinds.has(kind)) return
  loggedKinds.add(kind)
  console.error(`${PREFIX} ${message}`)
}

function onError(error: Error): void {
  logOnce("audio-error", `audio engine error: ${error.message}`)
}

function flairDir(): string {
  return process.env.FLAIR_DIR
    ? path.resolve(process.env.FLAIR_DIR)
    : path.join(process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? "", ".config"), "opencode", "flair")
}

async function ensureEngine(): Promise<CuePlayer | null> {
  if (initPromise) return initPromise
  initPromise = doInit()
  return initPromise
}

async function doInit(): Promise<CuePlayer | null> {
  if (factory == null) return null

  try {
    audio = factory({ autoStart: false })
    audio.on("error", onError)
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error)
    logOnce("create", `failed to create audio engine: ${msg}`)
    return null
  }

  // The audio assets live outside the repository in the user's flair directory.
  const dir = flairDir()
  const candidates = [path.join(dir, "sound.mp3"), path.join(dir, "fallback.wav")]

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

  if (sound == null || !started) {
    disposeEngine()
    initPromise = null
    return null
  }

  if (refCount === 0) {
    disposeEngine()
    initPromise = null
    return null
  }

  return {
    get ready(): boolean {
      return sound != null && started && audio != null
    },
    play(): boolean {
      if (sound == null || audio == null || !started) return false
      try {
        const voice = audio.play(sound, { volume: VOLUME })
        if (voice == null) {
          logOnce("play-null", "audio.play() returned null")
          return false
        }
        return true
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error)
        logOnce("play-throw", `audio.play() threw: ${msg}`)
        return false
      }
    },
    release(): void {
      releaseAudioPlayer()
    },
  }
}

function disposeEngine(): void {
  if (audio == null) return
  try {
    audio.off("error", onError)
  } catch {
    // Best-effort cleanup.
  }
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
  started = false
}

// If acquire returns null it has already released itself; a non-null handle must
// be released exactly once by its caller.
export async function acquireAudioPlayer(makeAudio: AudioFactory): Promise<CuePlayer | null> {
  if (factory == null) {
    factory = makeAudio
  }
  refCount++
  const player = await ensureEngine()
  if (player == null) {
    releaseAudioPlayer()
    return null
  }
  return player
}

export function releaseAudioPlayer(): void {
  refCount = Math.max(0, refCount - 1)
  if (refCount === 0) {
    disposeEngine()
    initPromise = null
  }
}

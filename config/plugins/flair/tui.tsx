// flair — Optional prompt cue + animated sticker in one plugin.
// Assets live outside the repository (default ~/.config/opencode/flair):
//   - sound.mp3 or fallback.wav
//   - frames/f*.png
// If no assets are present the plugin is a silent no-op.

import { Plugin } from "@opencode/plugin/tui"
import { Audio, ImageRenderable, NativeImage } from "@opentui/core"
import { existsSync, mkdirSync, readdirSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import {
  acquireAudioPlayer,
  type AudioEngine,
  type CuePlayer,
} from "./audio"

const PREFIX = "[flair]"
// Cell footprint. Sixel/kitty draw real pixels, so the width in cells is enough
// and the height is derived from the artwork aspect; blocks packs at most 2x2
// coloured sub-pixels per cell, so it uses a larger fixed footprint.
const WIDTH = 20
const BLOCKS_WIDTH = 30
const BLOCKS_HEIGHT = 12
const FPS = 12
const BUDGET = 1000 / FPS
const DEBOUNCE = 400
const MAX_FRAMES = 64
const PROTOCOLS = ["sixel", "kitty", "blocks", "auto"] as const
// 0-based index of the frame where the whip reaches full extension
// (audio cue moment), 27 frames @ 12 FPS ≈ 1667 ms.
const CRACK_FRAME = 20

// The sticker is not erased on purpose. Sixel pixels live in the terminal, not
// in cells, so hiding the node leaves them until something repaints; the only
// way to remove them (a terminal reset) makes xterm.js keep dangling image tiles
// and paints a checkerboard placeholder over them, on a monitor-dependent side.
// A leftover sticker is the lesser evil, and it disappears on the next repaint.

type Protocol = (typeof PROTOCOLS)[number]

type InboxEvent = {
  data?: {
    sessionID?: string
    item?: { type?: string }
  }
}

// Structural subset of OpenTUI's negotiated TerminalCapabilities.
type TerminalCaps = {
  sixel?: boolean
  kitty_graphics?: boolean
  terminal?: { name?: string; version?: string }
}

function flairDir(): string {
  return process.env.FLAIR_DIR
    ? path.resolve(process.env.FLAIR_DIR)
    : path.join(process.env.XDG_CONFIG_HOME ?? path.join(process.env.HOME ?? "", ".config"), "opencode", "flair")
}

export default Plugin.define({
  id: "opencode-kit.flair",
  async setup(context) {
    const logged = new Set<string>()
    function log(kind: string, message: string): void {
      if (logged.has(kind)) return
      logged.add(kind)
      console.error(`${PREFIX} ${message}`)
    }

    if (process.env.FLAIR === "0") {
      log("disabled", "FLAIR=0; doing nothing")
      return () => {}
    }

    const assetDir = flairDir()
    const frameDir = path.join(assetDir, "frames")
    const frameFiles = existsSync(frameDir)
      ? readdirSync(frameDir)
          .filter((f) => /^f.*\.png$/i.test(f))
          .sort()
          .slice(0, MAX_FRAMES)
          .map((f) => path.join(frameDir, f))
      : []

    const hasAudioFiles = ["sound.mp3", "fallback.wav"].some((name) =>
      existsSync(path.join(assetDir, name)),
    )

    let frames: NativeImage[] = []
    if (frameFiles.length > 0) {
      for (const file of frameFiles) {
        try {
          frames.push(await NativeImage.load(file))
        } catch (error) {
          log("preload-error", `failed to load ${path.basename(file)}: ${error instanceof Error ? error.message : String(error)}`)
        }
      }
    }

    function disposeFrames(): void {
      frames.forEach((img) => { try { img.dispose() } catch {} })
      frames = []
    }

    const hasFrames = frames.length >= 2

    if (!hasFrames && !hasAudioFiles) {
      log("no-assets", `no flair assets in ${assetDir}; doing nothing`)
      disposeFrames()
      return () => {}
    }

    let protocol: Protocol | null = null
    let width = BLOCKS_WIDTH
    let height = BLOCKS_HEIGHT
    let fit: "fit" | "fill" = "fit"
    let top = 1
    let right = 2
    let view: ImageRenderable | undefined

    const renderer = context.renderer as {
      root?: { add: (r: ImageRenderable) => void }
      requestAnimationFrame: (cb: (elapsed: number) => void) => number
      cancelAnimationFrame: (handle: number) => void
      resolution?: { width?: number; height?: number } | null
      terminalWidth?: number
      terminalHeight?: number
    }

    if (hasFrames) {
      if (!renderer || !renderer.requestAnimationFrame) {
        log("renderer-missing", "context.renderer is not available")
        disposeFrames()
        return () => {}
      }

      // Protocol, chosen from what the terminal actually reports (the plugin runs
      // inside the TUI renderer, so the capabilities are already negotiated):
      //   sixel  - first choice: works in VS Code's xterm.js and most modern
      //            terminals, and is the path already validated here.
      //   kitty  - only for terminals that really implement it. xterm.js also
      //            advertises kitty_graphics, and the kitty path paints the
      //            sticker box black there, so `auto` is not trustworthy.
      //   blocks - universal fallback, needs no terminal support at all, which
      //            is what makes this work on Windows Terminal and in tmux.
      const caps = (context.renderer as unknown as { capabilities?: TerminalCaps | null }).capabilities ?? null
      const resolution = (context.renderer as unknown as { resolution?: { width?: number } | null }).resolution ?? null
      const terminalName = `${caps?.terminal?.name ?? ""} ${caps?.terminal?.version ?? ""} ${process.env.TERM ?? ""}`.toLowerCase()
      const kittyTrusted = caps?.kitty_graphics === true && /kitty|ghostty|wezterm/.test(terminalName)
      const detected: Protocol = caps?.sixel && (resolution?.width ?? 0) > 0
        ? "sixel"
        : kittyTrusted
          ? "kitty"
          : "blocks"

      const envProto = process.env.FLAIR_PROTOCOL
      protocol = envProto
        ? PROTOCOLS.includes(envProto as Protocol)
          ? (envProto as Protocol)
          : (log("protocol-invalid", `unknown FLAIR_PROTOCOL=${envProto}; using ${detected}`), detected)
        : detected

      const envTop = process.env.FLAIR_TOP
      top = envTop != null && envTop !== "" ? Math.max(0, Number(envTop)) : 1
      const envRight = process.env.FLAIR_RIGHT
      right = envRight != null && envRight !== "" ? Math.max(0, Number(envRight)) : 2

      if (protocol === "blocks") {
        width = BLOCKS_WIDTH
        height = BLOCKS_HEIGHT
      } else {
        const res = renderer.resolution ?? null
        const cols = renderer.terminalWidth ?? process.stdout.columns ?? 0
        const rows = renderer.terminalHeight ?? process.stdout.rows ?? 0
        const cellAspect = res?.width && res?.height && cols && rows
          ? (res.height / rows) / (res.width / cols)
          : 2
        const imgW = frames[0]!.width
        const imgH = frames[0]!.height
        const envWidth = process.env.FLAIR_WIDTH
        width = Math.max(4, envWidth != null && envWidth !== "" ? Number(envWidth) : WIDTH)
        const envHeight = process.env.FLAIR_HEIGHT
        height = Math.max(1, envHeight != null && envHeight !== "" ? Number(envHeight) : Math.round(width * (imgH / imgW) / cellAspect))
        fit = "fill"

        // Cross-monitor alignment bugs need numbers, and the TUI swallows stderr.
        try {
          mkdirSync(path.join(tmpdir(), "opencode"), { recursive: true })
          writeFileSync(
            path.join(tmpdir(), "opencode", "flair.json"),
            JSON.stringify({ protocol, width, height, cellAspect, imgW, imgH, cols, rows, resolution: res, right, top }, null, 2),
          )
        } catch {}
      }

      try {
        view = new ImageRenderable(context.renderer, {
          id: "flair-floating",
          source: frames[0] as unknown as string,
          width,
          height,
          fit,
          protocol,
          position: "absolute",
          top,
          right,
          onError: (error: unknown) => log("image-error", error instanceof Error ? error.message : String(error)),
        })
        view.visible = false
        renderer.root?.add(view)
        await view.loadPromise
      } catch (error) {
        log("floating-construct", `could not create sticker: ${error instanceof Error ? error.message : String(error)}`)
        disposeFrames()
        return () => {}
      }

      log("ready", `protocol=${protocol} frames=${frames.length}/${frameFiles.length} size=${width}x${height} fit=${fit} dir=${path.basename(assetDir)}`)
      log("env", `TERM_PROGRAM=${process.env.TERM_PROGRAM} TERM=${process.env.TERM} COLORTERM=${process.env.COLORTERM}`)
    }

    // Guard against artwork changes: never target a frame past the end.
    const crackFrame = hasFrames ? Math.min(CRACK_FRAME, frames.length - 1) : 0

    // Acquire the shared audio engine for the cue (sound-only mode) or the
    // animation crack (sticker mode). If no audio asset is present this returns
    // null and the plugin stays silent.
    const cuePlayer = await acquireAudioPlayer((opts) => Audio.create(opts) as AudioEngine)

    let raf = -1
    let index = 0
    let acc = 0
    let running = false
    let cueFired = false
    let lastTriggeredAt = -Infinity
    // Pixel geometry captured at play time. A window or monitor change mid-animation
    // makes the raster and the cell grid disagree, which tears the sticker, so the
    // animation stops instead of drawing distorted frames.
    let playResolution: { width?: number; height?: number } | null = null
    const currentResolution = () => renderer.resolution ?? null

    function hide(): void {
      running = false
      if (raf !== -1) {
        try { renderer.cancelAnimationFrame(raf) } catch {}
        raf = -1
      }
      if (view) {
        view.visible = false
      }
    }

    function tryCue(): void {
      if (cueFired) return
      if (cuePlayer == null || !cuePlayer.ready) return
      cuePlayer.play()
      cueFired = true
    }

    function tick(elapsed: number): void {
      if (!running || !view) return
      try {
        const res = currentResolution()
        if (playResolution && res && (res.width !== playResolution.width || res.height !== playResolution.height)) {
          hide()
          return
        }
        acc += elapsed
        if (acc < BUDGET) {
          raf = renderer.requestAnimationFrame(tick)
          return
        }
        const steps = Math.floor(acc / BUDGET)
        acc -= steps * BUDGET
        const next = index + steps
        if (next >= frames.length) {
          index = frames.length - 1
        } else {
          index = next
        }
        view.source = frames[index] as unknown as string
        if (!cueFired && index >= crackFrame) {
          tryCue()
        }
        if (next >= frames.length) {
          // The animation ended before reaching CRACK_FRAME; fire the cue now so
          // every trigger still produces exactly one sound.
          tryCue()
          hide()
          return
        }
        raf = renderer.requestAnimationFrame(tick)
      } catch (error) {
        log("frame-error", `animation threw: ${error instanceof Error ? error.message : String(error)}`)
        hide()
      }
    }

    function play(): void {
      if (running || !view) return
      index = 0
      acc = 0
      cueFired = false
      running = true
      playResolution = currentResolution()
      view.source = frames[0] as unknown as string
      view.visible = true
      view.requestRender?.()
      if (crackFrame === 0) tryCue()
      raf = renderer.requestAnimationFrame(tick)
    }

    function onTrigger(event: InboxEvent): void {
      try {
        // A single user submit can also be signalled by `session.execution.started`,
        // so we listen only to the canonical inbox event for user items. The
        // debounce remains as a guard against rapid events or duplicated signals.
        if (event?.data?.item?.type !== "user") return

        const sessionID = event?.data?.sessionID
        if (!sessionID) return

        // Ignore subagent sessions; only play for the root session. When the
        // hierarchy is not cached yet (`root` gives nothing), allow playback
        // instead of staying silent, since the parent chain is unknown.
        const root = context.data.session.root(sessionID)
        if (root != null && root !== sessionID) return

        const now = Date.now()
        if (now - lastTriggeredAt < DEBOUNCE) return
        lastTriggeredAt = now

        if (hasFrames) {
          play()
        } else if (cuePlayer != null && cuePlayer.ready) {
          cuePlayer.play()
        }
      } catch (error) {
        log("trigger-error", `trigger threw: ${error instanceof Error ? error.message : String(error)}`)
        hide()
      }
    }

    const stopInbox = context.data.on("session.inbox.enqueued", onTrigger)

    return () => {
      hide()
      try { stopInbox() } catch {}
      try { view?.destroy?.() } catch {}
      frames.forEach((img) => { try { img.dispose() } catch {} })
      cuePlayer?.release()
    }
  },
})

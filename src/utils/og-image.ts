import { Buffer } from 'node:buffer'
import { createRequire } from 'node:module'
import fs from 'node:fs/promises'
import type { Canvas, CanvasKit, FontMgr, Paragraph, TextStyle } from 'canvaskit-wasm'
import { stripInlineMarkdown } from './inline-markdown'

const require = createRequire(import.meta.url)
const MONOSPACE_FONT_PATHS = [
  '/System/Library/Fonts/SFNSMono.ttf',
  '/System/Library/Fonts/Menlo.ttc',
  '/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf',
  '/usr/share/fonts/truetype/liberation2/LiberationMono-Regular.ttf'
]
const MONOSPACE_FONT_FAMILIES = ['.SF NS Mono', 'Menlo', 'DejaVu Sans Mono', 'Liberation Mono', 'Inter Variable']

const WIDTH = 1200
const HEIGHT = 630
const PADDING = 64
const LOGO_WIDTH = 16
const LOGO_HEIGHT = 48
const LOGO_X = 68
const LOGO_Y = 156
const TITLE_TOP = 256
const TITLE_LINE_HEIGHT = 74
const DESCRIPTION_GAP = 28
const DESCRIPTION_LINE_HEIGHT = 42
const BOTTOM_SAFE_AREA = 88
const MAX_TEXT_WIDTH = WIDTH - PADDING * 2
const CODE_ADJACENT_SPACE_WIDTH = 14
const CODE_PADDING_X = 8
const CODE_PADDING_Y = 5
const CODE_RADIUS = 8

// Composited equivalents of the dark theme tokens over --bg (#1c1c1c).
const COLORS = {
  background: [28, 28, 28],
  backgroundTop: [31, 31, 31],
  backgroundBottom: [18, 18, 18],
  mark: [84, 91, 55],
  logo: [232, 229, 220],
  title: [232, 232, 232],
  description: [119, 119, 119],
  codeBackground: [37, 37, 37],
  codeBorder: [51, 51, 51],
  codeText: [232, 232, 232]
} as const

type ParsedTitleToken =
  | {
      kind: 'text' | 'space'
      value: string
    }
  | {
      kind: 'code'
      value: string
    }

type MeasuredTitleToken =
  | {
      kind: 'text' | 'space'
      value: string
      width: number
    }
  | {
      kind: 'code'
      value: string
      width: number
      textWidth: number
      boundsTop: number
      boundsBottom: number
    }

let canvasKitPromise: Promise<CanvasKit> | undefined
let fontManagerPromise: Promise<FontMgr> | undefined

const getCanvasKit = async () => {
  canvasKitPromise ??= import('canvaskit-wasm/full').then(({ default: init }) =>
    init({
      locateFile: (file) => require.resolve(`canvaskit-wasm/bin/full/${file}`)
    })
  )
  return canvasKitPromise
}

const getFontManager = async (CanvasKit: CanvasKit) => {
  fontManagerPromise ??= (async () => {
    const fontFiles = [await fs.readFile('public/fonts/Inter.woff2')]

    for (const fontPath of MONOSPACE_FONT_PATHS) {
      const font = await fs.readFile(fontPath).catch(() => undefined)
      if (font) {
        fontFiles.push(font)
        break
      }
    }

    const fontManager = CanvasKit.FontMgr.FromData(...fontFiles.map((font) => new Uint8Array(font).buffer))

    if (!fontManager) {
      throw new Error('Unable to create Open Graph image font manager.')
    }

    return fontManager
  })()
  return fontManagerPromise
}

const createParagraph = (CanvasKit: CanvasKit, fontManager: FontMgr, text: string, style: TextStyle): Paragraph => {
  const builder = CanvasKit.ParagraphBuilder.Make(
    new CanvasKit.ParagraphStyle({
      textStyle: style
    }),
    fontManager
  )
  builder.addText(text)
  return builder.build()
}

const measureText = (CanvasKit: CanvasKit, fontManager: FontMgr, text: string, style: TextStyle) => {
  const paragraph = createParagraph(CanvasKit, fontManager, text, style)
  paragraph.layout(MAX_TEXT_WIDTH)
  const width = paragraph.getLongestLine()
  paragraph.delete()
  return width
}

const measureCodeText = (CanvasKit: CanvasKit, fontManager: FontMgr, text: string, style: TextStyle) => {
  const paragraph = createParagraph(CanvasKit, fontManager, text, style)
  paragraph.layout(MAX_TEXT_WIDTH)
  const width = paragraph.getLongestLine()
  const bounds = paragraph.getRectsForRange(
    0,
    text.length,
    CanvasKit.RectHeightStyle.Tight,
    CanvasKit.RectWidthStyle.Tight
  )
  const rect = bounds[0]?.rect

  paragraph.delete()

  return {
    width,
    boundsTop: rect?.[1] ?? 0,
    boundsBottom: rect?.[3] ?? TITLE_LINE_HEIGHT
  }
}

const drawText = (
  CanvasKit: CanvasKit,
  canvas: Canvas,
  fontManager: FontMgr,
  text: string,
  style: TextStyle,
  x: number,
  y: number
) => {
  const paragraph = createParagraph(CanvasKit, fontManager, text, style)
  paragraph.layout(MAX_TEXT_WIDTH)
  canvas.drawParagraph(paragraph, x, y)
  paragraph.delete()
}

const pushTextTokens = (tokens: ParsedTitleToken[], value: string) => {
  const stripped = stripInlineMarkdown(value)
  const matches = stripped.matchAll(/\s+|\S+/g)

  for (const match of matches) {
    const text = match[0]
    tokens.push({
      kind: /^\s+$/.test(text) ? 'space' : 'text',
      value: text
    })
  }
}

const parseTitleTokens = (title: string): ParsedTitleToken[] => {
  const tokens: ParsedTitleToken[] = []
  const codeRegex = /`([^`]+)`/g
  let lastIndex = 0

  for (const match of title.matchAll(codeRegex)) {
    const index = match.index ?? 0
    pushTextTokens(tokens, title.slice(lastIndex, index))
    tokens.push({ kind: 'code', value: match[1] ?? '' })
    lastIndex = index + match[0].length
  }

  pushTextTokens(tokens, title.slice(lastIndex))
  return tokens
}

const measureTitleTokens = (
  CanvasKit: CanvasKit,
  fontManager: FontMgr,
  tokens: ParsedTitleToken[],
  titleStyle: TextStyle,
  codeStyle: TextStyle
): MeasuredTitleToken[] =>
  tokens.map((token, index) => {
    if (token.kind === 'code') {
      const measurement = measureCodeText(CanvasKit, fontManager, token.value, codeStyle)
      return {
        ...token,
        textWidth: measurement.width,
        width: measurement.width + CODE_PADDING_X * 2,
        boundsTop: measurement.boundsTop,
        boundsBottom: measurement.boundsBottom
      }
    }

    if (token.kind === 'space' && (tokens[index - 1]?.kind === 'code' || tokens[index + 1]?.kind === 'code')) {
      return {
        ...token,
        width: CODE_ADJACENT_SPACE_WIDTH
      }
    }

    return {
      ...token,
      width: measureText(CanvasKit, fontManager, token.value, titleStyle)
    }
  })

const trimTrailingSpaces = (line: MeasuredTitleToken[]) => {
  while (line.at(-1)?.kind === 'space') {
    line.pop()
  }
}

const wrapTitleTokens = (tokens: MeasuredTitleToken[]) => {
  const lines: MeasuredTitleToken[][] = []
  let line: MeasuredTitleToken[] = []
  let lineWidth = 0

  for (const token of tokens) {
    if (token.kind === 'space' && line.length === 0) {
      continue
    }

    if (line.length > 0 && lineWidth + token.width > MAX_TEXT_WIDTH) {
      trimTrailingSpaces(line)
      lines.push(line)
      line = []
      lineWidth = 0

      if (token.kind === 'space') {
        continue
      }
    }

    line.push(token)
    lineWidth += token.width
  }

  trimTrailingSpaces(line)
  if (line.length > 0) {
    lines.push(line)
  }

  return lines
}

const drawLogo = (CanvasKit: CanvasKit, canvas: Canvas) => {
  const logoPaint = new CanvasKit.Paint()
  logoPaint.setColor(CanvasKit.Color(...COLORS.logo))
  canvas.drawRect(CanvasKit.XYWHRect(LOGO_X, LOGO_Y, LOGO_WIDTH, LOGO_HEIGHT), logoPaint)
  logoPaint.delete()
}

const drawBackground = (CanvasKit: CanvasKit, canvas: Canvas) => {
  const backgroundRect = CanvasKit.XYWHRect(0, 0, WIDTH, HEIGHT)
  const gradientPaint = new CanvasKit.Paint()
  const gradient = CanvasKit.Shader.MakeLinearGradient(
    [0, 0],
    [WIDTH, HEIGHT],
    [
      CanvasKit.Color(...COLORS.backgroundTop),
      CanvasKit.Color(...COLORS.background),
      CanvasKit.Color(...COLORS.backgroundBottom)
    ],
    [0, 0.55, 1],
    CanvasKit.TileMode.Clamp
  )

  gradientPaint.setShader(gradient)
  canvas.drawRect(backgroundRect, gradientPaint)

  const markGlowPaint = new CanvasKit.Paint()
  const markGlow = CanvasKit.Shader.MakeRadialGradient(
    [96, 0],
    680,
    [CanvasKit.Color(...COLORS.mark, 0.07), CanvasKit.Color(...COLORS.background, 0)],
    [0, 0.95],
    CanvasKit.TileMode.Clamp
  )

  markGlowPaint.setShader(markGlow)
  canvas.drawRect(backgroundRect, markGlowPaint)

  gradient.delete()
  markGlow.delete()
  gradientPaint.delete()
  markGlowPaint.delete()
}

const drawCodeToken = (
  CanvasKit: CanvasKit,
  canvas: Canvas,
  fontManager: FontMgr,
  token: Extract<MeasuredTitleToken, { kind: 'code' }>,
  codeStyle: TextStyle,
  x: number,
  y: number
) => {
  const pillY = y + token.boundsTop - CODE_PADDING_Y
  const pillHeight = token.boundsBottom - token.boundsTop + CODE_PADDING_Y * 2
  const rect = CanvasKit.XYWHRect(x, pillY, token.width, pillHeight)
  const rrect = CanvasKit.RRectXY(rect, CODE_RADIUS, CODE_RADIUS)
  const backgroundPaint = new CanvasKit.Paint()
  backgroundPaint.setColor(CanvasKit.Color(...COLORS.codeBackground))
  canvas.drawRRect(rrect, backgroundPaint)

  const borderPaint = new CanvasKit.Paint()
  borderPaint.setColor(CanvasKit.Color(...COLORS.codeBorder))
  borderPaint.setStyle(CanvasKit.PaintStyle.Stroke)
  borderPaint.setStrokeWidth(1)
  canvas.drawRRect(rrect, borderPaint)

  drawText(CanvasKit, canvas, fontManager, token.value, codeStyle, x + CODE_PADDING_X, y)
}

const drawTitle = (
  CanvasKit: CanvasKit,
  canvas: Canvas,
  fontManager: FontMgr,
  lines: MeasuredTitleToken[][],
  titleStyle: TextStyle,
  codeStyle: TextStyle,
  startY: number
) => {
  lines.forEach((line, index) => {
    let x = PADDING
    const y = startY + index * TITLE_LINE_HEIGHT

    line.forEach((token) => {
      if (token.kind === 'space') {
        x += token.width
        return
      }

      if (token.kind === 'code') {
        drawCodeToken(CanvasKit, canvas, fontManager, token, codeStyle, x, y)
      } else {
        drawText(CanvasKit, canvas, fontManager, token.value, titleStyle, x, y)
      }

      x += token.width
    })
  })
}

export const generatePostOpenGraphImage = async ({ title, description }: { title: string; description: string }) => {
  const CanvasKit = await getCanvasKit()
  const fontManager = await getFontManager(CanvasKit)
  const surface = CanvasKit.MakeSurface(WIDTH, HEIGHT)
  if (!surface) {
    throw new Error('Unable to create Open Graph image surface.')
  }
  const canvas = surface.getCanvas()

  drawBackground(CanvasKit, canvas)

  drawLogo(CanvasKit, canvas)

  const titleStyle = new CanvasKit.TextStyle({
    color: CanvasKit.Color(...COLORS.title),
    fontFamilies: ['Inter Variable'],
    fontSize: 64,
    fontStyle: { weight: CanvasKit.FontWeight.SemiBold },
    heightMultiplier: 1
  })
  const codeStyle = new CanvasKit.TextStyle({
    color: CanvasKit.Color(...COLORS.codeText),
    fontFamilies: MONOSPACE_FONT_FAMILIES,
    fontSize: 58,
    fontStyle: { weight: CanvasKit.FontWeight.Medium },
    heightMultiplier: 1
  })
  const descriptionStyle = new CanvasKit.TextStyle({
    color: CanvasKit.Color(...COLORS.description),
    fontFamilies: ['Inter Variable'],
    fontSize: 34,
    fontStyle: { weight: CanvasKit.FontWeight.Normal },
    heightMultiplier: 1.2
  })

  const titleTokens = measureTitleTokens(CanvasKit, fontManager, parseTitleTokens(title), titleStyle, codeStyle)
  const titleLines = wrapTitleTokens(titleTokens)
  const titleHeight = titleLines.length * TITLE_LINE_HEIGHT
  const totalTextHeight = titleHeight + DESCRIPTION_GAP + DESCRIPTION_LINE_HEIGHT
  const titleTop = Math.min(TITLE_TOP, HEIGHT - BOTTOM_SAFE_AREA - totalTextHeight)

  drawTitle(CanvasKit, canvas, fontManager, titleLines, titleStyle, codeStyle, titleTop)
  drawText(
    CanvasKit,
    canvas,
    fontManager,
    description,
    descriptionStyle,
    PADDING,
    titleTop + titleHeight + DESCRIPTION_GAP
  )

  const image = surface.makeImageSnapshot()
  const imageBytes = image.encodeToBytes(CanvasKit.ImageFormat.PNG, 90) || new Uint8Array()
  surface.dispose()

  return Buffer.from(imageBytes)
}

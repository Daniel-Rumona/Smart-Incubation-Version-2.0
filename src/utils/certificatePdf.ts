import dayjs from 'dayjs'
import { DEFAULT_PALETTE, paletteFromPixels, type CertificatePalette } from '@/utils/certificatePalette'
import type { TrainingCertificate } from '@/types/training'

/**
 * Draws a certificate of completion (A4 landscape) in the training company's own colours (taken from its logo, see
 * certificatePalette.ts) and saves it as a one-page PDF.
 *
 * The page is drawn on a canvas at about 200 dpi and embedded in a minimal PDF as a JPEG, so no PDF library is
 * needed. Logos and the signature are fetched like the agreement documents' images: if the storage bucket's CORS
 * settings do not allow this site they are left out and the certificate is still produced.
 */

const WIDTH = 2339
const HEIGHT = 1654
const PAGE_WIDTH_PT = 842
const PAGE_HEIGHT_PT = 595

const SERIF = 'Georgia, "Times New Roman", serif'
const SANS = '"Segoe UI", Helvetica, Arial, sans-serif'

export const CERTIFICATE_STATEMENT = 'Awareness training, non-credit-bearing. Completion is based on participation and internal assessment; it is not a formal occupational qualification.'

type Image = CanvasImageSource & { width: number, height: number }

const loadImage = async (url?: string): Promise<ImageBitmap | null> => {
    if (!url) return null
    try {
        const response = await fetch(url)
        if (!response.ok) return null
        const blob = await response.blob()
        return blob.type.startsWith('image/') ? await createImageBitmap(blob) : null
    } catch {
        return null
    }
}

/** The certificate's colours from the logo's own pixels (certificatePalette.ts); the usual green without a logo. */
const paletteOf = (logo: Image | null): CertificatePalette => {
    if (!logo) return DEFAULT_PALETTE
    try {
        const size = 96
        const canvas = document.createElement('canvas')
        canvas.width = size
        canvas.height = size
        const context = canvas.getContext('2d', { willReadFrequently: true })
        if (!context) return DEFAULT_PALETTE
        context.drawImage(logo, 0, 0, size, size)
        return paletteFromPixels(context.getImageData(0, 0, size, size).data)
    } catch {
        return DEFAULT_PALETTE
    }
}

/** Draws `image` centred in the box, as large as fits without changing its proportions. */
const drawFitted = (context: CanvasRenderingContext2D, image: Image, centreX: number, top: number, maxWidth: number, maxHeight: number) => {
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1.6)
    const width = image.width * scale
    const height = image.height * scale
    context.drawImage(image, centreX - width / 2, top + (maxHeight - height) / 2, width, height)
}

type TextOptions = { family?: string, weight?: string, style?: string, colour?: string, maxWidth?: number, align?: CanvasTextAlign, spacing?: number }

/** Writes text (centred unless told otherwise), shrinking it until it fits `maxWidth`. Returns its width. */
const writeText = (context: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, options: TextOptions = {}) => {
    const { family = SANS, weight = 'normal', style = 'normal', colour = '#1f2a30', maxWidth = WIDTH - 600, align = 'center', spacing = 0 } = options
    const spaced = context as CanvasRenderingContext2D & { letterSpacing?: string }
    let fontSize = size
    do {
        context.font = `${style} ${weight} ${fontSize}px ${family}`
        if ('letterSpacing' in spaced) spaced.letterSpacing = `${(spacing * fontSize) / size}px`
        if (context.measureText(value).width <= maxWidth) break
        fontSize -= 2
    } while (fontSize > 14)
    context.fillStyle = colour
    context.textAlign = align
    context.fillText(value, x, y)
    const width = context.measureText(value).width
    if ('letterSpacing' in spaced) spaced.letterSpacing = '0px'
    return width
}

/** Splits text into lines no wider than `maxWidth` at the current font. */
const wrap = (context: CanvasRenderingContext2D, value: string, maxWidth: number) => value.split(' ').reduce<string[]>((lines, word) => {
    const last = lines[lines.length - 1]
    if (last !== undefined && context.measureText(`${last} ${word}`).width <= maxWidth) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
    return lines
}, [])

const line = (context: CanvasRenderingContext2D, fromX: number, fromY: number, toX: number, toY: number, colour: string, width: number) => {
    context.strokeStyle = colour
    context.lineWidth = width
    context.beginPath()
    context.moveTo(fromX, fromY)
    context.lineTo(toX, toY)
    context.stroke()
}

/**
 * Layered swooshes in one corner (drawn for the top-left; the bottom-right is the same turned half round): bands of
 * the brand's dark, middle and light shades sweeping along the two edges, split by white and lit by a gold line.
 */
const drawSwooshes = (context: CanvasRenderingContext2D, palette: CertificatePalette) => {
    const band = (down: number, across: number, bendDown: number, bendAcross: number) => {
        context.beginPath()
        context.moveTo(0, 0)
        context.lineTo(0, down)
        context.bezierCurveTo(bendAcross * 0.12, down * 0.5, across * 0.42, bendDown * 0.14, across, 0)
        context.closePath()
    }
    const fill = (colourFrom: string, colourTo: string, down: number, across: number) => {
        const gradient = context.createLinearGradient(0, 0, across, down)
        gradient.addColorStop(0, colourFrom)
        gradient.addColorStop(1, colourTo)
        context.fillStyle = gradient
    }
    const edge = (down: number, across: number, colour: string, width: number) => {
        context.beginPath()
        context.moveTo(0, down)
        context.bezierCurveTo(across * 0.12, down * 0.5, across * 0.42, down * 0.14, across, 0)
        context.strokeStyle = colour
        context.lineWidth = width
        context.stroke()
    }

    band(560, 930, 560, 930)
    fill(palette.dark, palette.mid, 560, 930)
    context.fill()
    edge(560, 930, '#ffffff', 10)
    edge(520, 870, palette.gold, 5)
    band(470, 780, 470, 780)
    fill(palette.light, palette.mid, 470, 780)
    context.fill()
    edge(470, 780, '#ffffff', 10)
    band(380, 620, 380, 620)
    fill(palette.dark, palette.dark, 380, 620)
    context.fill()
    edge(330, 520, palette.goldLight, 4)
}

/** The frame: a double line with small squares at the two plain corners, under the swooshes. */
const drawFrame = (context: CanvasRenderingContext2D, palette: CertificatePalette) => {
    context.strokeStyle = palette.dark
    context.lineWidth = 6
    context.strokeRect(52, 52, WIDTH - 104, HEIGHT - 104)
    context.strokeStyle = palette.light
    context.lineWidth = 2.5
    context.strokeRect(74, 74, WIDTH - 148, HEIGHT - 148)
    const square = (x: number, y: number) => {
        context.fillStyle = palette.dark
        context.fillRect(x - 16, y - 16, 32, 32)
        context.fillStyle = '#ffffff'
        context.fillRect(x - 8, y - 8, 16, 16)
        context.fillStyle = palette.light
        context.fillRect(x - 4, y - 4, 8, 8)
    }
    square(WIDTH - 63, 63)
    square(63, HEIGHT - 63)
}

/** Text along the top or bottom of a circle, centred on it. */
const arcText = (context: CanvasRenderingContext2D, value: string, centreX: number, centreY: number, radius: number, size: number, colour: string, bottom = false) => {
    context.save()
    context.font = `normal bold ${size}px ${SANS}`
    context.fillStyle = colour
    context.textAlign = 'center'
    context.textBaseline = 'middle'
    const characters = Array.from(value)
    const widths = characters.map((character) => context.measureText(character).width + size * 0.12)
    const total = widths.reduce((sum, width) => sum + width, 0) / radius
    // Along the top the text runs clockwise from the left; along the bottom anticlockwise, so both read upright.
    const direction = bottom ? -1 : 1
    let angle = (bottom ? Math.PI / 2 : -Math.PI / 2) - (direction * total) / 2
    characters.forEach((character, index) => {
        const half = widths[index] / radius / 2
        angle += direction * half
        context.save()
        context.translate(centreX + radius * Math.cos(angle), centreY + radius * Math.sin(angle))
        context.rotate(angle + (direction * Math.PI) / 2)
        context.fillText(character, 0, 0)
        context.restore()
        angle += direction * half
    })
    context.restore()
}

/**
 * The company's name as it fits over the top of the seal (at most about 140° of the circle): full size if it can,
 * then smaller, then its first words ("TAU NAMAGADI SUSTAINABLE SOLUTIONS" becomes "TAU NAMAGADI").
 */
const sealName = (context: CanvasRenderingContext2D, provider: string, arcRadius: number, radius: number) => {
    const maxAngle = 2.45
    const angleOf = (value: string, size: number) => {
        context.font = `normal bold ${size}px ${SANS}`
        return Array.from(value).reduce((sum, character) => sum + context.measureText(character).width + size * 0.12, 0) / arcRadius
    }
    const sizes = [0.14, 0.13, 0.12, 0.11, 0.1].map((share) => Math.round(radius * share))
    const words = provider.toUpperCase().split(/\s+/).filter(Boolean)
    for (let count = words.length; count >= 1; count -= 1) {
        const text = words.slice(0, count).join(' ')
        const size = sizes.find((candidate) => angleOf(text, candidate) <= maxAngle)
        if (size) return { text, size }
    }
    let text = words[0] || ''
    while (text.length > 3 && angleOf(`${text}…`, sizes[sizes.length - 1]) > maxAngle) text = text.slice(0, -1)
    return { text: `${text}…`, size: sizes[sizes.length - 1] }
}

/** The seal: a gold-rimmed rosette in the brand's dark shade, the company's name round the top and COMPLETED across it. */
const drawSeal = (context: CanvasRenderingContext2D, palette: CertificatePalette, centreX: number, centreY: number, radius: number, provider: string) => {
    context.save()
    // Scalloped gold edge.
    const points = 36
    context.beginPath()
    for (let index = 0; index <= points * 2; index += 1) {
        const angle = (index / (points * 2)) * Math.PI * 2
        const reach = index % 2 === 0 ? radius : radius * 0.93
        context.lineTo(centreX + reach * Math.cos(angle), centreY + reach * Math.sin(angle))
    }
    const rim = context.createRadialGradient(centreX - radius * 0.3, centreY - radius * 0.3, radius * 0.2, centreX, centreY, radius)
    rim.addColorStop(0, palette.goldLight)
    rim.addColorStop(1, palette.gold)
    context.fillStyle = rim
    context.fill()
    // The disc.
    context.beginPath()
    context.arc(centreX, centreY, radius * 0.84, 0, Math.PI * 2)
    const disc = context.createRadialGradient(centreX - radius * 0.25, centreY - radius * 0.3, radius * 0.1, centreX, centreY, radius * 0.84)
    disc.addColorStop(0, palette.mid)
    disc.addColorStop(1, palette.dark)
    context.fillStyle = disc
    context.fill()
    context.beginPath()
    context.arc(centreX, centreY, radius * 0.66, 0, Math.PI * 2)
    context.strokeStyle = palette.goldLight
    context.lineWidth = 3
    context.stroke()
    // Name round the top (shortened to its first words when it would run under the ribbon), stars round the bottom.
    const { text: name, size: nameSize } = sealName(context, provider, radius * 0.75, radius)
    arcText(context, name, centreX, centreY, radius * 0.75, nameSize, palette.goldLight)
    arcText(context, '★ ★ ★', centreX, centreY, radius * 0.75, Math.round(radius * 0.12), palette.goldLight, true)
    // The COMPLETED ribbon.
    const ribbonWidth = radius * 1.9
    const ribbonHeight = radius * 0.36
    context.fillStyle = palette.gold
    context.beginPath()
    context.moveTo(centreX - ribbonWidth / 2 - 18, centreY - ribbonHeight / 2 + 8)
    context.lineTo(centreX - ribbonWidth / 2, centreY - ribbonHeight / 2)
    context.lineTo(centreX + ribbonWidth / 2, centreY - ribbonHeight / 2)
    context.lineTo(centreX + ribbonWidth / 2 + 18, centreY - ribbonHeight / 2 + 8)
    context.lineTo(centreX + ribbonWidth / 2 + 18, centreY + ribbonHeight / 2 + 8)
    context.lineTo(centreX + ribbonWidth / 2, centreY + ribbonHeight / 2)
    context.lineTo(centreX - ribbonWidth / 2, centreY + ribbonHeight / 2)
    context.lineTo(centreX - ribbonWidth / 2 - 18, centreY + ribbonHeight / 2 + 8)
    context.closePath()
    context.fill()
    const ribbon = context.createLinearGradient(0, centreY - ribbonHeight / 2, 0, centreY + ribbonHeight / 2)
    ribbon.addColorStop(0, palette.goldLight)
    ribbon.addColorStop(1, palette.gold)
    context.fillStyle = ribbon
    context.fillRect(centreX - ribbonWidth / 2, centreY - ribbonHeight / 2, ribbonWidth, ribbonHeight)
    context.restore()
    writeText(context, 'COMPLETED', centreX, centreY + ribbonHeight * 0.3, Math.round(radius * 0.25), { family: SERIF, weight: 'bold', colour: palette.dark, maxWidth: ribbonWidth - 24, spacing: 3 })
}

/**
 * Draws a certificate of completion (A4 landscape) in the company's colours: the frame and swooshes, its logo at the
 * top and faded behind the text, the learner and course, the date, the seal and the signature, and the number and QR
 * code anyone can use to check it.
 */
export const drawCertificate = async (certificate: TrainingCertificate, verifyUrl: string, qrCode: HTMLCanvasElement | null) => {
    const canvas = document.createElement('canvas')
    canvas.width = WIDTH
    canvas.height = HEIGHT
    const context = canvas.getContext('2d')
    if (!context) throw new Error('canvas_unavailable')
    const [logo, partnerLogo, signature] = await Promise.all([
        loadImage(certificate.logoUrl),
        loadImage(certificate.partnerLogoUrl),
        loadImage(certificate.signatureUrl),
    ])
    const palette = paletteOf(logo)
    const centre = WIDTH / 2

    // Plain white paper, so a logo saved on a white background sits on it without a box around it.
    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, WIDTH, HEIGHT)
    // The logo, large and faded, behind the text.
    if (logo) {
        context.save()
        context.globalAlpha = 0.06
        drawFitted(context, logo, centre, 420, 1500, 900)
        context.restore()
    }

    drawFrame(context, palette)
    drawSwooshes(context, palette)
    context.save()
    context.translate(WIDTH, HEIGHT)
    context.rotate(Math.PI)
    drawSwooshes(context, palette)
    context.restore()

    // Logo(s) at the top.
    if (logo && partnerLogo) {
        drawFitted(context, logo, centre - 290, 95, 500, 250)
        drawFitted(context, partnerLogo, centre + 290, 95, 500, 250)
    } else if (logo) {
        drawFitted(context, logo, centre, 95, 640, 260)
    } else {
        writeText(context, certificate.providerName, centre, 260, 72, { family: SERIF, weight: 'bold', colour: palette.dark, maxWidth: 1300 })
    }

    writeText(context, 'CERTIFICATE', centre, 495, 158, { family: SERIF, weight: 'bold', colour: palette.dark, maxWidth: 1400, spacing: 6 })
    const ofWidth = writeText(context, 'OF COMPLETION', centre, 572, 56, { family: SERIF, colour: palette.mid, maxWidth: 900, spacing: 14 })
    line(context, centre - ofWidth / 2 - 300, 552, centre - ofWidth / 2 - 30, 552, palette.mid, 3)
    line(context, centre + ofWidth / 2 + 30, 552, centre + ofWidth / 2 + 300, 552, palette.mid, 3)
    writeText(context, 'THIS CERTIFICATE IS PROUDLY PRESENTED TO', centre, 648, 30, { weight: '600', colour: palette.ink, spacing: 6, maxWidth: 1300 })

    writeText(context, certificate.learnerName, centre, 770, 104, { family: SERIF, style: 'italic', weight: 'bold', colour: palette.dark, maxWidth: 1250 })
    line(context, centre - 620, 802, centre + 620, 802, palette.mid, 3)
    if (certificate.organisation) writeText(context, `of ${certificate.organisation}`, centre, 852, 34, { colour: palette.muted, maxWidth: 1200 })

    writeText(context, 'In recognition of the successful completion of', centre, 916, 38, { family: SERIF, colour: palette.ink, maxWidth: 1300 })
    writeText(context, certificate.courseTitle, centre, 992, 66, { family: SERIF, weight: 'bold', colour: palette.mid, maxWidth: 1400 })
    writeText(context, [certificate.trainingDates, certificate.deliveryLabel].filter(Boolean).join('  ·  '), centre, 1046, 32, { colour: palette.ink, maxWidth: 1400 })
    context.font = `normal normal 32px ${SERIF}`
    wrap(context, 'Your commitment, participation and dedication towards achieving the required learning outcomes are hereby acknowledged.', 1240)
        .forEach((text, index) => writeText(context, text, centre, 1102 + index * 42, 32, { family: SERIF, colour: palette.ink, maxWidth: 1300 }))
    context.font = `normal normal 22px ${SANS}`
    wrap(context, CERTIFICATE_STATEMENT, 1300).forEach((text, index) => writeText(context, text, centre, 1200 + index * 30, 22, { colour: palette.muted, maxWidth: 1400 }))

    // Bottom row: date of completion (left), the seal (centre), the signature (right).
    const lineY = 1418
    const dateCentre = 640
    const signCentre = WIDTH - 690
    writeText(context, dayjs(certificate.issuedOn).format('D MMMM YYYY'), dateCentre, lineY - 18, 36, { family: SERIF, weight: 'bold', colour: palette.ink, maxWidth: 480 })
    line(context, dateCentre - 230, lineY, dateCentre + 230, lineY, palette.ink, 2.5)
    writeText(context, 'Date of Completion', dateCentre, lineY + 44, 28, { family: SERIF, colour: palette.muted, maxWidth: 460 })

    drawSeal(context, palette, centre, 1385, 132, certificate.providerName)

    if (signature) drawFitted(context, signature, signCentre, lineY - 140, 400, 130)
    line(context, signCentre - 230, lineY, signCentre + 230, lineY, palette.ink, 2.5)
    writeText(context, 'Authorised Signature', signCentre, lineY + 44, 28, { family: SERIF, colour: palette.muted, maxWidth: 460 })
    writeText(context, `${certificate.signatoryName || certificate.providerName}, Facilitator`, signCentre, lineY + 84, 24, { weight: '600', colour: palette.ink, maxWidth: 520 })

    // Bottom left: the QR code and number anyone can use to check the certificate.
    const qrSize = 150
    const qrLeft = 120
    const qrTop = HEIGHT - 120 - qrSize - 96
    if (qrCode) context.drawImage(qrCode, qrLeft, qrTop, qrSize, qrSize)
    writeText(context, 'Scan to verify', qrLeft + qrSize / 2, qrTop + qrSize + 26, 20, { colour: palette.muted, maxWidth: 220 })
    writeText(context, `Certificate No.: ${certificate.certificateNumber}`, qrLeft, HEIGHT - 132, 26, { weight: 'bold', colour: palette.dark, align: 'left', maxWidth: 560 })
    writeText(context, verifyUrl.replace(/^https?:\/\//, ''), qrLeft, HEIGHT - 100, 18, { colour: palette.muted, align: 'left', maxWidth: 640 })

    return canvas
}

const encoder = new TextEncoder()

/** A PDF text string in UTF-16 with a byte-order mark, so names in any script survive in the document title. */
const pdfTextString = (value: string) =>
    `<FEFF${Array.from(value).flatMap((character) => {
        const code = character.codePointAt(0) ?? 0
        if (code <= 0xffff) return [code]
        const offset = code - 0x10000
        return [0xd800 + (offset >> 10), 0xdc00 + (offset & 0x3ff)]
    }).map((unit) => unit.toString(16).padStart(4, '0')).join('').toUpperCase()}>`

/** Wraps one JPEG as a single full-page PDF. */
export const jpegToPdf = (jpeg: Uint8Array, imageWidth: number, imageHeight: number, title: string) => {
    const chunks: Uint8Array[] = []
    const offsets: number[] = []
    let length = 0
    const push = (chunk: string | Uint8Array) => {
        const bytes = typeof chunk === 'string' ? encoder.encode(chunk) : chunk
        chunks.push(bytes)
        length += bytes.length
    }
    const object = (id: number, dictionary: string, stream?: Uint8Array) => {
        offsets[id] = length
        push(`${id} 0 obj\n${dictionary}\n`)
        if (stream) {
            push('stream\n')
            push(stream)
            push('\nendstream\n')
        }
        push('endobj\n')
    }

    const content = encoder.encode(`q\n${PAGE_WIDTH_PT} 0 0 ${PAGE_HEIGHT_PT} 0 0 cm\n/Im0 Do\nQ\n`)
    push('%PDF-1.4\n')
    push(new Uint8Array([0x25, 0xe2, 0xe3, 0xcf, 0xd3, 0x0a]))
    object(1, '<< /Type /Catalog /Pages 2 0 R >>')
    object(2, '<< /Type /Pages /Kids [3 0 R] /Count 1 >>')
    object(3, `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH_PT} ${PAGE_HEIGHT_PT}] /Resources << /XObject << /Im0 4 0 R >> >> /Contents 5 0 R >>`)
    object(4, `<< /Type /XObject /Subtype /Image /Width ${imageWidth} /Height ${imageHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${jpeg.length} >>`, jpeg)
    object(5, `<< /Length ${content.length} >>`, content)
    object(6, `<< /Title ${pdfTextString(title)} /Producer (Smartinc) >>`)

    const xrefOffset = length
    push(`xref\n0 7\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, '0')} 00000 n \n`).join('')}`)
    push(`trailer\n<< /Size 7 /Root 1 0 R /Info 6 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`)

    const pdf = new Uint8Array(length)
    let position = 0
    chunks.forEach((chunk) => {
        pdf.set(chunk, position)
        position += chunk.length
    })
    return pdf
}

const canvasToJpeg = (canvas: HTMLCanvasElement) => new Promise<Uint8Array>((resolve, reject) => {
    canvas.toBlob((blob) => {
        if (!blob) {
            reject(new Error('jpeg_failed'))
            return
        }
        void blob.arrayBuffer().then((buffer) => resolve(new Uint8Array(buffer)), reject)
    }, 'image/jpeg', 0.92)
})

/** Builds the certificate PDF and downloads it. */
export const downloadCertificatePdf = async (certificate: TrainingCertificate, verifyUrl: string, qrCode: HTMLCanvasElement | null) => {
    const canvas = await drawCertificate(certificate, verifyUrl, qrCode)
    const pdf = jpegToPdf(await canvasToJpeg(canvas), canvas.width, canvas.height, `Certificate ${certificate.certificateNumber} - ${certificate.learnerName}`)
    const url = URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' }))
    const link = document.createElement('a')
    link.href = url
    link.download = `Certificate ${certificate.certificateNumber} - ${certificate.learnerName}.pdf`.replace(/[\\/:*?"<>|]+/g, '-')
    document.body.appendChild(link)
    link.click()
    link.remove()
    window.setTimeout(() => URL.revokeObjectURL(url), 30_000)
}

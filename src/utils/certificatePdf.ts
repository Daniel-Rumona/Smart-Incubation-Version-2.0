import dayjs from 'dayjs'
import type { TrainingCertificate } from '@/types/training'

/**
 * Draws a certificate of completion (A4 landscape) and saves it as a one-page PDF.
 *
 * The page is drawn on a canvas at about 200 dpi and embedded in a minimal PDF as a JPEG, so no PDF library is
 * needed. Logos and the signature are fetched like the agreement documents' images: if the storage bucket's CORS
 * settings do not allow this site they are left out and the certificate is still produced.
 */

const WIDTH = 2339
const HEIGHT = 1654
const PAGE_WIDTH_PT = 842
const PAGE_HEIGHT_PT = 595

const ACCENT = '#2f6b2f'
const ACCENT_LIGHT = '#8dbf45'
const INK = '#1f2a30'
const MUTED = '#5b6770'
const SERIF = 'Georgia, "Times New Roman", serif'
const SANS = '"Segoe UI", Helvetica, Arial, sans-serif'

export const CERTIFICATE_STATEMENT = 'Awareness training, non-credit-bearing. Completion is based on participation and internal assessment; it is not a formal occupational qualification.'

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

/** Draws `image` centred in the box, as large as fits without changing its proportions. */
const drawFitted = (context: CanvasRenderingContext2D, image: CanvasImageSource & { width: number, height: number }, centreX: number, top: number, maxWidth: number, maxHeight: number) => {
    const scale = Math.min(maxWidth / image.width, maxHeight / image.height, 1.6)
    const width = image.width * scale
    const height = image.height * scale
    context.drawImage(image, centreX - width / 2, top + (maxHeight - height) / 2, width, height)
}

/** Writes centred text, shrinking it until it fits `maxWidth`. */
const centredText = (context: CanvasRenderingContext2D, value: string, x: number, y: number, size: number, options: { family?: string, weight?: string, style?: string, colour?: string, maxWidth?: number } = {}) => {
    const { family = SANS, weight = 'normal', style = 'normal', colour = INK, maxWidth = WIDTH - 500 } = options
    let fontSize = size
    do {
        context.font = `${style} ${weight} ${fontSize}px ${family}`
        if (context.measureText(value).width <= maxWidth) break
        fontSize -= 2
    } while (fontSize > 16)
    context.fillStyle = colour
    context.textAlign = 'center'
    context.fillText(value, x, y)
}

/** Splits text into lines no wider than `maxWidth` at the current font. */
const wrap = (context: CanvasRenderingContext2D, value: string, maxWidth: number) => value.split(' ').reduce<string[]>((lines, word) => {
    const last = lines[lines.length - 1]
    if (last !== undefined && context.measureText(`${last} ${word}`).width <= maxWidth) lines[lines.length - 1] = `${last} ${word}`
    else lines.push(word)
    return lines
}, [])

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

    context.fillStyle = '#ffffff'
    context.fillRect(0, 0, WIDTH, HEIGHT)
    context.strokeStyle = ACCENT
    context.lineWidth = 18
    context.strokeRect(60, 60, WIDTH - 120, HEIGHT - 120)
    context.strokeStyle = ACCENT_LIGHT
    context.lineWidth = 4
    context.strokeRect(104, 104, WIDTH - 208, HEIGHT - 208)

    const centre = WIDTH / 2
    if (logo && partnerLogo) {
        drawFitted(context, logo, centre - 300, 140, 480, 230)
        drawFitted(context, partnerLogo, centre + 300, 140, 480, 230)
    } else if (logo) {
        drawFitted(context, logo, centre, 140, 560, 230)
    } else {
        centredText(context, certificate.providerName, centre, 280, 64, { family: SERIF, weight: 'bold', colour: ACCENT })
    }

    centredText(context, 'CERTIFICATE OF COMPLETION', centre, 470, 92, { family: SERIF, weight: 'bold', colour: ACCENT })
    centredText(context, 'This certifies that', centre, 555, 42, { colour: MUTED })
    centredText(context, certificate.learnerName, centre, 680, 112, { family: SERIF, style: 'italic', colour: INK, maxWidth: WIDTH - 700 })
    context.strokeStyle = ACCENT_LIGHT
    context.lineWidth = 3
    context.beginPath()
    context.moveTo(centre - 620, 720)
    context.lineTo(centre + 620, 720)
    context.stroke()
    if (certificate.organisation) centredText(context, `of ${certificate.organisation}`, centre, 785, 42, { colour: MUTED })
    centredText(context, 'has completed', centre, 850, 42, { colour: MUTED })
    centredText(context, certificate.courseTitle, centre, 940, 76, { family: SERIF, weight: 'bold', colour: ACCENT })
    centredText(context, [certificate.trainingDates, certificate.deliveryLabel].filter(Boolean).join('  ·  '), centre, 1010, 40, { colour: INK })

    context.font = `normal normal 30px ${SANS}`
    wrap(context, CERTIFICATE_STATEMENT, 1500).forEach((line, index) => centredText(context, line, centre, 1070 + index * 40, 30, { colour: MUTED }))

    // Bottom row, below the statement: signature (left), number and date (centre), verification (right).
    const signatureCentre = 500
    const lineY = HEIGHT - 294
    if (signature) drawFitted(context, signature, signatureCentre, lineY - 150, 420, 140)
    context.strokeStyle = INK
    context.lineWidth = 3
    context.beginPath()
    context.moveTo(signatureCentre - 260, lineY)
    context.lineTo(signatureCentre + 260, lineY)
    context.stroke()
    centredText(context, certificate.signatoryName || certificate.providerName, signatureCentre, lineY + 52, 36, { weight: 'bold', maxWidth: 560 })
    centredText(context, `Facilitator, ${certificate.providerName}`, signatureCentre, lineY + 98, 28, { colour: MUTED, maxWidth: 600 })

    // Number and date (centre)
    centredText(context, `Issued ${dayjs(certificate.issuedOn).format('D MMMM YYYY')}`, centre, lineY + 10, 34, { colour: INK })
    centredText(context, `Certificate no. ${certificate.certificateNumber}`, centre, lineY + 62, 34, { weight: 'bold', colour: ACCENT })

    // Verification (right)
    const qrSize = 250
    const qrCentre = WIDTH - 470
    if (qrCode) context.drawImage(qrCode, qrCentre - qrSize / 2, lineY - 210, qrSize, qrSize)
    centredText(context, 'Scan or visit to verify', qrCentre, lineY + 82, 28, { colour: MUTED, maxWidth: 520 })
    centredText(context, verifyUrl.replace(/^https?:\/\//, ''), qrCentre, lineY + 120, 22, { colour: MUTED, maxWidth: 560 })

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

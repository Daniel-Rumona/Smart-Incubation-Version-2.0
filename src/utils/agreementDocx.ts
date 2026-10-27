// Rebuilds a signed agreement as a Word document with the exact wording that was accepted: centred logo, organisation /
// programme / title in bold capitals, numbered sections with bullets, then the signature block. Ported from the earlier
// Incubation Platform. Loaded on demand (the docx library is large), so only people downloading pay for it.
import dayjs from 'dayjs'
import { getCompanyAgreement } from '@/config/agreements'
import type { SignedAgreement } from '@/services/agreementsService'

const FONT = 'Times New Roman'
const SIZE = 22 // half-points (11pt)
const BULLETS = 'agreement-bullets'

type AgreementImage = { dataUrl: string; width: number; height: number }

/**
 * An image as PNG bytes for embedding, or null when it can't be read (for example the storage bucket's CORS settings
 * don't allow this site); the document is still produced without it.
 */
const loadImage = async (url?: string | null, maxPx = 900): Promise<AgreementImage | null> => {
  if (!url) return null
  try {
    const response = await fetch(url)
    if (!response.ok) return null
    const blob = await response.blob()
    if (!blob.type.startsWith('image/')) return null
    const objectUrl = URL.createObjectURL(blob)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const element = new Image()
        element.onload = () => resolve(element)
        element.onerror = reject
        element.src = objectUrl
      })
      const scale = Math.min(1, maxPx / Math.max(img.naturalWidth || 1, img.naturalHeight || 1))
      const canvas = document.createElement('canvas')
      canvas.width = Math.max(1, Math.round(img.naturalWidth * scale))
      canvas.height = Math.max(1, Math.round(img.naturalHeight * scale))
      canvas.getContext('2d')!.drawImage(img, 0, 0, canvas.width, canvas.height)
      return { dataUrl: canvas.toDataURL('image/png'), width: canvas.width, height: canvas.height }
    } finally {
      URL.revokeObjectURL(objectUrl)
    }
  } catch {
    return null
  }
}

const imageBytes = (image: AgreementImage) => {
  const binary = atob(image.dataUrl.split(',')[1] || '')
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index++) bytes[index] = binary.charCodeAt(index)
  return bytes
}

// Fit an image inside maxW x maxH pixels, keeping its proportions.
const fit = (image: AgreementImage, maxW: number, maxH: number) => {
  const ratio = image.width / image.height
  let width = maxW
  let height = width / ratio
  if (height > maxH) {
    height = maxH
    width = height * ratio
  }
  return { width: Math.round(width), height: Math.round(height) }
}

export const agreementFileName = (record: SignedAgreement, extension: string) => {
  const who = String(record.beneficiarySnapshot?.businessName || record.beneficiarySnapshot?.fullName || 'participant')
    .trim()
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60) || 'participant'
  const what = record.agreementKey === 'company-consent' ? 'consent-form' : 'code-of-conduct'
  const when = record.acceptedAt ? dayjs(record.acceptedAt).format('YYYY-MM-DD') : 'unsigned'
  return `${who}-${what}-${when}.${extension}`
}

export const downloadAgreementDocx = async (
  record: SignedAgreement,
  options: { organisationName: string; programmeName?: string; fallbackBusinessName?: string; logoUrl?: string | null },
) => {
  const docx = await import('docx')
  const { AlignmentType, Document, Footer, ImageRun, LevelFormat, Packer, PageNumber, Paragraph, TextRun } = docx
  const [signature, logo] = await Promise.all([loadImage(record.signatureURL), loadImage(options.logoUrl, 400)])

  const text = (value: string, opts: { bold?: boolean; size?: number } = {}) =>
    new TextRun({ text: value, bold: opts.bold, font: FONT, size: opts.size ?? SIZE })
  const para = (children: InstanceType<typeof TextRun>[] | InstanceType<typeof TextRun>, opts: { center?: boolean; before?: number; after?: number } = {}) =>
    new Paragraph({
      children: Array.isArray(children) ? children : [children],
      alignment: opts.center ? AlignmentType.CENTER : AlignmentType.LEFT,
      spacing: { before: opts.before ?? 0, after: opts.after ?? 120 },
    })
  const bullet = (value: string) => new Paragraph({ children: [text(value)], numbering: { reference: BULLETS, level: 0 }, spacing: { after: 60 } })
  const field = (label: string, value: string) => para([text(`${label}: `, { bold: true }), text(value || '—')], { after: 80 })

  const { definition, isExactVersion } = getCompanyAgreement(record.agreementKey, record.version)
  const snapshot = record.beneficiarySnapshot || {}
  const signedAt = record.acceptedAt ? dayjs(record.acceptedAt) : null
  const email = String(record.acceptedByEmail || snapshot.email || '').trim()
  const businessName = String(snapshot.businessName || options.fallbackBusinessName || '').trim()
  const fullName = String(snapshot.fullName || '').trim()

  const children: InstanceType<typeof Paragraph>[] = []
  if (logo) {
    children.push(new Paragraph({
      alignment: AlignmentType.CENTER,
      spacing: { after: 200 },
      children: [new ImageRun({ type: 'png', data: imageBytes(logo), transformation: fit(logo, 192, 118) })],
    }))
  }
  children.push(para(text(options.organisationName.toUpperCase(), { bold: true }), { after: 60 }))
  if (options.programmeName) children.push(para(text(options.programmeName.toUpperCase(), { bold: true }), { after: 60 }))
  children.push(para(text(definition.title.toUpperCase(), { bold: true }), { after: 240 }))

  for (const section of definition.sections) {
    children.push(para(text(section.title, { bold: true }), { before: 160, after: 80 }))
    if (section.body) children.push(para(text(section.body)))
    for (const item of section.bullets || []) children.push(bullet(item))
  }

  children.push(para(text('Acknowledgement', { bold: true }), { before: 240, after: 80 }))
  children.push(para([text('I, '), text(fullName || businessName || email || '—', { bold: true }), text(', accepted the following declaration electronically:')]))
  children.push(bullet(definition.acceptLabel))
  children.push(new Paragraph({
    spacing: { before: 200, after: 80 },
    children: signature
      ? [text('Signature: ', { bold: true }), new ImageRun({ type: 'png', data: imageBytes(signature), transformation: fit(signature, 220, 70) })]
      : [text('Signature: ', { bold: true }), text(record.signatureURL ? 'Electronic signature on file' : 'Accepted electronically (no signature image on file)')],
  }))
  children.push(field('Full Name', fullName))
  if (businessName) children.push(field('Business Name', businessName))
  if (snapshot.idNumber) children.push(field('ID Number', String(snapshot.idNumber).trim()))
  children.push(field('Email', email))
  children.push(field('Date', signedAt ? signedAt.format('D MMMM YYYY, HH:mm') : 'Not recorded'))
  if (!isExactVersion) {
    children.push(para(text(`Note: the wording for agreement version "${record.version || 'unknown'}" is not on record, so the current wording is shown.`, { size: 18 }), { before: 200 }))
  }

  const small = (value: string) => text(value, { size: 14 })
  const footer = new Footer({
    children: [
      para(small(options.organisationName), { center: true, after: 0 }),
      new Paragraph({
        alignment: AlignmentType.CENTER,
        spacing: { before: 80, after: 0 },
        children: [
          small(`Reference: ${record.id}  |  Version: ${record.version || 'unknown'}  |  Page `),
          new TextRun({ children: [PageNumber.CURRENT], font: FONT, size: 14 }),
          small(' of '),
          new TextRun({ children: [PageNumber.TOTAL_PAGES], font: FONT, size: 14 }),
        ],
      }),
    ],
  })

  const document = new Document({
    creator: options.organisationName,
    title: definition.title,
    styles: { default: { document: { run: { font: FONT, size: SIZE } } } },
    numbering: {
      config: [{
        reference: BULLETS,
        levels: [{ level: 0, format: LevelFormat.BULLET, text: '•', alignment: AlignmentType.LEFT, style: { paragraph: { indent: { left: 720, hanging: 360 } } } }],
      }],
    },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 720, right: 720, bottom: 720, left: 720 } } },
      footers: { default: footer },
      children,
    }],
  })

  const blob = await Packer.toBlob(document)
  const link = window.document.createElement('a')
  link.href = URL.createObjectURL(blob)
  link.download = agreementFileName(record, 'docx')
  link.click()
  window.setTimeout(() => URL.revokeObjectURL(link.href), 1000)
  return { signatureEmbedded: Boolean(signature), logoEmbedded: Boolean(logo) }
}

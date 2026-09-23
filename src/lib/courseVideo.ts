/** Turns a YouTube/Vimeo watch link into its embeddable form; anything else is left as-is for a plain <video> tag. */
export const toEmbedVideoUrl = (url: string): { kind: 'youtube' | 'vimeo' | 'file', src: string } => {
    const trimmed = url.trim()

    const youtube = trimmed.match(/(?:youtu\.be\/|youtube\.com\/(?:watch\?v=|embed\/|shorts\/))([\w-]{6,})/)
    if (youtube) return { kind: 'youtube', src: `https://www.youtube.com/embed/${youtube[1]}` }

    const vimeo = trimmed.match(/vimeo\.com\/(?:video\/)?(\d+)/)
    if (vimeo) return { kind: 'vimeo', src: `https://player.vimeo.com/video/${vimeo[1]}` }

    return { kind: 'file', src: trimmed }
}

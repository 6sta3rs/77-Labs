export type WavPrecision = '16' | '24' | '32'
export type DecodedWave = { sampleRate: number; channels: number; frames: number; bits: number; float: boolean; samples: Float32Array }
const maximumWaveBytes = 512 * 1024 * 1024
const label = (view: DataView, offset: number) => String.fromCharCode(...new Uint8Array(view.buffer, view.byteOffset + offset, 4))

/** Read generated PCM/float WAV directly, preserving its rate and channels. */
export function decodeWave(buffer: ArrayBuffer): DecodedWave {
  const view = new DataView(buffer)
  if (buffer.byteLength < 44 || buffer.byteLength > maximumWaveBytes || label(view, 0) !== 'RIFF' || label(view, 8) !== 'WAVE') throw new Error('Silnik nie zwrócił obsługiwanego pliku WAV.')
  const declaredEnd = view.getUint32(4, true) + 8
  if (declaredEnd > buffer.byteLength || declaredEnd < 44) throw new Error('Nagranie WAV jest niekompletne.')
  let format: { tag: number; channels: number; sampleRate: number; bits: number; align: number } | undefined
  let dataOffset = -1, dataLength = 0
  for (let offset = 12; offset + 8 <= declaredEnd;) {
    const type = label(view, offset), length = view.getUint32(offset + 4, true), start = offset + 8
    if (start + length > declaredEnd) throw new Error('Nieprawidłowa długość fragmentu WAV.')
    if (type === 'fmt ') {
      if (length < 16) throw new Error('Brak pełnego opisu formatu WAV.')
      let tag = view.getUint16(start, true)
      if (tag === 0xfffe) {
        if (length < 40 || view.getUint16(start + 16, true) < 22) throw new Error('Niepełny format rozszerzony WAV.')
        tag = view.getUint16(start + 24, true)
      }
      format = { tag, channels: view.getUint16(start + 2, true), sampleRate: view.getUint32(start + 4, true), bits: view.getUint16(start + 14, true), align: view.getUint16(start + 12, true) }
    } else if (type === 'data' && dataOffset < 0) { dataOffset = start; dataLength = length }
    offset = start + length + length % 2
  }
  if (!format || dataOffset < 0 || !dataLength || ![1, 3].includes(format.tag) || ![16, 24, 32].includes(format.bits) || format.tag === 3 && format.bits !== 32 || !format.channels || format.channels > 8 || format.sampleRate < 8000 || format.sampleRate > 192000 || format.align !== format.channels * format.bits / 8 || dataLength % format.align) throw new Error('WAV ma nieobsługiwany lub nieprawidłowy format PCM/float.')
  const samples = new Float32Array(dataLength / (format.bits / 8))
  for (let index = 0, offset = dataOffset; index < samples.length; index++, offset += format.bits / 8) {
    let value: number
    if (format.tag === 3) value = view.getFloat32(offset, true)
    else if (format.bits === 16) value = view.getInt16(offset, true) / 32768
    else if (format.bits === 32) value = view.getInt32(offset, true) / 2147483648
    else { const raw = view.getUint8(offset) | view.getUint8(offset + 1) << 8 | view.getUint8(offset + 2) << 16; value = (raw & 0x800000 ? raw - 0x1000000 : raw) / 8388608 }
    if (!Number.isFinite(value)) throw new Error('Nagranie WAV zawiera nieprawidłowe próbki.')
    samples[index] = value
  }
  return { sampleRate: format.sampleRate, channels: format.channels, frames: samples.length / format.channels, bits: format.bits, float: format.tag === 3, samples }
}

/** 32 means IEEE float, matching upstream SoundFile FLOAT; never PCM32. */
export function encodeSpeechWave(parts: DecodedWave[], precision: WavPrecision, gapSeconds = 0.2): Blob {
  if (!parts.length || !['16', '24', '32'].includes(precision) || !Number.isFinite(gapSeconds) || gapSeconds < 0 || gapSeconds > 60) throw new Error('Nieprawidłowe ustawienia łączenia WAV.')
  const { channels, sampleRate } = parts[0]
  if (!Number.isSafeInteger(channels) || channels < 1 || channels > 8 || !Number.isSafeInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('Nieprawidłowa częstotliwość lub liczba kanałów WAV.')
  if (parts.some(part => part.channels !== channels || part.sampleRate !== sampleRate || part.samples.length !== part.frames * channels || !Number.isSafeInteger(part.frames) || part.frames < 1)) throw new Error('Fragmenty mają różne częstotliwości lub kanały. Wygeneruj je tym samym silnikiem przed połączeniem.')
  const gapFrames = Math.round(sampleRate * gapSeconds), frames = parts.reduce((sum, part) => sum + part.frames, 0) + gapFrames * (parts.length - 1)
  const bits = Number(precision), bytesPerSample = bits / 8, floating = precision === '32', headerLength = floating ? 56 : 44
  const dataLength = frames * channels * bytesPerSample
  if (!Number.isSafeInteger(dataLength) || dataLength + headerLength > maximumWaveBytes) throw new Error('Połączone nagranie przekracza limit 512 MB. Zapisz krótsze części.')
  const pad = dataLength % 2, bytes = new ArrayBuffer(headerLength + dataLength + pad), view = new DataView(bytes)
  const ascii = (offset: number, text: string) => [...text].forEach((char, index) => view.setUint8(offset + index, char.charCodeAt(0)))
  ascii(0, 'RIFF'); view.setUint32(4, bytes.byteLength - 8, true); ascii(8, 'WAVE'); ascii(12, 'fmt '); view.setUint32(16, 16, true)
  view.setUint16(20, floating ? 3 : 1, true); view.setUint16(22, channels, true); view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * channels * bytesPerSample, true); view.setUint16(32, channels * bytesPerSample, true); view.setUint16(34, bits, true)
  if (floating) { ascii(36, 'fact'); view.setUint32(40, 4, true); view.setUint32(44, frames, true) }
  ascii(headerLength - 8, 'data'); view.setUint32(headerLength - 4, dataLength, true)
  let offset = headerLength
  parts.forEach((part, partIndex) => {
    for (const sample of part.samples) {
      if (!Number.isFinite(sample)) throw new Error('Nagranie zawiera nieprawidłowe próbki; nie zapisano pliku.')
      if (floating) view.setFloat32(offset, sample, true)
      else {
        const safe = Math.max(-1, Math.min(1, sample))
        if (precision === '16') view.setInt16(offset, Math.max(-32768, Math.min(32767, Math.round(safe * 32768))), true)
        else { const value = Math.max(-8388608, Math.min(8388607, Math.round(safe * 8388608))); view.setUint8(offset, value & 255); view.setUint8(offset + 1, value >> 8 & 255); view.setUint8(offset + 2, value >> 16 & 255) }
      }
      offset += bytesPerSample
    }
    if (partIndex < parts.length - 1) offset += gapFrames * channels * bytesPerSample
  })
  return new Blob([bytes], { type: 'audio/wav' })
}

/** Assemble generated takes without changing rate/channels or selected precision. */
export async function joinSpeech(blobs: Blob[], precision?: WavPrecision): Promise<Blob> {
  if (!blobs.length) throw new Error('Brak nagrań do połączenia.')
  if (blobs.reduce((total, blob) => total + blob.size, 0) > maximumWaveBytes) throw new Error('Nagrania do połączenia przekraczają limit 512 MB.')
  if (blobs.length === 1 && precision === undefined) return blobs[0]
  const parts = await Promise.all(blobs.map(async blob => decodeWave(await blob.arrayBuffer())))
  const selected = precision ?? (parts[0].float ? '32' : parts[0].bits === 24 ? '24' : '16')
  if (blobs.length === 1 && parts[0].bits === Number(selected) && parts[0].float === (selected === '32')) return blobs[0]
  return encodeSpeechWave(parts, selected)
}

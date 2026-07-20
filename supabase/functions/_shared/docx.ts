// Bounded, hardened DOCX text extraction for resume ingestion (Codex F-docx-safety;
// T-3-08b). The uploaded archive is untrusted user input, so every path guards
// against zip bombs, oversized XML, and non-DOCX bytes BEFORE any content reaches
// OpenAI. Format is decided from magic bytes, never the filename (the storage
// bucket accepts both DOCX and PDF — the filename is not a trust boundary).
//
// Primary path is mammoth (battle-tested text fidelity); the jszip + <w:t> regex
// fallback exists because DOMParser is not global in the Deno edge runtime
// (RESEARCH Pitfall 7). Extracted text is always truncated to MAX_EXTRACT_CHARS
// so a huge résumé cannot blow the OpenAI prompt/token budget.

export const MAX_UNCOMPRESSED_BYTES = 20 * 1024 * 1024 // 20 MB
export const MAX_ZIP_ENTRIES = 512
export const MAX_DOCUMENT_XML_BYTES = 10 * 1024 * 1024 // 10 MB
export const MAX_EXTRACT_CHARS = 200_000
export const MAX_ARCHIVE_BYTES = 10 * 1024 * 1024 // 10 MB

const LOCAL_FILE_HEADER = 0x04034b50
const CENTRAL_DIRECTORY_HEADER = 0x02014b50
const END_OF_CENTRAL_DIRECTORY = 0x06054b50
const MAX_ZIP_COMMENT_BYTES = 0xffff

// Magic-byte format detection. DOCX is a zip (PK\x03\x04); PDF is %PDF.
export function detectFormat(bytes: ArrayBuffer): 'docx' | 'pdf' | 'unknown' {
  const head = new Uint8Array(bytes.slice(0, 4))
  if (head.length < 4) return 'unknown'
  if (head[0] === 0x50 && head[1] === 0x4b && head[2] === 0x03 && head[3] === 0x04) {
    return 'docx'
  }
  if (head[0] === 0x25 && head[1] === 0x50 && head[2] === 0x44 && head[3] === 0x46) {
    return 'pdf'
  }
  return 'unknown'
}

function truncate(text: string): string {
  return text.length > MAX_EXTRACT_CHARS ? text.slice(0, MAX_EXTRACT_CHARS) : text
}

function decodeXmlEntities(value: string): string {
  return value
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(parseInt(dec, 10)))
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

interface MammothModule {
  extractRawText?: (opts: { arrayBuffer: ArrayBuffer }) => Promise<{ value: string }>
  default?: { extractRawText?: MammothModule['extractRawText'] }
}

interface JsZipEntry {
  async: (type: 'string') => Promise<string>
}

interface JsZipInstance {
  files: Record<string, JsZipEntry>
  file: (path: string) => JsZipEntry | null
  loadAsync: (data: ArrayBuffer) => Promise<JsZipInstance>
}

type JsZipCtor = new () => JsZipInstance

interface JsZipModule {
  default?: JsZipCtor
}

interface ZipEntryMetadata {
  name: string
  flags: number
  compressionMethod: number
  compressedSize: number
  uncompressedSize: number
  localHeaderOffset: number
  dataOffset: number
}

function malformedArchive(): never {
  throw new Error('docx_extract_failed')
}

function findEndOfCentralDirectory(view: DataView): number {
  if (view.byteLength < 22) return malformedArchive()
  const lowerBound = Math.max(0, view.byteLength - 22 - MAX_ZIP_COMMENT_BYTES)
  for (let offset = view.byteLength - 22; offset >= lowerBound; offset -= 1) {
    if (view.getUint32(offset, true) !== END_OF_CENTRAL_DIRECTORY) continue
    const commentLength = view.getUint16(offset + 20, true)
    if (offset + 22 + commentLength === view.byteLength) return offset
  }
  return malformedArchive()
}

function parseZipEntries(bytes: ArrayBuffer): ZipEntryMetadata[] {
  if (bytes.byteLength > MAX_ARCHIVE_BYTES) throw new Error('docx_uncompressed_too_large')
  const view = new DataView(bytes)
  const endOffset = findEndOfCentralDirectory(view)
  const diskNumber = view.getUint16(endOffset + 4, true)
  const centralDisk = view.getUint16(endOffset + 6, true)
  const entriesOnDisk = view.getUint16(endOffset + 8, true)
  const entryCount = view.getUint16(endOffset + 10, true)
  const centralSize = view.getUint32(endOffset + 12, true)
  const centralOffset = view.getUint32(endOffset + 16, true)

  if (diskNumber !== 0 || centralDisk !== 0 || entriesOnDisk !== entryCount) {
    return malformedArchive()
  }
  if (
    entryCount === 0xffff ||
    centralSize === 0xffffffff ||
    centralOffset === 0xffffffff
  ) {
    throw new Error('docx_zip64_unsupported')
  }
  if (entryCount > MAX_ZIP_ENTRIES) throw new Error('docx_too_many_entries')
  if (centralOffset + centralSize !== endOffset) return malformedArchive()

  const decoder = new TextDecoder('utf-8', { fatal: true })
  const archiveBytes = new Uint8Array(bytes)
  const entries: ZipEntryMetadata[] = []
  let cursor = centralOffset
  let declaredTotal = 0
  let documentCount = 0

  for (let index = 0; index < entryCount; index += 1) {
    if (cursor + 46 > endOffset || view.getUint32(cursor, true) !== CENTRAL_DIRECTORY_HEADER) {
      return malformedArchive()
    }
    const flags = view.getUint16(cursor + 8, true)
    const compressionMethod = view.getUint16(cursor + 10, true)
    const compressedSize = view.getUint32(cursor + 20, true)
    const uncompressedSize = view.getUint32(cursor + 24, true)
    const nameLength = view.getUint16(cursor + 28, true)
    const extraLength = view.getUint16(cursor + 30, true)
    const commentLength = view.getUint16(cursor + 32, true)
    const localHeaderOffset = view.getUint32(cursor + 42, true)
    const entryEnd = cursor + 46 + nameLength + extraLength + commentLength

    if (entryEnd > endOffset) return malformedArchive()
    if (
      compressedSize === 0xffffffff ||
      uncompressedSize === 0xffffffff ||
      localHeaderOffset === 0xffffffff
    ) {
      throw new Error('docx_zip64_unsupported')
    }
    if ((flags & 0x0001) !== 0) throw new Error('docx_encrypted_unsupported')
    if (compressionMethod !== 0 && compressionMethod !== 8) {
      throw new Error('docx_compression_unsupported')
    }

    let name: string
    try {
      name = decoder.decode(archiveBytes.subarray(cursor + 46, cursor + 46 + nameLength))
    } catch {
      return malformedArchive()
    }
    if (!name || name.startsWith('/') || name.includes('\\') || name.split('/').includes('..')) {
      return malformedArchive()
    }

    if (localHeaderOffset + 30 > centralOffset) return malformedArchive()
    if (view.getUint32(localHeaderOffset, true) !== LOCAL_FILE_HEADER) return malformedArchive()
    const localFlags = view.getUint16(localHeaderOffset + 6, true)
    const localCompression = view.getUint16(localHeaderOffset + 8, true)
    const localCompressedSize = view.getUint32(localHeaderOffset + 18, true)
    const localUncompressedSize = view.getUint32(localHeaderOffset + 22, true)
    const localNameLength = view.getUint16(localHeaderOffset + 26, true)
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true)
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength
    if (localFlags !== flags || localCompression !== compressionMethod) return malformedArchive()
    let localName: string
    try {
      localName = decoder.decode(
        archiveBytes.subarray(localHeaderOffset + 30, localHeaderOffset + 30 + localNameLength),
      )
    } catch {
      return malformedArchive()
    }
    if (localName !== name) return malformedArchive()
    if (
      (flags & 0x0008) === 0 &&
      (localCompressedSize !== compressedSize || localUncompressedSize !== uncompressedSize)
    ) {
      throw new Error('docx_size_mismatch')
    }
    if (dataOffset + compressedSize > centralOffset) return malformedArchive()

    declaredTotal += uncompressedSize
    if (declaredTotal > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('docx_uncompressed_too_large')
    }
    if (name === 'word/document.xml') {
      documentCount += 1
      if (uncompressedSize > MAX_DOCUMENT_XML_BYTES) throw new Error('docx_xml_too_large')
    }
    entries.push({
      name,
      flags,
      compressionMethod,
      compressedSize,
      uncompressedSize,
      localHeaderOffset,
      dataOffset,
    })
    cursor = entryEnd
  }

  if (cursor !== endOffset || documentCount !== 1) return malformedArchive()
  return entries
}

async function measureInflatedEntry(bytes: ArrayBuffer, entry: ZipEntryMetadata): Promise<number> {
  if (entry.compressionMethod === 0) {
    if (entry.compressedSize !== entry.uncompressedSize) throw new Error('docx_size_mismatch')
    return entry.uncompressedSize
  }

  const compressed = bytes.slice(entry.dataOffset, entry.dataOffset + entry.compressedSize)
  let reader: ReadableStreamDefaultReader<Uint8Array>
  try {
    reader = new Blob([compressed])
      .stream()
      .pipeThrough(new DecompressionStream('deflate-raw'))
      .getReader()
  } catch {
    throw new Error('docx_extract_failed')
  }

  let actualSize = 0
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      actualSize += value.byteLength
      if (entry.name === 'word/document.xml' && actualSize > MAX_DOCUMENT_XML_BYTES) {
        await reader.cancel()
        throw new Error('docx_xml_too_large')
      }
      if (actualSize > MAX_UNCOMPRESSED_BYTES) {
        await reader.cancel()
        throw new Error('docx_uncompressed_too_large')
      }
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith('docx_')) throw error
    throw new Error('docx_extract_failed')
  }

  if (actualSize !== entry.uncompressedSize) throw new Error('docx_size_mismatch')
  return actualSize
}

// Parse and bounded-stream-decompress every entry before Mammoth sees any bytes.
// ZIP headers are untrusted, so declared sizes are verified against actual output.
export async function preflightDocxArchive(bytes: ArrayBuffer): Promise<void> {
  const entries = parseZipEntries(bytes)
  let actualTotal = 0
  for (const entry of entries) {
    actualTotal += await measureInflatedEntry(bytes, entry)
    if (actualTotal > MAX_UNCOMPRESSED_BYTES) {
      throw new Error('docx_uncompressed_too_large')
    }
  }
}

async function extractViaMammoth(bytes: ArrayBuffer): Promise<string> {
  const mod = (await import(/* @vite-ignore */ 'npm:mammoth@1.12.0')) as MammothModule
  const extractRawText = mod.extractRawText ?? mod.default?.extractRawText
  if (!extractRawText) throw new Error('mammoth_unavailable')
  const { value } = await extractRawText({ arrayBuffer: bytes })
  return value
}

// jszip fallback. The archive has already passed bounded streaming preflight.
async function extractViaJsZip(bytes: ArrayBuffer): Promise<string> {
  const mod = (await import(/* @vite-ignore */ 'npm:jszip@3.10.1')) as JsZipModule
  const JsZip = mod.default
  if (!JsZip) throw new Error('jszip_unavailable')
  const zip = await new JsZip().loadAsync(bytes)

  const documentEntry = zip.file('word/document.xml')
  if (!documentEntry) throw new Error('docx_extract_failed')
  const xml = await documentEntry.async('string')
  if (new TextEncoder().encode(xml).byteLength > MAX_DOCUMENT_XML_BYTES) {
    throw new Error('docx_xml_too_large')
  }

  const runs: string[] = []
  for (const match of xml.matchAll(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g)) {
    runs.push(decodeXmlEntities(match[1]))
  }
  return runs.join(' ')
}

// Extract raw resume text from DOCX bytes. mammoth primary, jszip fallback; both
// results truncated to MAX_EXTRACT_CHARS. Bounded-code errors from the guard
// paths (docx_too_many_entries, docx_uncompressed_too_large, docx_xml_too_large)
// propagate unchanged; any other double failure surfaces as docx_extract_failed.
export async function extractDocxText(bytes: ArrayBuffer): Promise<string> {
  await preflightDocxArchive(bytes)

  try {
    return truncate(await extractViaMammoth(bytes))
  } catch {
    // mammoth failed (import or runtime) — fall through to the guarded jszip path.
  }

  try {
    return truncate(await extractViaJsZip(bytes))
  } catch (error) {
    const code = error instanceof Error ? error.message : ''
    if (
      code === 'docx_too_many_entries' ||
      code === 'docx_uncompressed_too_large' ||
      code === 'docx_xml_too_large'
    ) {
      throw error
    }
    throw new Error('docx_extract_failed')
  }
}

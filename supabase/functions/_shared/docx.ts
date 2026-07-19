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
  _data?: { uncompressedSize?: number }
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

async function extractViaMammoth(bytes: ArrayBuffer): Promise<string> {
  const mod = (await import(/* @vite-ignore */ 'npm:mammoth@1.12.0')) as MammothModule
  const extractRawText = mod.extractRawText ?? mod.default?.extractRawText
  if (!extractRawText) throw new Error('mammoth_unavailable')
  const { value } = await extractRawText({ arrayBuffer: bytes })
  return value
}

// jszip fallback with zip-bomb guards enforced BEFORE reading document content.
async function extractViaJsZip(bytes: ArrayBuffer): Promise<string> {
  const mod = (await import(/* @vite-ignore */ 'npm:jszip@3.10.1')) as JsZipModule
  const JsZip = mod.default
  if (!JsZip) throw new Error('jszip_unavailable')
  const zip = await new JsZip().loadAsync(bytes)

  const entries = Object.values(zip.files)
  if (entries.length > MAX_ZIP_ENTRIES) throw new Error('docx_too_many_entries')

  let totalUncompressed = 0
  for (const entry of entries) {
    totalUncompressed += entry._data?.uncompressedSize ?? 0
  }
  if (totalUncompressed > MAX_UNCOMPRESSED_BYTES) {
    throw new Error('docx_uncompressed_too_large')
  }

  const documentEntry = zip.file('word/document.xml')
  if (!documentEntry) throw new Error('docx_extract_failed')
  const xml = await documentEntry.async('string')
  if (xml.length > MAX_DOCUMENT_XML_BYTES) throw new Error('docx_xml_too_large')

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

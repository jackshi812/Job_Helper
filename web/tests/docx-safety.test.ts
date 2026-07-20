import { deflateRawSync } from 'node:zlib'
import { describe, expect, it } from 'vitest'

import {
  MAX_DOCUMENT_XML_BYTES,
  MAX_ZIP_ENTRIES,
  preflightDocxArchive,
} from '../../supabase/functions/_shared/docx.ts'

interface ZipFixtureEntry {
  name: string
  content: Uint8Array
  declaredSize?: number
}

function zipFixture(entries: ZipFixtureEntry[]): ArrayBuffer {
  const localParts: Buffer[] = []
  const centralParts: Buffer[] = []
  let localOffset = 0

  for (const entry of entries) {
    const name = Buffer.from(entry.name)
    const content = Buffer.from(entry.content)
    const compressed = deflateRawSync(content)
    const declaredSize = entry.declaredSize ?? content.byteLength

    const local = Buffer.alloc(30)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4)
    local.writeUInt16LE(0x0800, 6)
    local.writeUInt16LE(8, 8)
    local.writeUInt32LE(compressed.byteLength, 18)
    local.writeUInt32LE(declaredSize, 22)
    local.writeUInt16LE(name.byteLength, 26)
    localParts.push(local, name, compressed)

    const central = Buffer.alloc(46)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4)
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0x0800, 8)
    central.writeUInt16LE(8, 10)
    central.writeUInt32LE(compressed.byteLength, 20)
    central.writeUInt32LE(declaredSize, 24)
    central.writeUInt16LE(name.byteLength, 28)
    central.writeUInt32LE(localOffset, 42)
    centralParts.push(central, name)

    localOffset += local.byteLength + name.byteLength + compressed.byteLength
  }

  const centralDirectory = Buffer.concat(centralParts)
  const end = Buffer.alloc(22)
  end.writeUInt32LE(0x06054b50, 0)
  end.writeUInt16LE(entries.length, 8)
  end.writeUInt16LE(entries.length, 10)
  end.writeUInt32LE(centralDirectory.byteLength, 12)
  end.writeUInt32LE(localOffset, 16)

  const archive = Buffer.concat([...localParts, centralDirectory, end])
  return archive.buffer.slice(archive.byteOffset, archive.byteOffset + archive.byteLength)
}

describe('DOCX archive preflight', () => {
  it('accepts a bounded archive after measuring actual decompressed bytes', async () => {
    const archive = zipFixture([
      {
        name: 'word/document.xml',
        content: Buffer.from('<w:document><w:t>Resume</w:t></w:document>'),
      },
    ])

    await expect(preflightDocxArchive(archive)).resolves.toBeUndefined()
  })

  it('rejects an actual high-ratio expansion even when headers claim a small size', async () => {
    const archive = zipFixture([
      {
        name: 'word/document.xml',
        content: Buffer.alloc(MAX_DOCUMENT_XML_BYTES + 1, 0x41),
        declaredSize: 1,
      },
    ])

    await expect(preflightDocxArchive(archive)).rejects.toThrow('docx_xml_too_large')
  })

  it('rejects unknown ZIP64 sizes rather than treating them as zero', async () => {
    const archive = zipFixture([
      {
        name: 'word/document.xml',
        content: Buffer.from('<w:document/>'),
        declaredSize: 0xffffffff,
      },
    ])

    await expect(preflightDocxArchive(archive)).rejects.toThrow('docx_zip64_unsupported')
  })

  it('rejects excessive entry counts before expanding any entry', async () => {
    const entries = Array.from({ length: MAX_ZIP_ENTRIES + 1 }, (_, index) => ({
      name: `word/item-${index}.xml`,
      content: new Uint8Array(),
    }))

    await expect(preflightDocxArchive(zipFixture(entries))).rejects.toThrow(
      'docx_too_many_entries',
    )
  })
})

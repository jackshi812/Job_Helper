import { supabase } from './supabase'

const RESUME_COLUMNS = 'id, filename, display_name, storage_path, size_bytes, created_at'

const CONTENT_TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
} as const

export interface ResumeRecord {
  id: string
  filename: string
  /** Optional user-chosen label. Cosmetic only — never the file identity. */
  display_name: string | null
  storage_path: string
  size_bytes: number | null
  created_at: string
}

export interface DeleteResumeInput {
  id: string
  storagePath: string
}

function allowedExtension(filename: string): keyof typeof CONTENT_TYPES {
  const extension = filename.split('.').pop()?.toLowerCase()
  if (extension !== 'docx' && extension !== 'pdf') {
    throw new Error('Only DOCX and PDF files are allowed')
  }
  return extension
}

/**
 * The single render helper for naming a resume in the UI. Rows predating the
 * display_name column carry NULL and keep rendering their filename.
 */
export function resumeLabel(resume: Pick<ResumeRecord, 'display_name' | 'filename'>): string {
  return resume.display_name ?? resume.filename
}

/** Strips only the final dot-suffix, so dotfile-style names survive intact. */
export function defaultDisplayName(filename: string): string {
  const lastDot = filename.lastIndexOf('.')
  if (lastDot <= 0) return filename
  return filename.slice(0, lastDot)
}

function normalizeDisplayName(displayName?: string): string | null {
  const trimmed = displayName?.trim()
  return trimmed ? trimmed : null
}

export async function uploadResume(file: File, displayName?: string): Promise<ResumeRecord> {
  // Extension validation and the storage path stay bound to the real file name;
  // the user-supplied display name never influences either (T-WUI-02).
  const extension = allowedExtension(file.name)
  const { data: userData, error: userError } = await supabase.auth.getUser()

  if (userError) throw userError
  if (!userData.user) throw new Error('You must be signed in to upload a resume')

  const storagePath = `${userData.user.id}/${crypto.randomUUID()}.${extension}`
  const bucket = supabase.storage.from('resumes')
  const { error: uploadError } = await bucket.upload(storagePath, file, {
    contentType: CONTENT_TYPES[extension],
    upsert: false,
  })

  if (uploadError) throw uploadError

  const { data, error: insertError } = await supabase
    .from('resumes')
    .insert({
      filename: file.name,
      display_name: normalizeDisplayName(displayName),
      storage_path: storagePath,
      size_bytes: file.size,
    })
    .select(RESUME_COLUMNS)
    .single()

  if (insertError) {
    await bucket.remove([storagePath])
    throw insertError
  }

  // The resume set changed → routing may change → flag recent jobs for refilter
  // so score-tick recomputes and rescores only real changes (D-04/D-10). The
  // service-side extract-resume worker also reroutes once extraction lands (F2);
  // this browser-side flag is the immediate signal.
  const { error: rpcError } = await supabase.rpc('mark_recent_jobs_for_refilter')
  if (rpcError) throw rpcError

  return data as ResumeRecord
}

export async function listResumes(): Promise<ResumeRecord[]> {
  const { data, error } = await supabase
    .from('resumes')
    .select(RESUME_COLUMNS)
    .order('created_at', { ascending: false })

  if (error) throw error
  return (data ?? []) as ResumeRecord[]
}

export async function downloadResume(storagePath: string): Promise<string> {
  const { data, error } = await supabase.storage.from('resumes').download(storagePath)
  if (error) throw error
  return URL.createObjectURL(data)
}

export async function deleteResume({ id, storagePath }: DeleteResumeInput): Promise<void> {
  const { data: removed, error: storageError } = await supabase.storage.from('resumes').remove([storagePath])
  if (storageError) throw storageError

  if (removed.length !== 1 || removed[0]?.name !== storagePath) {
    throw new Error('Storage delete incomplete; the resume record was not deleted')
  }

  const { error: rowError } = await supabase.from('resumes').delete().eq('id', id)
  if (rowError) throw rowError

  // The resume set changed → flag recent jobs for refilter so routing/scoring
  // recomputes (D-04/D-10). Same RPC as upload/preferences.
  const { error: rpcError } = await supabase.rpc('mark_recent_jobs_for_refilter')
  if (rpcError) throw rpcError
}

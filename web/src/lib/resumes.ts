import { supabase } from './supabase'

const RESUME_COLUMNS = 'id, filename, storage_path, size_bytes, created_at'

const CONTENT_TYPES = {
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pdf: 'application/pdf',
} as const

export interface ResumeRecord {
  id: string
  filename: string
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

export async function uploadResume(file: File): Promise<ResumeRecord> {
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
      storage_path: storagePath,
      size_bytes: file.size,
    })
    .select(RESUME_COLUMNS)
    .single()

  if (insertError) {
    await bucket.remove([storagePath])
    throw insertError
  }

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
}

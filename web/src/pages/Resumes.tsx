import { useRef, useState, type ChangeEvent, type FormEvent } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { ConfirmDialog } from '../components/ConfirmDialog'
import { useSession } from '../auth/AuthProvider'
import {
  defaultDisplayName,
  deleteResume,
  downloadResume,
  listResumes,
  removeResumeFromList,
  resumeLabel,
  uploadResume,
  upsertResumeInList,
  type ResumeRecord,
} from '../lib/resumes'

const dateFormatter = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' })

function formatBytes(bytes: number | null) {
  if (bytes === null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong. Please try again.'
}

export function Resumes() {
  const queryClient = useQueryClient()
  const { session } = useSession()
  const fileInput = useRef<HTMLInputElement>(null)
  const [resumeToDelete, setResumeToDelete] = useState<ResumeRecord | null>(null)
  const [displayName, setDisplayName] = useState('')
  const [downloadError, setDownloadError] = useState('')
  const [downloadingId, setDownloadingId] = useState<string | null>(null)

  const resumesQuery = useQuery({ queryKey: ['resumes'], queryFn: listResumes })
  const uploadMutation = useMutation({
    mutationFn: ({ file, name }: { file: File; name: string }) => {
      if (!session) throw new Error('You must be signed in to upload a resume')
      return uploadResume(file, session.user.id, name)
    },
    onSuccess: (resume) => {
      if (fileInput.current) fileInput.current.value = ''
      setDisplayName('')
      queryClient.setQueryData<ResumeRecord[]>(['resumes'], (current) =>
        upsertResumeInList(current, resume))
    },
  })
  const deleteMutation = useMutation({
    mutationFn: deleteResume,
    onSuccess: (_result, { id }) => {
      setResumeToDelete(null)
      queryClient.setQueryData<ResumeRecord[]>(['resumes'], (current) =>
        removeResumeFromList(current, id))
    },
  })

  function handleUpload(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const file = fileInput.current?.files?.[0]
    if (!file) return
    uploadMutation.reset()
    uploadMutation.mutate({ file, name: displayName })
  }

  function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0]
    setDisplayName(file ? defaultDisplayName(file.name) : '')
  }

  async function handleDownload(resume: ResumeRecord) {
    setDownloadError('')
    setDownloadingId(resume.id)
    try {
      const objectUrl = await downloadResume(resume.storage_path)
      const anchor = document.createElement('a')
      anchor.href = objectUrl
      anchor.download = resume.filename
      anchor.click()
      URL.revokeObjectURL(objectUrl)
    } catch (error) {
      setDownloadError(errorMessage(error))
    } finally {
      setDownloadingId(null)
    }
  }

  return (
    <section>
      <h1 className="text-xl font-semibold tracking-tight">Resumes</h1>
      <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
        Upload private DOCX resumes up to 5 MB. PDF support for Best Fit is not available yet.
      </p>

      <form onSubmit={handleUpload} className="mt-6 flex flex-wrap items-end gap-3">
        <label className="grid gap-1.5 text-sm font-medium">
          Resume file
          <input
            ref={fileInput}
            type="file"
            accept=".docx,application/vnd.openxmlformats-officedocument.wordprocessingml.document"
            required
            onChange={handleFileChange}
            className="max-w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm file:mr-3 file:rounded file:border-0 file:bg-zinc-100 file:px-3 file:py-1 file:text-sm file:font-medium dark:border-zinc-700 dark:bg-zinc-900 dark:file:bg-zinc-800"
          />
        </label>
        <label className="grid gap-1.5 text-sm font-medium">
          Display name
          <input
            type="text"
            value={displayName}
            onChange={(event) => setDisplayName(event.target.value)}
            placeholder="Optional"
            className="max-w-full rounded-md border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <span className="text-xs font-normal text-zinc-600 dark:text-zinc-400">
            Optional — defaults to the file name.
          </span>
        </label>
        <button
          type="submit"
          disabled={uploadMutation.isPending}
          className="rounded-md bg-zinc-900 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-700 disabled:cursor-wait disabled:opacity-60 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-white"
        >
          {uploadMutation.isPending ? 'Uploading…' : 'Upload'}
        </button>
      </form>

      {uploadMutation.error ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          Upload failed: {errorMessage(uploadMutation.error)}
        </p>
      ) : null}
      {deleteMutation.error ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          Delete failed: {errorMessage(deleteMutation.error)}
        </p>
      ) : null}
      {downloadError ? (
        <p role="alert" className="mt-3 text-sm text-red-700 dark:text-red-400">
          Download failed: {downloadError}
        </p>
      ) : null}

      <div className="mt-8 overflow-x-auto rounded-lg border border-zinc-200 bg-white dark:border-zinc-800 dark:bg-zinc-900">
        {resumesQuery.isPending ? (
          <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">Loading resumes…</p>
        ) : resumesQuery.error ? (
          <p role="alert" className="p-4 text-sm text-red-700 dark:text-red-400">
            Unable to load resumes: {errorMessage(resumesQuery.error)}
          </p>
        ) : resumesQuery.data.length === 0 ? (
          <p className="p-4 text-sm text-zinc-600 dark:text-zinc-400">Upload your first resume to get started.</p>
        ) : (
          <table className="w-full min-w-2xl border-collapse text-left text-sm">
            <thead className="border-b border-zinc-200 bg-zinc-50 text-xs font-medium tracking-wide text-zinc-600 uppercase dark:border-zinc-800 dark:bg-zinc-950 dark:text-zinc-400">
              <tr>
                <th scope="col" className="px-4 py-2.5">Name</th>
                <th scope="col" className="px-4 py-2.5">Size</th>
                <th scope="col" className="px-4 py-2.5">Uploaded</th>
                <th scope="col" className="px-4 py-2.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-zinc-200 dark:divide-zinc-800">
              {resumesQuery.data.map((resume) => (
                <tr key={resume.id}>
                  <td className="max-w-sm truncate px-4 py-3 font-medium">{resumeLabel(resume)}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">{formatBytes(resume.size_bytes)}</td>
                  <td className="px-4 py-3 text-zinc-600 dark:text-zinc-400">
                    {dateFormatter.format(new Date(resume.created_at))}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      <button
                        type="button"
                        onClick={() => handleDownload(resume)}
                        disabled={downloadingId === resume.id}
                        className="rounded-md border border-zinc-300 px-2.5 py-1 text-xs font-medium hover:bg-zinc-100 disabled:cursor-wait disabled:opacity-60 dark:border-zinc-700 dark:hover:bg-zinc-800"
                      >
                        {downloadingId === resume.id ? 'Downloading…' : 'Download'}
                      </button>
                      <button
                        type="button"
                        onClick={() => {
                          deleteMutation.reset()
                          setResumeToDelete(resume)
                        }}
                        className="rounded-md border border-red-300 px-2.5 py-1 text-xs font-medium text-red-700 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950"
                      >
                        Delete
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {resumeToDelete ? (
        <ConfirmDialog
          title="Delete resume?"
          message={`This permanently deletes ${resumeLabel(resumeToDelete)} from storage and your resume list.`}
          confirmLabel="Delete resume"
          onCancel={() => setResumeToDelete(null)}
          onConfirm={() =>
            deleteMutation.mutateAsync({
              id: resumeToDelete.id,
              storagePath: resumeToDelete.storage_path,
            })
          }
        />
      ) : null}
    </section>
  )
}

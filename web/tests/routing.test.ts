import { describe, expect, it } from 'vitest'
import {
  routeResume,
  tierFor,
  type ResumeExtractInput,
} from '../../supabase/functions/_shared/routing'

const dataScientist: ResumeExtractInput = {
  resumeId: 'ds',
  filename: 'a-data-scientist.docx',
  keywords: ['python', 'pandas', 'machine learning', 'statistics'],
}
const finance: ResumeExtractInput = {
  resumeId: 'fin',
  filename: 'b-finance.docx',
  keywords: ['excel', 'accounting', 'valuation', 'financial modeling'],
}
const dataEngineer: ResumeExtractInput = {
  resumeId: 'de',
  filename: 'c-data-engineer.docx',
  keywords: ['spark', 'airflow', 'etl', 'python'],
}

describe('routeResume', () => {
  it('routes to the highest keyword-hit resume', () => {
    const result = routeResume('python, pandas, machine learning', [
      dataScientist,
      finance,
      dataEngineer,
    ])
    expect(result?.resumeId).toBe('ds')
    // ds hits python+pandas+machine learning = 3, de hits python = 1, fin = 0
    expect(result?.hitCounts).toEqual({ ds: 3, fin: 0, de: 1 })
  })

  it('returns a runner-up on a near-tie (within the tolerance)', () => {
    const alpha: ResumeExtractInput = {
      resumeId: 'alpha',
      filename: 'alpha.docx',
      keywords: ['python', 'pandas', 'spark', 'sql', 'aws'],
    }
    const beta: ResumeExtractInput = {
      resumeId: 'beta',
      filename: 'beta.docx',
      keywords: ['python', 'pandas', 'spark', 'sql', 'kafka'],
    }
    // JD hits alpha on 5 (python,pandas,spark,sql,aws) and beta on 4 → diff 1 ≤ 2.
    const result = routeResume('python pandas spark sql aws', [alpha, beta])
    expect(result?.resumeId).toBe('alpha')
    expect(result?.runnerUpResumeId).toBe('beta')
  })

  it('returns null runner-up when there is a clear winner', () => {
    const winner: ResumeExtractInput = {
      resumeId: 'win',
      filename: 'win.docx',
      keywords: ['python', 'pandas', 'spark', 'sql', 'aws'],
    }
    const other: ResumeExtractInput = {
      resumeId: 'other',
      filename: 'other.docx',
      keywords: ['excel', 'python'],
    }
    // winner 5 vs other 1 → diff 4 > max(2, ceil(5*0.15)=1) → no runner-up.
    const result = routeResume('python pandas spark sql aws', [winner, other])
    expect(result?.resumeId).toBe('win')
    expect(result?.runnerUpResumeId).toBeNull()
  })

  it('returns null when there are zero extracts', () => {
    expect(routeResume('python pandas', [])).toBeNull()
  })

  it('returns null on all-zero overlap regardless of filename order', () => {
    expect(routeResume('carpentry welding masonry', [
      dataEngineer, // filename c-...
      dataScientist, // filename a-...
      finance, // filename b-...
    ])).toBeNull()
    expect(routeResume('carpentry welding masonry', [
      finance,
      dataEngineer,
      dataScientist,
    ])).toBeNull()
  })
})

describe('tierFor (D-07 boundaries)', () => {
  it('maps exact boundary values', () => {
    expect(tierFor(75)).toBe('Strong')
    expect(tierFor(74)).toBe('Good')
    expect(tierFor(50)).toBe('Good')
    expect(tierFor(49)).toBe('Weak')
  })

  it('maps extremes', () => {
    expect(tierFor(100)).toBe('Strong')
    expect(tierFor(0)).toBe('Weak')
  })
})

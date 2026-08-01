import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'
import * as rightsGate from './rights-gate.mjs'

const {
  MAX_RIGHTS_VALIDITY_DAYS,
  OFFICIAL_RIGHTS_SOURCE_CONTRACTS,
  REQUIRED_OPERATIONS,
  assertNoGoQualityReport,
  buildNoGoQualityReport,
  canonical,
  evaluateRights,
  inspectRightsMatrix,
  sha256Json,
  validateRightsMatrix,
} = rightsGate

const MATRIX_PATH =
  '.planning/phases/05-outreach-feasibility-gate/05-RIGHTS-MATRIX.json'
const QUALITY_PATH =
  '.planning/phases/05-outreach-feasibility-gate/05-QUALITY-REPORT.json'
const committedMatrix = JSON.parse(await readFile(MATRIX_PATH, 'utf8'))
const committedQuality = JSON.parse(await readFile(QUALITY_PATH, 'utf8'))
const COMMITTED_CLOCK = new Date('2026-07-29T12:00:00.000Z')
const ZERO_EFFECT_NO_GO = {
  status: 'RIGHTS_NO_GO',
  search_authorized: false,
  quality_status: 'NOT_RUN_RIGHTS_NO_GO',
  provider_call_count: 0,
  fixture_count: 0,
  raw_result_count: 0,
  production_mutation_count: 0,
}

function clone(value) {
  return structuredClone(value)
}

function resignMatrix(matrix) {
  for (const source of matrix.sources) {
    const { evidence_sha256: _digest, ...body } = source
    source.evidence_sha256 = sha256Json(body)
  }
  const { rights_evidence_sha256: _digest, ...body } = matrix
  matrix.rights_evidence_sha256 = sha256Json(body)
  return matrix
}

function allAllowMatrix() {
  const matrix = clone(committedMatrix)
  for (const operation of matrix.operations) {
    if (operation.required) operation.status = 'ALLOW'
  }
  return resignMatrix(matrix)
}

function prospectiveMatrix(researchedAt, validUntil) {
  const matrix = allAllowMatrix()
  matrix.researched_at = researchedAt
  matrix.valid_until = validUntil
  for (const source of matrix.sources) {
    source.retrieved_at = `${researchedAt}T00:00:00Z`
  }
  return resignMatrix(matrix)
}

function resignQuality(report) {
  const { quality_evidence_sha256: _digest, ...body } = report
  report.quality_evidence_sha256 = sha256Json(body)
  return report
}

function assertChronologyDenied(matrix, { now, error }) {
  resignMatrix(matrix)
  assert.throws(
    () => validateRightsMatrix(matrix, { now }),
    error,
  )
  assert.deepEqual(evaluateRights(matrix, { now }), ZERO_EFFECT_NO_GO)
}

test('canonical hashing sorts object keys recursively and includes one final newline', () => {
  assert.equal(canonical({ z: 1, nested: { b: 2, a: 1 } }),
    '{"nested":{"a":1,"b":2},"z":1}')
  assert.equal(
    sha256Json({ b: 2, a: 1 }),
    'e8d38819d39f705646bfb643368eca78f7db476c16471dbc33b941b27326410d',
  )
})

test('the committed matrix fails closed with truthful zero-effect evidence', () => {
  const options = { now: COMMITTED_CLOCK }
  const inspected = inspectRightsMatrix(committedMatrix, options)
  assert.equal(inspected.rights_evidence_sha256, committedMatrix.rights_evidence_sha256)
  assert.throws(
    () => validateRightsMatrix(committedMatrix, options),
    /seven inclusive UTC dates/,
  )

  const verdict = evaluateRights(committedMatrix, options)
  assert.deepEqual(verdict, ZERO_EFFECT_NO_GO)

  const report = buildNoGoQualityReport(committedMatrix, options)
  assert.equal(report.status, 'NOT_RUN_RIGHTS_NO_GO')
  assert.equal(report.rights_status, 'RIGHTS_NO_GO')
  assert.equal(report.search_authorized, false)
  assert.deepEqual(report.cases, [])
  for (const key of [
    'provider_call_count',
    'fixture_count',
    'raw_result_count',
    'production_mutation_count',
  ]) assert.equal(report[key], 0)
  assert.equal(assertNoGoQualityReport(committedMatrix, report, options), report)
  assert.equal(
    assertNoGoQualityReport(committedMatrix, committedQuality, options),
    committedQuality,
  )
})

test('authorization ends at the final millisecond of the seventh inclusive UTC date', () => {
  assert.equal(MAX_RIGHTS_VALIDITY_DAYS, 7)
  const matrix = prospectiveMatrix('2026-07-28', '2026-08-03')
  const finalMillisecond = new Date('2026-08-03T23:59:59.999Z')
  const firstEighthDateMillisecond = new Date('2026-08-04T00:00:00.000Z')

  assert.doesNotThrow(() => validateRightsMatrix(matrix, {
    now: finalMillisecond,
  }))
  assert.equal(
    evaluateRights(matrix, { now: finalMillisecond }).status,
    'PASS',
  )
  assert.deepEqual(
    evaluateRights(matrix, { now: firstEighthDateMillisecond }),
    ZERO_EFFECT_NO_GO,
  )
})

test('seven-inclusive-date authorization is deterministic across calendar boundaries', async (t) => {
  const cases = [
    ['month boundary', '2026-07-28', '2026-08-03', '2026-08-04'],
    ['year boundary', '2026-12-28', '2027-01-03', '2027-01-04'],
    ['leap-day boundary', '2028-02-24', '2028-03-01', '2028-03-02'],
  ]

  for (const [name, researchedAt, seventhDate, eighthDate] of cases) {
    await t.test(name, () => {
      const matrix = prospectiveMatrix(researchedAt, seventhDate)
      const finalMillisecond = new Date(`${seventhDate}T23:59:59.999Z`)
      const firstEighthDateMillisecond = new Date(`${eighthDate}T00:00:00.000Z`)

      assert.equal(evaluateRights(matrix, { now: finalMillisecond }).status, 'PASS')
      assert.deepEqual(
        evaluateRights(matrix, { now: firstEighthDateMillisecond }),
        ZERO_EFFECT_NO_GO,
      )

      const overlong = prospectiveMatrix(researchedAt, eighthDate)
      assert.throws(
        () => validateRightsMatrix(overlong, {
          now: new Date(`${researchedAt}T12:00:00.000Z`),
        }),
        /seven inclusive UTC dates/,
      )
      assert.deepEqual(
        evaluateRights(overlong, {
          now: new Date(`${researchedAt}T12:00:00.000Z`),
        }),
        ZERO_EFFECT_NO_GO,
      )
    })
  }
})

test('official rights source contracts are frozen and bind all eight source IDs', () => {
  assert.equal(Object.isFrozen(OFFICIAL_RIGHTS_SOURCE_CONTRACTS), true)
  assert.deepEqual(
    Object.keys(OFFICIAL_RIGHTS_SOURCE_CONTRACTS),
    committedMatrix.sources.map((source) => source.source_id),
  )
  for (const contract of Object.values(OFFICIAL_RIGHTS_SOURCE_CONTRACTS)) {
    assert.equal(Object.isFrozen(contract), true)
    assert.deepEqual(
      Object.keys(contract),
      ['protocol', 'hostname', 'pathname', 'clause_family'],
    )
  }
})

test('rehashing substituted official rights sources cannot authorize search', async (t) => {
  const substitutions = [
    ['cross-ID URL', (matrix) => {
      matrix.sources[0].official_url = matrix.sources[1].official_url
    }],
    ['alternate host', (matrix) => {
      matrix.sources[0].official_url =
        'https://legal.linkedin.com/legal/user-agreement'
    }],
    ['alternate subdomain', (matrix) => {
      matrix.sources[0].official_url =
        'https://help.linkedin.com/legal/user-agreement'
    }],
    ['alternate port', (matrix) => {
      matrix.sources[0].official_url =
        'https://www.linkedin.com:8443/legal/user-agreement'
    }],
    ['query', (matrix) => {
      matrix.sources[0].official_url =
        'https://www.linkedin.com/legal/user-agreement?accepted=true'
    }],
    ['fragment', (matrix) => {
      matrix.sources[0].official_url =
        'https://www.linkedin.com/legal/user-agreement#permission'
    }],
    ['credentials', (matrix) => {
      matrix.sources[0].official_url =
        'https://reviewer@www.linkedin.com/legal/user-agreement'
    }],
    ['trailing-path alias', (matrix) => {
      matrix.sources[0].official_url =
        'https://www.linkedin.com/legal/user-agreement/'
    }],
    ['normalized path alias', (matrix) => {
      matrix.sources[0].official_url =
        'https://www.linkedin.com/legal/../legal/user-agreement'
    }],
    ['clause-family mismatch', (matrix) => {
      matrix.sources[0].clause_id = matrix.sources[1].clause_id
    }],
  ]

  for (const [name, mutate] of substitutions) {
    await t.test(name, () => {
      const matrix = prospectiveMatrix('2026-07-28', '2026-08-03')
      mutate(matrix)
      resignMatrix(matrix)
      assert.throws(
        () => inspectRightsMatrix(matrix, { now: COMMITTED_CLOCK }),
        /official rights source contract|credential-free HTTPS/,
      )
      assert.deepEqual(
        evaluateRights(matrix, { now: COMMITTED_CLOCK }),
        ZERO_EFFECT_NO_GO,
      )
    })
  }
})

test('future, out-of-window, and excessive-horizon evidence fails closed', async (t) => {
  const cases = [
    {
      name: 'research starts one millisecond after the evaluation clock',
      now: new Date('2026-07-29T23:59:59.999Z'),
      error: /researched_at.*future/i,
      mutate(matrix) {
        matrix.researched_at = '2026-07-30'
      },
    },
    {
      name: 'retrieval is one millisecond after the evaluation clock',
      now: new Date('2026-07-29T12:00:00.000Z'),
      error: /retrieved_at.*future/i,
      mutate(matrix) {
        matrix.sources[0].retrieved_at = '2026-07-29T12:00:00.001Z'
      },
    },
    {
      name: 'retrieval is one millisecond before the research window',
      now: COMMITTED_CLOCK,
      error: /retrieved_at.*research window/i,
      mutate(matrix) {
        matrix.sources[0].retrieved_at = '2026-07-27T23:59:59.999Z'
      },
    },
    {
      name: 'retrieval is one millisecond after the inclusive validity window',
      now: new Date('2026-08-05T00:00:00.000Z'),
      error: /retrieved_at.*validity window/i,
      mutate(matrix) {
        matrix.sources[0].retrieved_at = '2026-08-05T00:00:00.000Z'
      },
    },
    {
      name: 'validity horizon contains eight inclusive UTC calendar dates',
      now: COMMITTED_CLOCK,
      error: /seven inclusive UTC dates/i,
      mutate(matrix) {
        matrix.valid_until = '2026-08-04'
      },
    },
  ]

  for (const { name, now, error, mutate } of cases) {
    await t.test(name, () => {
      const matrix = allAllowMatrix()
      mutate(matrix)
      assertChronologyDenied(matrix, { now, error })
    })
  }
})

test('retrieval timestamps accept only canonical UTC seconds or milliseconds', async (t) => {
  const malformedTimestamps = [
    '2026-07-28T00:00:00+00:00',
    '2026-07-28T00:00:00.0Z',
    '2026-07-28T00:00:00.00Z',
    '2026-07-28T00:00:00.0000Z',
    '2026-07-28T00:00Z',
  ]

  for (const retrievedAt of malformedTimestamps) {
    await t.test(JSON.stringify(retrievedAt), () => {
      const matrix = allAllowMatrix()
      matrix.sources[0].retrieved_at = retrievedAt
      assertChronologyDenied(matrix, {
        now: COMMITTED_CLOCK,
        error: /retrieved_at is malformed/,
      })
    })
  }

  for (const retrievedAt of [
    '2026-07-28T00:00:00Z',
    '2026-07-28T00:00:00.000Z',
  ]) {
    await t.test(`accepts ${retrievedAt}`, () => {
      const matrix = allAllowMatrix()
      matrix.sources[0].retrieved_at = retrievedAt
      resignMatrix(matrix)
      assert.doesNotThrow(
        () => inspectRightsMatrix(matrix, { now: COMMITTED_CLOCK }),
      )
    })
  }
})

test('PASS requires one current digest-valid ALLOW row for every required operation', () => {
  const passing = prospectiveMatrix('2026-07-28', '2026-08-03')
  assert.deepEqual(evaluateRights(passing), {
    status: 'PASS',
    search_authorized: true,
    quality_status: null,
    provider_call_count: 0,
    fixture_count: 0,
    raw_result_count: 0,
    production_mutation_count: 0,
  })

  const missing = clone(passing)
  missing.operations = missing.operations.filter(
    (row) => row.operation !== REQUIRED_OPERATIONS[0],
  )
  resignMatrix(missing)
  assert.equal(evaluateRights(missing, {
    owner_acknowledgement: 'I accept all rights',
  }).status, 'RIGHTS_NO_GO')
  assert.equal(evaluateRights(missing).search_authorized, false)
})

test('invalid, stale, prohibited, and ambiguous matrix states fail closed', async (t) => {
  const cases = [
    ['missing required operation', () => {
      const matrix = allAllowMatrix()
      matrix.operations = matrix.operations.filter(
        (row) => row.operation !== 'persist_profile_url',
      )
      return [resignMatrix(matrix)]
    }],
    ['duplicate required operation', () => {
      const matrix = allAllowMatrix()
      matrix.operations.push(clone(matrix.operations[0]))
      return [resignMatrix(matrix)]
    }],
    ['extra operation', () => {
      const matrix = allAllowMatrix()
      matrix.operations.push({
        operation: 'technical_api_support',
        required: false,
        status: 'ALLOW',
        evidence_refs: [matrix.sources[0].source_id],
      })
      return [resignMatrix(matrix)]
    }],
    ['unknown status', () => {
      const matrix = allAllowMatrix()
      matrix.operations[0].status = 'PERMIT'
      return [resignMatrix(matrix)]
    }],
    ['stale evidence', () => [
      allAllowMatrix(),
      { now: new Date('2026-08-05T00:00:00Z') },
    ]],
    ['unknown top-level key', () => {
      const matrix = allAllowMatrix()
      matrix.owner_override = true
      return [resignMatrix(matrix)]
    }],
    ['source digest drift', () => {
      const matrix = allAllowMatrix()
      matrix.sources[0].short_paraphrase += ' drift'
      return [matrix]
    }],
    ['aggregate digest drift', () => {
      const matrix = allAllowMatrix()
      matrix.rights_evidence_sha256 = '0'.repeat(64)
      return [matrix]
    }],
    ['prohibited required operation', () => {
      const matrix = allAllowMatrix()
      matrix.operations[0].status = 'PROHIBIT'
      return [resignMatrix(matrix)]
    }],
    ['ambiguous required operation', () => {
      const matrix = allAllowMatrix()
      matrix.operations[0].status = 'AMBIGUOUS'
      return [resignMatrix(matrix)]
    }],
    ['unresolved evidence reference', () => {
      const matrix = allAllowMatrix()
      matrix.operations[0].evidence_refs = ['missing-source']
      return [resignMatrix(matrix)]
    }],
    ['unknown source key', () => {
      const matrix = allAllowMatrix()
      matrix.sources[0].full_policy_html = '<html>'
      return [resignMatrix(matrix)]
    }],
  ]

  for (const [name, mutate] of cases) {
    await t.test(name, () => {
      const [matrix, options] = mutate()
      const result = evaluateRights(matrix, options)
      assert.equal(result.status, 'RIGHTS_NO_GO')
      assert.equal(result.search_authorized, false)
      assert.equal(result.provider_call_count, 0)
    })
  }
})

test('matrix validation rejects malformed dates, operation keys, and evidence refs', () => {
  const malformedDate = allAllowMatrix()
  malformedDate.valid_until = 'next week'
  resignMatrix(malformedDate)
  assert.throws(() => validateRightsMatrix(malformedDate), /valid_until/)

  const extraOperationKey = allAllowMatrix()
  extraOperationKey.operations[0].technical_capability = true
  resignMatrix(extraOperationKey)
  assert.throws(() => validateRightsMatrix(extraOperationKey), /unknown key/)

  const duplicateRef = allAllowMatrix()
  duplicateRef.operations[0].evidence_refs.push(
    duplicateRef.operations[0].evidence_refs[0],
  )
  resignMatrix(duplicateRef)
  assert.throws(() => validateRightsMatrix(duplicateRef), /duplicate evidence reference/)
})

test('no-run report rejects fabricated outcomes, candidate data, effects, and drift', async (t) => {
  const base = buildNoGoQualityReport(committedMatrix)
  const mutations = [
    ['case outcome', (report) => {
      report.cases = [{ case_id: 'real-1', outcome: 'no_match' }]
      resignQuality(report)
    }],
    ['candidate data', (report) => {
      report.candidate_name = 'Candidate'
      resignQuality(report)
    }],
    ['provider call', (report) => {
      report.provider_call_count = 1
      resignQuality(report)
    }],
    ['fixture', (report) => {
      report.fixture_count = 1
      resignQuality(report)
    }],
    ['raw result', (report) => {
      report.raw_result_count = 1
      resignQuality(report)
    }],
    ['production mutation', (report) => {
      report.production_mutation_count = 1
      resignQuality(report)
    }],
    ['rights digest mismatch', (report) => {
      report.rights_evidence_sha256 = '0'.repeat(64)
      resignQuality(report)
    }],
    ['quality digest drift', (report) => {
      report.quality_evidence_sha256 = '0'.repeat(64)
    }],
  ]

  for (const [name, mutate] of mutations) {
    await t.test(name, () => {
      const report = clone(base)
      mutate(report)
      assert.throws(
        () => assertNoGoQualityReport(committedMatrix, report),
      )
    })
  }
})

import { describe, expect, it } from 'vitest'

const CLAIM_BATCH_SIZE = 25
const MAX_ITEMS_PER_INVOCATION = 5_000

interface Owner {
  activeRevision: number
  buildingRevision: number | null
  pending: number
  failed: boolean
}

interface Model {
  owners: Owner[]
  maintenanceRuns: number
  paidScoreWrites: number
}

function totalPending(model: Model) {
  return model.owners.reduce((total, owner) => total + owner.pending, 0)
}

function publishCompletedOwners(model: Model) {
  for (const owner of model.owners) {
    if (owner.buildingRevision !== null && owner.pending === 0 && !owner.failed) {
      owner.activeRevision = owner.buildingRevision
      owner.buildingRevision = null
    }
  }
}

function runMaintenance(model: Model, universeSize: number) {
  model.maintenanceRuns += 1
  for (const owner of model.owners) {
    if (owner.buildingRevision === null) {
      owner.buildingRevision = owner.activeRevision
      owner.pending = universeSize
    }
  }
}

function runFixedInvocation(model: Model, universeSize: number, failAt = -1) {
  let processed = 0
  let initialPending = totalPending(model)
  if (initialPending === 0) {
    runMaintenance(model, universeSize)
    initialPending = totalPending(model)
  }

  while (totalPending(model) > 0 && processed < MAX_ITEMS_PER_INVOCATION) {
    let remaining = Math.min(
      CLAIM_BATCH_SIZE,
      totalPending(model),
      MAX_ITEMS_PER_INVOCATION - processed,
    )
    for (const owner of model.owners) {
      const claimed = Math.min(owner.pending, remaining)
      if (claimed === 0) continue
      owner.pending -= claimed
      remaining -= claimed
      if (failAt >= processed && failAt < processed + claimed) owner.failed = true
      processed += claimed
      if (remaining === 0) break
    }
  }
  publishCompletedOwners(model)
  return { processed, initialPending }
}

function runLegacyTick(model: Model, universeSize: number) {
  runMaintenance(model, universeSize)
  const owner = model.owners.find((candidate) => candidate.pending > 0)
  if (owner) owner.pending -= Math.min(12, owner.pending)
  publishCompletedOwners(model)
}

function recencyChainFixture(): Model {
  return {
    owners: [
      { activeRevision: 8, buildingRevision: null, pending: 0, failed: false },
      { activeRevision: 7, buildingRevision: 8, pending: 1_684, failed: false },
    ],
    maintenanceRuns: 0,
    paidScoreWrites: 0,
  }
}

describe('deterministic worker recency liveness model', () => {
  it('reproduces the legacy chain when maintenance runs before older work drains', () => {
    const model = recencyChainFixture()
    runLegacyTick(model, 2_114)

    expect(model.owners[0]).toMatchObject({
      buildingRevision: 8,
      pending: 2_102,
    })
    expect(totalPending(model)).toBe(3_786)
    expect(model.maintenanceRuns).toBe(1)
  })

  it('drains the older run without creating another owner snapshot', () => {
    const model = recencyChainFixture()
    const result = runFixedInvocation(model, 2_114)

    expect(result).toEqual({ processed: 1_684, initialPending: 1_684 })
    expect(model.maintenanceRuns).toBe(0)
    expect(totalPending(model)).toBe(0)
    expect(model.owners[0].buildingRevision).toBeNull()
    expect(model.owners[1]).toMatchObject({
      activeRevision: 8,
      buildingRevision: null,
    })
  })

  it('fits the approved two-owner universe inside the hard invocation item bound', () => {
    const model: Model = {
      owners: [
        { activeRevision: 8, buildingRevision: null, pending: 0, failed: false },
        { activeRevision: 8, buildingRevision: null, pending: 0, failed: false },
      ],
      maintenanceRuns: 0,
      paidScoreWrites: 0,
    }
    const result = runFixedInvocation(model, 2_114)

    expect(result.processed).toBe(4_228)
    expect(result.processed).toBeLessThanOrEqual(MAX_ITEMS_PER_INVOCATION)
    expect(model.maintenanceRuns).toBe(1)
    expect(totalPending(model)).toBe(0)
    expect(model.owners.every((owner) => owner.buildingRevision === null)).toBe(true)
  })

  it('keeps prior active revisions and cost state unchanged on item failure', () => {
    const model: Model = {
      owners: [
        { activeRevision: 7, buildingRevision: 8, pending: 50, failed: false },
      ],
      maintenanceRuns: 0,
      paidScoreWrites: 0,
    }
    runFixedInvocation(model, 2_114, 26)

    expect(model.owners[0]).toMatchObject({
      activeRevision: 7,
      buildingRevision: 8,
      pending: 0,
      failed: true,
    })
    expect(model.paidScoreWrites).toBe(0)
  })
})

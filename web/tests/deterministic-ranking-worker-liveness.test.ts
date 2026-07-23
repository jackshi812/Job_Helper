import { describe, expect, it } from 'vitest'

const CLAIM_BATCH_SIZE = 25
const MAX_ITEMS_PER_INVOCATION = 5_000

interface Owner {
  activeRevision: number
  desiredRevision: number
  buildingRevision: number | null
  pending: number
  claimed: number
  failed: boolean
  malformed: boolean
  mixed: boolean
}

interface Model {
  owners: Owner[]
  maintenanceRuns: number
  recoveryRuns: number
  paidScoreWrites: number
}

function totalPending(model: Model) {
  return model.owners.reduce((total, owner) => total + owner.pending, 0)
}

function publishCompletedOwners(model: Model) {
  for (const owner of model.owners) {
    if (
      owner.buildingRevision !== null &&
      owner.buildingRevision === owner.desiredRevision &&
      owner.pending === 0 &&
      owner.claimed === 0 &&
      !owner.failed &&
      !owner.malformed &&
      !owner.mixed
    ) {
      owner.activeRevision = owner.buildingRevision
      owner.buildingRevision = null
    }
  }
}

function recoverOrphanedRuns(model: Model) {
  model.recoveryRuns += 1
  publishCompletedOwners(model)
}

function runMaintenance(model: Model, universeSize: number) {
  model.maintenanceRuns += 1
  for (const owner of model.owners) {
    if (owner.buildingRevision === null) {
      owner.buildingRevision = owner.activeRevision
      owner.desiredRevision = owner.activeRevision
      owner.pending = universeSize
    }
  }
}

function runFixedInvocation(
  model: Model,
  universeSize: number,
  failAt = -1,
  hardDeathAfterStaging = false,
) {
  let processed = 0
  let initialPending = totalPending(model)
  if (initialPending === 0) {
    recoverOrphanedRuns(model)
    if (model.owners.some((owner) => owner.buildingRevision !== null)) {
      initialPending = totalPending(model)
    } else {
      runMaintenance(model, universeSize)
    }
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
  if (hardDeathAfterStaging) return { processed, initialPending }
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
      {
        activeRevision: 8,
        desiredRevision: 8,
        buildingRevision: null,
        pending: 0,
        claimed: 0,
        failed: false,
        malformed: false,
        mixed: false,
      },
      {
        activeRevision: 7,
        desiredRevision: 8,
        buildingRevision: 8,
        pending: 1_684,
        claimed: 0,
        failed: false,
        malformed: false,
        mixed: false,
      },
    ],
    maintenanceRuns: 0,
    recoveryRuns: 0,
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
        {
          activeRevision: 8,
          desiredRevision: 8,
          buildingRevision: null,
          pending: 0,
          claimed: 0,
          failed: false,
          malformed: false,
          mixed: false,
        },
        {
          activeRevision: 8,
          desiredRevision: 8,
          buildingRevision: null,
          pending: 0,
          claimed: 0,
          failed: false,
          malformed: false,
          mixed: false,
        },
      ],
      maintenanceRuns: 0,
      recoveryRuns: 0,
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
        {
          activeRevision: 7,
          desiredRevision: 8,
          buildingRevision: 8,
          pending: 50,
          claimed: 0,
          failed: false,
          malformed: false,
          mixed: false,
        },
      ],
      maintenanceRuns: 0,
      recoveryRuns: 0,
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

  it('recovers a fully staged run on a later empty tick after a hard death', () => {
    const model: Model = {
      owners: [{
        activeRevision: 7,
        desiredRevision: 8,
        buildingRevision: 8,
        pending: 25,
        claimed: 0,
        failed: false,
        malformed: false,
        mixed: false,
      }],
      maintenanceRuns: 0,
      recoveryRuns: 0,
      paidScoreWrites: 0,
    }

    runFixedInvocation(model, 2_114, -1, true)
    expect(model.owners[0]).toMatchObject({
      activeRevision: 7,
      buildingRevision: 8,
      pending: 0,
    })

    runFixedInvocation(model, 2_114)
    expect(model.owners[0]).toMatchObject({
      activeRevision: 8,
      buildingRevision: null,
    })
    expect(model.recoveryRuns).toBe(1)
    expect(model.maintenanceRuns).toBe(1)
    expect(model.paidScoreWrites).toBe(0)
  })

  it.each([
    ['pending', { pending: 1 }],
    ['claimed', { claimed: 1 }],
    ['failed', { failed: true }],
    ['superseded', { desiredRevision: 9 }],
    ['malformed', { malformed: true }],
    ['mixed', { mixed: true }],
  ])('does not publish a %s orphan candidate', (_label, overrides) => {
    const owner: Owner = {
      activeRevision: 7,
      desiredRevision: 8,
      buildingRevision: 8,
      pending: 0,
      claimed: 0,
      failed: false,
      malformed: false,
      mixed: false,
      ...overrides,
    }
    const model: Model = {
      owners: [owner],
      maintenanceRuns: 0,
      recoveryRuns: 0,
      paidScoreWrites: 0,
    }

    recoverOrphanedRuns(model)

    expect(owner.activeRevision).toBe(7)
    expect(owner.buildingRevision).toBe(8)
    expect(model.paidScoreWrites).toBe(0)
  })
})

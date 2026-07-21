export const PAYLOCITY_BOARD_UUID = 'd6628b21-949b-4400-a3d0-c9082bbf3eb1'
export const PAYLOCITY_SOURCE_KEY = `paylocity:global:${PAYLOCITY_BOARD_UUID}` as const

export interface PaylocityIdentity {
  readonly boardUuid: typeof PAYLOCITY_BOARD_UUID
  readonly feedKey: 'f3f28b00-201d-4fba-a7dd-532a9e558191'
  readonly displayName: 'The Only Facial'
  readonly canonicalUrl: `https://recruiting.paylocity.com/recruiting/jobs/All/${typeof PAYLOCITY_BOARD_UUID}/The-Only-Facial`
  readonly reviewedSlug: 'The-Only-Facial'
  readonly sourceKey: typeof PAYLOCITY_SOURCE_KEY
}

const paylocityIdentity: PaylocityIdentity = Object.freeze({
  boardUuid: PAYLOCITY_BOARD_UUID,
  feedKey: 'f3f28b00-201d-4fba-a7dd-532a9e558191',
  displayName: 'The Only Facial',
  canonicalUrl:
    `https://recruiting.paylocity.com/recruiting/jobs/All/${PAYLOCITY_BOARD_UUID}/The-Only-Facial`,
  reviewedSlug: 'The-Only-Facial',
  sourceKey: PAYLOCITY_SOURCE_KEY,
})

export const PAYLOCITY_IDENTITIES = Object.freeze({
  [PAYLOCITY_BOARD_UUID]: paylocityIdentity,
})

export function resolvePaylocityIdentity(boardUuid: string): PaylocityIdentity | null {
  return boardUuid === PAYLOCITY_BOARD_UUID ? paylocityIdentity : null
}

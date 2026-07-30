import { type AuthStatusQuery } from '@rawback/sdk'

import { type UiDocument } from '../../ui/model.ts'

type AuthUser = AuthStatusQuery['me']

export function authStatusDocument(user: AuthUser): UiDocument {
  return {
    title: 'Authentication',
    blocks: [
      { type: 'notice', message: 'Authenticated', tone: 'success' },
      {
        type: 'fields',
        fields: [
          { label: 'Name', value: user.name },
          { label: 'Email', value: user.email },
          { label: 'User ID', value: user.id },
          { label: 'Profile', value: '@' + user.slug },
          { label: 'Tier', value: user.tier },
          { label: 'Subscription', value: user.subscriptionStatus },
          { label: 'Account', value: user.accountStatus },
        ],
      },
    ],
  }
}

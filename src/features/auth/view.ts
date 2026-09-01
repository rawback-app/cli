import { type AuthStatusQuery } from '@rawback/sdk'

import { type UiDocument } from '../../ui/model.ts'

type AuthUser = AuthStatusQuery['me']

export interface AuthStatusEnvironment {
  name: string
  apiHost: string
}

export function authStatusDocument(user: AuthUser, environment: AuthStatusEnvironment): UiDocument {
  return {
    title: 'Authentication',
    blocks: [
      { type: 'notice', message: 'Authenticated', tone: 'success' },
      {
        type: 'fields',
        fields: [
          { label: 'Environment', value: environment.name },
          { label: 'API host', value: environment.apiHost },
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

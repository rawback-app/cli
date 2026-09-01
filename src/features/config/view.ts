import { type EnvironmentReport } from '../../config-env.ts'
import { type UiDocument } from '../../ui/model.ts'

export function environmentListDocument(environments: EnvironmentReport[]): UiDocument {
  return {
    title: 'Environments',
    blocks: [
      {
        type: 'table',
        emptyMessage: 'No environments configured.',
        columns: [
          { key: 'name', label: 'Name', required: true, priority: 1 },
          { key: 'apiHost', label: 'API host', required: true, priority: 1, minWidth: 16 },
          { key: 'signedIn', label: 'Signed in', priority: 2 },
          { key: 'active', label: 'Active', priority: 3 },
        ],
        rows: environments.map((environment) => ({
          name: environment.name,
          apiHost: environment.apiHost ?? '',
          signedIn: environment.authenticated ? 'yes' : 'no',
          active: environment.selected ? '*' : '',
        })),
      },
    ],
  }
}

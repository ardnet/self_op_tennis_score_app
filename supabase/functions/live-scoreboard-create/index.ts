import { getAdminClient } from '../_shared/admin.ts'
import { handleCreate } from '../_shared/live.ts'

Deno.serve((req) => handleCreate(req, { getClient: getAdminClient }))

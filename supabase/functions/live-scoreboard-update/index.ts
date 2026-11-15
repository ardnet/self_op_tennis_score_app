import { getAdminClient } from '../_shared/admin.ts'
import { handleUpdate } from '../_shared/live.ts'

Deno.serve((req) => handleUpdate(req, { getClient: getAdminClient }))

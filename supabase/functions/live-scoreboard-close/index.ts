import { getAdminClient } from '../_shared/admin.ts'
import { handleClose } from '../_shared/live.ts'

Deno.serve((req) => handleClose(req, { getClient: getAdminClient }))

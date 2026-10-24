/** Maintenance starts only after the guarded app has mounted. No login,
 * workspace transition or sync caller awaits this independent HTTP request.
 */
type MaintenanceResult = { status: string }
let send: ((token: string) => Promise<MaintenanceResult>) | undefined
let latestToken: string | undefined
let timer: ReturnType<typeof setTimeout> | undefined
let running = false
let attemptedDay = ''
let retryAfter = 0

export function noteCloudActivity(token?: string): void {
  if (token) latestToken = token
  if (!send || !latestToken || timer || running || Date.now() < retryAfter ||
      attemptedDay === new Date().toISOString().slice(0, 10)) return
  timer = setTimeout(() => {
    timer = undefined
    if (!send || !latestToken) return
    running = true
    const day = new Date().toISOString().slice(0, 10)
    void send(latestToken).then(result => {
      if (result.status === 'unavailable') retryAfter = Date.now() + 60_000
      else attemptedDay = day
    }).catch(() => {
      // A lost response is ambiguous. Server-side daily state and deletion
      // fences make a later retry safe; never change account/local data here.
      retryAfter = Date.now() + 60_000
    }).finally(() => { running = false })
  }, 2500)
}

export function startIdleMaintenance(sender: (token: string) => Promise<MaintenanceResult>, token?: string): void {
  send = sender
  noteCloudActivity(token)
}

/** Optional cloud-account tools only; login/account entry uses account-navigation.
 * Dialog state survives route suspense and never changes account ownership. */
let open = false
const listeners = new Set<() => void>()
export const isAccountDialogOpen = () => open
export function subscribeAccountDialog(listener: () => void) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}
export function openAccountDialog() {
  open = true
  listeners.forEach((listener) => listener())
}
export function closeAccountDialog() {
  open = false
  listeners.forEach((listener) => listener())
}

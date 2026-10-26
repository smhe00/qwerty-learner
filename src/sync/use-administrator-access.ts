import { getAdministratorAccess } from './api'
import { useEffect, useState } from 'react'

/** Presentation gate only; every administrator API still authorizes server-side. */
export function useAdministratorAccess(token?: string) {
  const [access, setAccess] = useState<{ token?: string; administrator: boolean }>({ administrator: false })
  useEffect(() => {
    setAccess({ administrator: false })
    if (!token) return
    let cancelled = false
    void getAdministratorAccess(token)
      .then((result) => {
        if (!cancelled) setAccess({ token, administrator: result.administrator === true })
      })
      .catch(() => {
        if (!cancelled) setAccess({ token, administrator: false })
      })
    return () => {
      cancelled = true
    }
  }, [token])
  // Never reuse a previous identity's result while checking a new credential.
  return {
    administrator: Boolean(token) && access.token === token && access.administrator,
    checked: !token || access.token === token,
  }
}

import { currentCircleAuth } from './client'
import { useEffect, useState } from 'react'

/** Observe existing credentials without clearing/replacing auth or touching learning storage. */
export function useCircleAuth() {
  const [auth, setAuth] = useState(currentCircleAuth)
  useEffect(() => {
    const update = () => {
      const next = currentCircleAuth()
      setAuth((previous) =>
        previous?.token === next?.token && previous?.user.userId === next?.user.userId && previous?.expiresAt === next?.expiresAt
          ? previous
          : next,
      )
    }
    window.addEventListener('storage', update)
    window.addEventListener('focus', update)
    window.addEventListener('pageshow', update)
    document.addEventListener('visibilitychange', update)
    // Local-only observation also catches same-document logout and token expiry.
    const timer = window.setInterval(update, 1000)
    update()
    return () => {
      clearInterval(timer)
      window.removeEventListener('storage', update)
      window.removeEventListener('focus', update)
      window.removeEventListener('pageshow', update)
      document.removeEventListener('visibilitychange', update)
    }
  }, [])
  return auth
}

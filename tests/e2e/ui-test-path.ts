/** Exercise the actual Pages basename, never rewrite the application's routes. */
export const pagesUI = process.env.REACT_APP_DEPLOY_ENV === 'pages'
export const uiPath = (path: string) => (pagesUI ? '/qwerty-learner' : '') + path

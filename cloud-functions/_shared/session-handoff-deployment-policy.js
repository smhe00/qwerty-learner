// Only the owner-configured SERVER deployment variable enables the etest pilot.
// Missing/unknown values fail closed. Request Host, Origin and headers never select it.
export const isHandoffExperimentEnabled = env => env?.branch === 'etest'

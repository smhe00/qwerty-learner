export const trackPromotionEvent = (
  _event: string,
  _properties: Record<string, string>,
) => {
  // Qwerty Plus Alpha intentionally disables inherited external analytics.
  // Product-learning telemetry remains local unless a future owned analytics
  // endpoint is explicitly configured and documented.
}

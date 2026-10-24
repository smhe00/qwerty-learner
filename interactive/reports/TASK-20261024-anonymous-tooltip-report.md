# Anonymous account tooltip wording — 2026-10-24

Owner request: 未登录时按钮跳出的说明 修改为“单设备使用无需登录”.
Base: bd67c509 (product/main).

Changed only the Header account button title for the unauthenticated state to the exact requested text: 单设备使用无需登录. Visible button label, accessibility label, authenticated/expired tooltips and click behavior unchanged.

Verification: reviewed the one-line source diff and checked whitespace. No new behavioral tests for a tooltip-only wording change. Independent current task and prior release checkpoint preserved. Development change only.
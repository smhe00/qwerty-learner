# PC start-area site guide — 2026-10-24

Owner clarification: use the large PC “任意键开始” area for a concise introduction to the site/interface, not more keyboard-start instructions.
Base: a7ca35e386528e62db151b6e982566ba20ff81b6.

Added shared DesktopStartGuide with three light text columns:
- 模式: Typing 练打字 / Learn 记单词
- 工具: 点词典名选词库 / 右上调整发音与显示
- 记录: 单设备使用无需登录 / 多设备可登录同步

Shown on ready, pre-start PC Learn landing and initial PC keyboard Typing area. No cards/borders, actions, storage or extra keyboard listeners. It disappears on starting and does not return during pause. Initial Typing guide has a canvas backing so blurred word text does not compete with the introduction; ordinary pause blur remains unchanged. Mobile and desktop tap-practice rendering paths remain unchanged. Error/completed/loading Learn states do not show the guide. The previous interrupted turn only inspected sources and made no changes.

Validation: focused UI tests PASS 2/2 for Typing/Learn; verify content, light/dark rendering, 701px desktop no overflow, first key starts without insertion, guide disappears on start and stays absent during pause. Visually inspected Typing light and Learn dark at 1280x800. Scoped ESLint: zero errors, three warnings in existing untouched declarations/hooks. git diff --check PASS. No full suite/build for this presentation-only addition.

Local screenshots: test-results/focus-ui/typing-start-guide.png and learn-start-guide-dark.png. Development only; production approval block from the earlier release request remains unresolved and no deployment promotion was attempted.
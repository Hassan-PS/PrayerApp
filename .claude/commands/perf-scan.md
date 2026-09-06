---
description: Flag performance issues — components >500 lines, missing React.memo, inline object props, setInterval without cleanup, expensive recomputes per render.
allowed-tools: Bash(node scripts/perf-scan.js)
---

Run the performance audit:

```bash
node scripts/perf-scan.js
```

Reports:
- **God components** — `.tsx` files exceeding 400 lines. HomeScreen, SettingsScreen and CompassScreen were the offenders and were split in v1.7.0-beta.1; HomeScreen is still long, but as an orchestrator of memoized children, not a render tree. Judge by what re-renders, not by line count.
- **Missing memoization** — components rendering inline arrow functions or object literals as props to children that look like they should be memoized.
- **`setInterval` / `setTimeout` without cleanup** — effects that don't return a cleanup function.
- **Inline `StyleSheet.create()` inside a component body** — should be hoisted to module scope.
- **Re-render hot paths** — components that subscribe to `now`-style state without isolation. The fix to copy is `HeroToday` in `TodayCard`: the clock lives in the smallest component that shows it, gated on focus AND foreground so it stops when the app is backgrounded.

Output is a punch list. Run before/after refactors (tasks #8–#12) to prove the regression budget.

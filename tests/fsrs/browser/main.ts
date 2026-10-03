import {
  Rating,
  createEmptyCard,
  fsrs,
} from 'ts-fsrs'

const now = new Date('2026-10-03T00:00:00.000Z')
const scheduler = fsrs()
const preview = scheduler.repeat(createEmptyCard(now), now)
const good = preview[Rating.Good]

if (!good || !Number.isFinite(good.card.stability)) {
  throw new Error('FSRS browser probe failed')
}

document.querySelector<HTMLDivElement>('#app')!.textContent = JSON.stringify({
  ok: true,
  due: good.card.due.toISOString(),
  difficulty: good.card.difficulty,
  stability: good.card.stability,
})

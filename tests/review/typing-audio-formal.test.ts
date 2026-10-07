import assert from 'node:assert/strict'
import test from 'node:test'
import { isOwnedAudioEvent } from '../../src/review/audio-lifecycle'

type State = {
  wordEpoch: number
  attemptEpoch: number
  isTyping: boolean
  inputLength: number
  pronunciationEnabled: boolean
  audioReady: boolean
  automaticPlayed: boolean
  playCountByAttempt: Record<number, number>
}

type Event =
  | { type: 'start' }
  | { type: 'type-char' }
  | { type: 'wrong-reset' }
  | { type: 'next-word' }
  | { type: 'audio-ready'; wordEpoch: number }

function initialState(): State {
  return {
    wordEpoch: 0,
    attemptEpoch: 0,
    isTyping: false,
    inputLength: 0,
    pronunciationEnabled: true,
    audioReady: false,
    automaticPlayed: false,
    playCountByAttempt: {},
  }
}

function maybePlay(state: State): State {
  if (
    !state.isTyping ||
    state.inputLength !== 0 ||
    !state.pronunciationEnabled ||
    !state.audioReady ||
    state.automaticPlayed
  ) {
    return state
  }

  return {
    ...state,
    automaticPlayed: true,
    playCountByAttempt: {
      ...state.playCountByAttempt,
      [state.attemptEpoch]:
        (state.playCountByAttempt[state.attemptEpoch] ?? 0) + 1,
    },
  }
}

function step(state: State, event: Event): State {
  switch (event.type) {
    case 'start':
      return maybePlay({ ...state, isTyping: true })
    case 'type-char':
      return { ...state, inputLength: state.inputLength + 1 }
    case 'wrong-reset':
      return maybePlay({
        ...state,
        attemptEpoch: state.attemptEpoch + 1,
        inputLength: 0,
        automaticPlayed: false,
      })
    case 'next-word':
      return {
        ...state,
        wordEpoch: state.wordEpoch + 1,
        attemptEpoch: state.attemptEpoch + 1,
        inputLength: 0,
        audioReady: false,
        automaticPlayed: false,
      }
    case 'audio-ready':
      if (event.wordEpoch !== state.wordEpoch) return state
      return maybePlay({ ...state, audioReady: true })
  }
}

test('formal/typing-audio: next word resets per-attempt audio state and ignores stale readiness', () => {
  let state = initialState()
  state = step(state, { type: 'start' })
  state = step(state, { type: 'audio-ready', wordEpoch: 0 })
  assert.equal(state.playCountByAttempt[0], 1)

  state = step(state, { type: 'type-char' })
  state = step(state, { type: 'next-word' })

  assert.equal(state.wordEpoch, 1)
  assert.equal(state.inputLength, 0)
  assert.equal(state.audioReady, false)
  assert.equal(state.automaticPlayed, false)

  state = step(state, { type: 'audio-ready', wordEpoch: 0 })
  assert.equal(state.audioReady, false)
  assert.equal(state.playCountByAttempt[1] ?? 0, 0)

  state = step(state, { type: 'audio-ready', wordEpoch: 1 })
  assert.equal(state.playCountByAttempt[1], 1)
})

test('formal/typing-audio: bounded event exploration never plays more than once per attempt', () => {
  const events: Event[] = [
    { type: 'start' },
    { type: 'type-char' },
    { type: 'wrong-reset' },
    { type: 'next-word' },
    { type: 'audio-ready', wordEpoch: 0 },
    { type: 'audio-ready', wordEpoch: 1 },
    { type: 'audio-ready', wordEpoch: 2 },
  ]

  let explored = 0

  const visit = (state: State, depth: number) => {
    for (const count of Object.values(state.playCountByAttempt)) {
      assert.ok(count <= 1)
    }

    if (depth === 0) {
      explored += 1
      return
    }

    for (const event of events) {
      visit(step(state, event), depth - 1)
    }
  }

  visit(initialState(), 5)
  assert.equal(explored, events.length ** 5)
})

test('formal/typing-audio: two clean consecutive words each become audible once ready', () => {
  let state = initialState()
  state = step(state, { type: 'start' })
  state = step(state, { type: 'audio-ready', wordEpoch: 0 })
  state = step(state, { type: 'type-char' })
  state = step(state, { type: 'next-word' })

  assert.equal(state.playCountByAttempt[0], 1)
  assert.equal(state.playCountByAttempt[1] ?? 0, 0)

  state = step(state, { type: 'audio-ready', wordEpoch: 1 })
  assert.equal(state.playCountByAttempt[1], 1)
})


test('formal/audio-ownership: only the current owner may mutate or play audio', () => {
  const owners = ['0:alpha', '1:beta', '2:alpha']
  let explored = 0

  for (const currentOwner of owners) {
    for (const eventOwner of owners) {
      explored += 1
      assert.equal(
        isOwnedAudioEvent(currentOwner, eventOwner),
        currentOwner === eventOwner,
      )
    }
  }

  assert.equal(explored, owners.length ** 2)
})

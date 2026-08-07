const KEY = 'liftlog-mini-v1'
const SCHEMA_VERSION = 2

const defaultState = {
  schemaVersion: SCHEMA_VERSION,
  settings: { calorieGoal: 2200 },
  exercises: [
    { id: 'bench-press', name: '杠铃卧推' },
    { id: 'squat', name: '深蹲' },
    { id: 'deadlift', name: '硬拉' },
    { id: 'lat-pulldown', name: '高位下拉' },
    { id: 'seated-row', name: '坐姿划船' },
    { id: 'shoulder-press', name: '肩推' },
    { id: 'biceps-curl', name: '二头弯举' },
    { id: 'triceps-pushdown', name: '三头下压' }
  ],
  records: [],
  foodRecords: []
}

function clone(value) {
  return JSON.parse(JSON.stringify(value))
}

function migrate(saved) {
  if (!saved || !saved.exercises) return clone(defaultState)

  const oldGoal = Number(saved.settings && saved.settings.calorieGoal)
  const calorieGoal = oldGoal >= 800 ? oldGoal : defaultState.settings.calorieGoal

  return {
    schemaVersion: SCHEMA_VERSION,
    settings: { calorieGoal },
    exercises: Array.isArray(saved.exercises) && saved.exercises.length
      ? saved.exercises
      : clone(defaultState.exercises),
    records: Array.isArray(saved.records) ? saved.records.map(record => ({
      id: record.id,
      date: record.date,
      exerciseId: record.exerciseId,
      sets: Array.isArray(record.sets) ? record.sets : [],
      createdAt: record.createdAt
    })) : [],
    foodRecords: Array.isArray(saved.foodRecords) ? saved.foodRecords : []
  }
}

function ensureState() {
  const saved = wx.getStorageSync(KEY)
  const state = saved && saved.schemaVersion === SCHEMA_VERSION
    ? Object.assign(clone(defaultState), saved, {
        settings: Object.assign({}, defaultState.settings, saved.settings || {}),
        foodRecords: Array.isArray(saved.foodRecords) ? saved.foodRecords : []
      })
    : migrate(saved)
  wx.setStorageSync(KEY, state)
  return state
}

function getState() {
  return ensureState()
}

function saveState(state) {
  state.schemaVersion = SCHEMA_VERSION
  wx.setStorageSync(KEY, state)
}

function addRecord(record) {
  const state = getState()
  state.records.push(record)
  saveState(state)
  return state
}

function addFoodRecord(record) {
  const state = getState()
  state.foodRecords.push(record)
  saveState(state)
  return state
}

function deleteFoodRecord(id) {
  const state = getState()
  state.foodRecords = state.foodRecords.filter(item => item.id !== id)
  saveState(state)
  return state
}

function addExercise(name) {
  const state = getState()
  const clean = String(name || '').trim()
  if (!clean) return null
  const existing = state.exercises.find(item => item.name === clean)
  if (existing) return existing
  const item = { id: `exercise-${Date.now()}`, name: clean }
  state.exercises.push(item)
  saveState(state)
  return item
}

function updateSettings(settings) {
  const state = getState()
  state.settings = Object.assign({}, state.settings, settings)
  saveState(state)
  return state
}

module.exports = {
  KEY,
  getState,
  saveState,
  addRecord,
  addFoodRecord,
  deleteFoodRecord,
  addExercise,
  updateSettings
}

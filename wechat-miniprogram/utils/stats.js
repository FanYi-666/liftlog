function localDateISO(date = new Date()) {
  const y = date.getFullYear()
  const m = String(date.getMonth() + 1).padStart(2, '0')
  const d = String(date.getDate()).padStart(2, '0')
  return `${y}-${m}-${d}`
}

function daysAgoISO(days) {
  const date = new Date()
  date.setHours(12, 0, 0, 0)
  date.setDate(date.getDate() - days)
  return localDateISO(date)
}

function sumReps(sets) {
  return (sets || []).reduce((sum, set) => sum + Number(set.reps || 0), 0)
}

function sumVolume(sets) {
  return (sets || []).reduce((sum, set) => sum + Number(set.weight || 0) * Number(set.reps || 0), 0)
}

function aggregate(records) {
  return (records || []).reduce((out, record) => {
    out.sets += (record.sets || []).length
    out.reps += sumReps(record.sets)
    out.volume += sumVolume(record.sets)
    return out
  }, { sets: 0, reps: 0, volume: 0 })
}

function sumFoodCalories(records) {
  return (records || []).reduce((sum, record) => sum + Number(record.calories || 0), 0)
}

function formatDate(iso) {
  const parts = String(iso || '').split('-')
  if (parts.length !== 3) return iso || ''
  return `${Number(parts[1])}月${Number(parts[2])}日`
}

function groupByDate(records) {
  return (records || []).reduce((out, record) => {
    if (!out[record.date]) out[record.date] = []
    out[record.date].push(record)
    return out
  }, {})
}

module.exports = {
  localDateISO,
  daysAgoISO,
  sumReps,
  sumVolume,
  aggregate,
  sumFoodCalories,
  formatDate,
  groupByDate
}

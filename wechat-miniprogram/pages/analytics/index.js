const store = require('../../utils/store')
const stats = require('../../utils/stats')

function maxWeight(records) {
  let max = 0
  ;(records || []).forEach(record => {
    ;(record.sets || []).forEach(set => {
      max = Math.max(max, Number(set.weight || 0))
    })
  })
  return max
}

function metricValue(records, key) {
  const total = stats.aggregate(records || [])
  if (key === 'maxWeight') return maxWeight(records)
  if (key === 'sets') return total.sets
  if (key === 'reps') return total.reps
  return total.volume
}

Page({
  data: {
    exercises: [],
    exerciseNames: [],
    exerciseIndex: 0,
    ranges: [7, 30, 90, 365],
    rangeLabels: ['7 天', '30 天', '90 天', '1 年'],
    rangeIndex: 1,
    metricOptions: [
      { key: 'volume', label: '训练容量', unit: 'kg' },
      { key: 'maxWeight', label: '最高重量', unit: 'kg' },
      { key: 'sets', label: '总组数', unit: '组' },
      { key: 'reps', label: '总次数', unit: '次' }
    ],
    metricIndex: 0,
    metricLabel: '训练容量',
    metricUnit: 'kg',
    summary: { sets: 0, reps: 0, volume: 0, maxWeight: 0 },
    trend: [],
    history: []
  },

  onShow() {
    const state = store.getState()
    const exerciseIndex = Math.min(this.data.exerciseIndex, Math.max(0, state.exercises.length - 1))
    this.setData({
      exercises: state.exercises,
      exerciseNames: state.exercises.map(item => item.name),
      exerciseIndex
    }, () => this.refresh())
  },

  changeExercise(e) {
    this.setData({ exerciseIndex: Number(e.detail.value) || 0 }, () => this.refresh())
  },

  changeRange(e) {
    this.setData({ rangeIndex: Number(e.detail.value) || 0 }, () => this.refresh())
  },

  changeMetric(e) {
    const metricIndex = Number(e.currentTarget.dataset.index) || 0
    this.setData({ metricIndex }, () => this.refresh())
  },

  refresh() {
    const state = store.getState()
    const exercise = state.exercises[this.data.exerciseIndex]
    if (!exercise) return

    const days = this.data.ranges[this.data.rangeIndex]
    const metric = this.data.metricOptions[this.data.metricIndex] || this.data.metricOptions[0]
    const start = stats.daysAgoISO(days - 1)
    const records = state.records.filter(item => item.exerciseId === exercise.id && item.date >= start)
    const summary = stats.aggregate(records)
    const grouped = stats.groupByDate(records)

    const rawTrend = []
    let maxValue = 1
    for (let i = days - 1; i >= 0; i -= 1) {
      const date = stats.daysAgoISO(i)
      const value = metricValue(grouped[date] || [], metric.key)
      maxValue = Math.max(maxValue, value)
      rawTrend.push({
        date,
        label: date.slice(5).replace('-', '/'),
        value: Math.round(value * 10) / 10
      })
    }

    const trend = rawTrend.map(item => Object.assign({}, item, {
      width: Math.max(item.value ? 4 : 0, Math.round(item.value / maxValue * 100)),
      displayValue: `${item.value}${metric.unit ? ` ${metric.unit}` : ''}`
    }))

    const history = Object.keys(grouped).sort().reverse().map(date => {
      const dayRecords = grouped[date]
      const sets = []
      dayRecords.forEach(record => {
        ;(record.sets || []).forEach(set => sets.push({
          weight: Number(set.weight || 0),
          reps: Number(set.reps || 0)
        }))
      })
      const day = stats.aggregate(dayRecords)
      return {
        date,
        dateLabel: stats.formatDate(date),
        sets,
        setCount: day.sets,
        reps: day.reps,
        volume: Math.round(day.volume),
        maxWeight: maxWeight(dayRecords)
      }
    })

    this.setData({
      metricLabel: metric.label,
      metricUnit: metric.unit,
      summary: {
        sets: summary.sets,
        reps: summary.reps,
        volume: Math.round(summary.volume),
        maxWeight: maxWeight(records)
      },
      trend,
      history
    })
  }
})

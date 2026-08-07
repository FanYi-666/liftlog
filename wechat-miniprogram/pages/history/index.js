const store = require('../../utils/store')
const stats = require('../../utils/stats')

Page({
  data: { days: [] },

  onShow() {
    const state = store.getState()
    const grouped = stats.groupByDate(state.records)
    const days = Object.keys(grouped).sort().reverse().map(date => {
      const records = grouped[date].map(record => {
        const exercise = state.exercises.find(item => item.id === record.exerciseId)
        return {
          id: record.id,
          name: exercise ? exercise.name : '已删除动作',
          sets: record.sets.length,
          reps: stats.sumReps(record.sets),
          volume: Math.round(stats.sumVolume(record.sets))
        }
      })
      const total = stats.aggregate(grouped[date])
      return {
        date,
        dateLabel: stats.formatDate(date),
        records,
        total: {
          sets: total.sets,
          reps: total.reps,
          volume: Math.round(total.volume)
        }
      }
    })
    this.setData({ days })
  }
})

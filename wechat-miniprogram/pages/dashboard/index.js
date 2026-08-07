const store = require('../../utils/store')
const stats = require('../../utils/stats')

Page({
  data: {
    todayFood: { calories: 0, goal: 2200, remaining: 2200, status: '剩余' },
    todayTraining: { sets: 0, reps: 0, volume: 0 },
    caloriePercent: 0,
    weekly: [],
    recent: []
  },

  onShow() {
    this.refresh()
  },

  refresh() {
    const state = store.getState()
    const todayISO = stats.localDateISO()
    const todayTrainingRecords = state.records.filter(item => item.date === todayISO)
    const training = stats.aggregate(todayTrainingRecords)
    const foodCalories = Math.round(stats.sumFoodCalories(state.foodRecords.filter(item => item.date === todayISO)))
    const goal = Number(state.settings.calorieGoal || 2200)
    const delta = goal - foodCalories

    const weeklyRaw = []
    let maxVolume = 1
    for (let i = 6; i >= 0; i -= 1) {
      const date = stats.daysAgoISO(i)
      const value = stats.aggregate(state.records.filter(item => item.date === date)).volume
      maxVolume = Math.max(maxVolume, value)
      weeklyRaw.push({ date, label: date.slice(5).replace('-', '/'), volume: value })
    }

    const weekly = weeklyRaw.map(item => Object.assign({}, item, {
      height: Math.max(6, Math.round(item.volume / maxVolume * 150))
    }))

    const recent = state.records.slice()
      .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))
      .slice(0, 4)
      .map(record => {
        const exercise = state.exercises.find(item => item.id === record.exerciseId)
        return {
          id: record.id,
          name: exercise ? exercise.name : '已删除动作',
          date: stats.formatDate(record.date),
          sets: record.sets.length,
          reps: stats.sumReps(record.sets),
          volume: Math.round(stats.sumVolume(record.sets))
        }
      })

    this.setData({
      todayFood: {
        calories: foodCalories,
        goal,
        remaining: Math.abs(delta),
        status: delta >= 0 ? '剩余' : '超出'
      },
      todayTraining: {
        sets: training.sets,
        reps: training.reps,
        volume: Math.round(training.volume)
      },
      caloriePercent: Math.round(foodCalories / Math.max(1, goal) * 100),
      weekly,
      recent
    })
  },

  goSettings() {
    wx.navigateTo({ url: '/pages/settings/index' })
  },

  goLog() {
    wx.switchTab({ url: '/pages/log/index' })
  },

  goFood() {
    wx.switchTab({ url: '/pages/calories/index' })
  }
})

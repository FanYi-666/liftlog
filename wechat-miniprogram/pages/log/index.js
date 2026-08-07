const store = require('../../utils/store')
const stats = require('../../utils/stats')

Page({
  data: {
    exercises: [],
    exerciseNames: [],
    exerciseIndex: 0,
    sets: [
      { weight: '', reps: '' },
      { weight: '', reps: '' },
      { weight: '', reps: '' }
    ],
    newExerciseName: ''
  },

  onShow() {
    this.loadExercises()
  },

  loadExercises(selectId) {
    const state = store.getState()
    let index = this.data.exerciseIndex
    if (selectId) {
      const found = state.exercises.findIndex(item => item.id === selectId)
      if (found >= 0) index = found
    }
    if (index >= state.exercises.length) index = 0
    this.setData({
      exercises: state.exercises,
      exerciseNames: state.exercises.map(item => item.name),
      exerciseIndex: index
    })
  },

  changeExercise(e) {
    this.setData({ exerciseIndex: Number(e.detail.value) || 0 })
  },

  setSetField(e) {
    const index = Number(e.currentTarget.dataset.index)
    const field = e.currentTarget.dataset.field
    this.setData({ [`sets[${index}].${field}`]: e.detail.value })
  },

  addSet() {
    const sets = this.data.sets.slice()
    const last = sets[sets.length - 1] || { weight: '', reps: '' }
    sets.push({ weight: last.weight, reps: '' })
    this.setData({ sets })
  },

  removeSet(e) {
    const index = Number(e.currentTarget.dataset.index)
    const sets = this.data.sets.slice()
    if (sets.length === 1) sets[0] = { weight: '', reps: '' }
    else sets.splice(index, 1)
    this.setData({ sets })
  },

  copyLast() {
    const exercise = this.data.exercises[this.data.exerciseIndex]
    if (!exercise) return
    const state = store.getState()
    const last = state.records.slice()
      .filter(item => item.exerciseId === exercise.id)
      .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))[0]
    if (!last) {
      wx.showToast({ title: '暂无上次记录', icon: 'none' })
      return
    }
    this.setData({
      sets: last.sets.map(item => ({ weight: String(item.weight), reps: String(item.reps) }))
    })
    wx.showToast({ title: '已复制上次记录', icon: 'success' })
  },

  newExerciseInput(e) {
    this.setData({ newExerciseName: e.detail.value })
  },

  addExercise() {
    const item = store.addExercise(this.data.newExerciseName)
    if (!item) {
      wx.showToast({ title: '请输入动作名称', icon: 'none' })
      return
    }
    this.setData({ newExerciseName: '' })
    this.loadExercises(item.id)
    wx.showToast({ title: '动作已添加', icon: 'success' })
  },

  saveWorkout() {
    const exercise = this.data.exercises[this.data.exerciseIndex]
    if (!exercise) {
      wx.showToast({ title: '请选择动作', icon: 'none' })
      return
    }

    const validSets = this.data.sets.map(item => ({
      weight: Number(item.weight || 0),
      reps: Number(item.reps || 0)
    })).filter(item => item.weight >= 0 && item.reps > 0)

    if (!validSets.length) {
      wx.showToast({ title: '至少填写一组次数', icon: 'none' })
      return
    }

    const now = new Date()
    store.addRecord({
      id: `record-${Date.now()}`,
      date: stats.localDateISO(now),
      exerciseId: exercise.id,
      sets: validSets,
      createdAt: now.toISOString()
    })

    this.setData({
      sets: [{ weight: '', reps: '' }, { weight: '', reps: '' }, { weight: '', reps: '' }]
    })
    wx.showToast({ title: '训练已保存', icon: 'success' })
  }
})

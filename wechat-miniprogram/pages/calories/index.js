const store = require('../../utils/store')
const stats = require('../../utils/stats')

Page({
  data: {
    date: '',
    mealIndex: 1,
    meals: ['早餐', '午餐', '晚餐', '加餐'],
    foodName: '',
    calories: '',
    dayTotal: 0,
    goal: 2200,
    remaining: 2200,
    status: '剩余',
    entries: [],
    recentDays: []
  },

  onLoad() {
    this.setData({ date: stats.localDateISO() })
  },

  onShow() {
    if (!this.data.date) this.setData({ date: stats.localDateISO() })
    this.refresh()
  },

  changeDate(e) {
    this.setData({ date: e.detail.value }, () => this.refresh())
  },

  changeMeal(e) {
    this.setData({ mealIndex: Number(e.detail.value) || 0 })
  },

  setFoodName(e) {
    this.setData({ foodName: e.detail.value })
  },

  setCalories(e) {
    this.setData({ calories: e.detail.value })
  },

  saveFood() {
    const calories = Number(this.data.calories || 0)
    if (!calories || calories <= 0) {
      wx.showToast({ title: '请输入热量', icon: 'none' })
      return
    }

    const meal = this.data.meals[this.data.mealIndex] || '加餐'
    const name = String(this.data.foodName || '').trim() || meal
    store.addFoodRecord({
      id: `food-${Date.now()}`,
      date: this.data.date || stats.localDateISO(),
      meal,
      name,
      calories: Math.round(calories),
      createdAt: new Date().toISOString()
    })

    this.setData({ foodName: '', calories: '' })
    this.refresh()
    wx.showToast({ title: '饮食已记录', icon: 'success' })
  },

  deleteFood(e) {
    const id = e.currentTarget.dataset.id
    store.deleteFoodRecord(id)
    this.refresh()
    wx.showToast({ title: '已删除', icon: 'none' })
  },

  refresh() {
    const state = store.getState()
    const goal = Number(state.settings.calorieGoal || 2200)
    const date = this.data.date || stats.localDateISO()
    const entries = state.foodRecords
      .filter(item => item.date === date)
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')))
      .map(item => ({
        id: item.id,
        meal: item.meal || '饮食',
        name: item.name || '未命名',
        calories: Math.round(Number(item.calories || 0))
      }))
    const dayTotal = Math.round(stats.sumFoodCalories(entries))
    const delta = goal - dayTotal

    const recentDays = []
    for (let i = 0; i < 7; i += 1) {
      const day = stats.daysAgoISO(i)
      const total = Math.round(stats.sumFoodCalories(state.foodRecords.filter(item => item.date === day)))
      recentDays.push({
        date: day,
        label: stats.formatDate(day),
        total,
        diff: total - goal,
        diffLabel: total > goal ? `超出 ${total - goal}` : `剩余 ${goal - total}`
      })
    }

    this.setData({
      entries,
      dayTotal,
      goal,
      remaining: Math.abs(delta),
      status: delta >= 0 ? '剩余' : '超出',
      recentDays
    })
  }
})

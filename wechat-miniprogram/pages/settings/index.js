const store = require('../../utils/store')

Page({
  data: { calorieGoal: 2200 },

  onShow() {
    const state = store.getState()
    this.setData({ calorieGoal: state.settings.calorieGoal || 2200 })
  },

  setGoal(e) {
    this.setData({ calorieGoal: e.detail.value })
  },

  save() {
    store.updateSettings({
      calorieGoal: Math.max(800, Number(this.data.calorieGoal || 2200))
    })
    wx.showToast({ title: '设置已保存', icon: 'success' })
  }
})

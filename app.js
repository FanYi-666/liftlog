const STORAGE_KEY = "liftlog-v1";
const SCHEMA_VERSION = 11;

const defaultState = {
  schemaVersion: SCHEMA_VERSION,
  settings: {
    calorieGoal: 2200,
    proteinGoal: 140,
    carbsGoal: 250,
    fatGoal: 70,
    restSeconds: 120,
  },
  exercises: [
    { id: "bench-press", name: "杠铃卧推", mode: "weighted", primaryMuscle: "胸", equipment: "barbell" },
    { id: "squat", name: "深蹲", mode: "weighted", primaryMuscle: "股四头", equipment: "barbell" },
    { id: "deadlift", name: "硬拉", mode: "weighted", primaryMuscle: "后链", equipment: "barbell" },
    { id: "lat-pulldown", name: "高位下拉", mode: "weighted", primaryMuscle: "背", equipment: "machine" },
    { id: "seated-row", name: "坐姿划船", mode: "weighted", primaryMuscle: "背", equipment: "machine" },
    { id: "shoulder-press", name: "肩推", mode: "weighted", primaryMuscle: "肩", equipment: "machine" },
    { id: "biceps-curl", name: "二头弯举", mode: "weighted", primaryMuscle: "二头", equipment: "dumbbell" },
    { id: "triceps-pushdown", name: "三头下压", mode: "weighted", primaryMuscle: "三头", equipment: "machine" },
    { id: "push-up", name: "俯卧撑", mode: "bodyweight", primaryMuscle: "胸", equipment: "bodyweight" },
  ],
  records: [],
  foodRecords: [],
  bodyRecords: [],
  mealPresets: [],
  templates: [],
  weeklyPlan: Array.from({ length: 7 }, (_, dayIndex) => ({ dayIndex, isTrainingDay: false, templateId: "", reminderTime: "" })),
  trainingProfile: {
    goal: "hypertrophy",
    level: "intermediate",
    daysPerWeek: 4,
    sessionMinutes: 60,
    equipment: ["barbell", "dumbbell", "machine", "bodyweight"],
  },
  planOverrides: [],
};

const ANALYTICS_METRICS = {
  volume: { label: "训练容量", unit: "kg", badge: "重量 × 次数" },
  maxWeight: { label: "最高重量", unit: "kg", badge: "单组最大重量" },
  sets: { label: "总组数", unit: "组", badge: "每日完成组数" },
  reps: { label: "总次数", unit: "次", badge: "每日完成次数" },
};

let state;
const newDraftSet = (source = {}) => ({
  weight: source.weight ?? "",
  reps: source.reps ?? "",
  type: source.type || "normal",
  rpe: source.rpe ?? "",
  completed: Boolean(source.completed),
});
let draftSets = [newDraftSet(), newDraftSet(), newDraftSet()];
let analyticsMetricKey = "volume";
let editingWorkoutId = null;
let editingFoodId = null;
let editingExerciseId = null;
let exerciseEditorOrigin = "training";
let activeTemplateId = null;
let activeTemplateIndex = 0;
let activeRuntimeTemplate = null;
let editingTemplateId = null;
let templateEditDraft = null;
let restTimerRemaining = 0;
let restTimerHandle = null;
let activeGroup = null;
let calendarMonthOffset = 0;
let creatorDraftTemplate = null;
let pendingFeedbackRecordId = null;
let adaptivePlanDraft = [];
let nutritionRangeDays = 7;
let editingBodyDate = null;

const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];

function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

function inferExerciseMode(name, mode) {
  if (mode === "bodyweight" || mode === "weighted") return mode;
  const text = String(name || "").toLowerCase().replace(/\s+/g, "");
  return /俯卧撑|push-?up|pushup|徒手深蹲|air squat/.test(text) ? "bodyweight" : "weighted";
}

const MUSCLE_GROUPS = ["胸", "背", "肩", "二头", "三头", "股四头", "后链", "臀", "小腿", "核心", "其他"];
const EQUIPMENT_TYPES = ["barbell", "dumbbell", "machine", "bodyweight", "other"];
const EQUIPMENT_LABELS = { barbell: "杠铃", dumbbell: "哑铃", machine: "器械", bodyweight: "自重", other: "其他" };

function inferEquipment(name, mode, savedEquipment) {
  if (EQUIPMENT_TYPES.includes(savedEquipment)) return savedEquipment;
  if (mode === "bodyweight") return "bodyweight";
  const text = String(name || "").toLowerCase();
  if (/杠铃|barbell|卧推|深蹲|硬拉/.test(text)) return "barbell";
  if (/哑铃|dumbbell/.test(text)) return "dumbbell";
  if (/下拉|划船|pushdown|器械|machine|cable/.test(text)) return "machine";
  return "other";
}

function normalizeTrainingProfile(profile) {
  const source = profile || {};
  const equipment = Array.isArray(source.equipment) ? source.equipment.filter((item) => EQUIPMENT_TYPES.includes(item)) : [];
  return {
    goal: ["hypertrophy", "strength", "fatloss"].includes(source.goal) ? source.goal : "hypertrophy",
    level: ["beginner", "intermediate", "advanced"].includes(source.level) ? source.level : "intermediate",
    daysPerWeek: Math.min(6, Math.max(2, Number(source.daysPerWeek) || 4)),
    sessionMinutes: [30, 45, 60, 75, 90].includes(Number(source.sessionMinutes)) ? Number(source.sessionMinutes) : 60,
    equipment: equipment.length ? equipment : ["barbell", "dumbbell", "machine", "bodyweight"],
  };
}

function inferPrimaryMuscle(name, id, savedMuscle) {
  if (MUSCLE_GROUPS.includes(savedMuscle)) return savedMuscle;
  const text = `${id || ""} ${name || ""}`.toLowerCase().replace(/\s+/g, "");
  if (/bench|push-?up|卧推|俯卧撑|飞鸟|夹胸/.test(text)) return "胸";
  if (/lat|row|pull-?up|下拉|划船|引体/.test(text)) return "背";
  if (/shoulder|press|raise|肩推|推举|侧平举|前平举/.test(text)) return "肩";
  if (/biceps|curl|二头|弯举/.test(text)) return "二头";
  if (/triceps|pushdown|三头|臂屈伸/.test(text)) return "三头";
  if (/squat|legpress|extension|深蹲|腿举|腿屈伸/.test(text)) return "股四头";
  if (/deadlift|rdl|hamstring|硬拉|腿弯举|腘绳/.test(text)) return "后链";
  if (/hipthrust|glute|臀推|臀桥/.test(text)) return "臀";
  if (/calf|小腿|提踵/.test(text)) return "小腿";
  if (/plank|crunch|abs|core|平板|卷腹|腹/.test(text)) return "核心";
  return "其他";
}

function normalizeExercises(exercises) {
  const source = Array.isArray(exercises) && exercises.length ? exercises : clone(defaultState.exercises);
  const normalized = source.map((exercise) => {
    const mode = inferExerciseMode(exercise.name, exercise.mode);
    return {
      ...exercise,
      mode,
      primaryMuscle: inferPrimaryMuscle(exercise.name, exercise.id, exercise.primaryMuscle),
      equipment: inferEquipment(exercise.name, mode, exercise.equipment),
      restSeconds: Number(exercise.restSeconds) >= 30 ? Math.min(600, Number(exercise.restSeconds)) : null,
      focusMetric: exercise.focusMetric || (mode === "bodyweight" ? "reps" : "volume"),
      barWeight: Number(exercise.barWeight) > 0 ? Number(exercise.barWeight) : 20,
    };
  });
  if (!normalized.some((exercise) => exercise.id === "push-up" || exercise.name === "俯卧撑")) {
    normalized.push({ id: "push-up", name: "俯卧撑", mode: "bodyweight", primaryMuscle: "胸", equipment: "bodyweight", restSeconds: 90, focusMetric: "reps", barWeight: 20 });
  }
  return normalized;
}

function normalizeWeeklyPlan(plan) {
  const source = Array.isArray(plan) ? plan : [];
  return Array.from({ length: 7 }, (_, dayIndex) => {
    const saved = source.find((item) => Number(item.dayIndex) === dayIndex) || source[dayIndex] || {};
    const legacyTrainingDay = Boolean(saved.templateId);
    const isTrainingDay = saved.isTrainingDay == null ? legacyTrainingDay : Boolean(saved.isTrainingDay);
    return {
      dayIndex,
      isTrainingDay,
      templateId: isTrainingDay ? String(saved.templateId || "") : "",
      reminderTime: isTrainingDay && /^\d{2}:\d{2}$/.test(String(saved.reminderTime || "")) ? String(saved.reminderTime) : (isTrainingDay ? "18:00" : ""),
    };
  });
}

function normalizePlanOverrides(overrides) {
  if (!Array.isArray(overrides)) return [];
  const today = localDateISO();
  return overrides
    .filter((item) => /^\d{4}-\d{2}-\d{2}$/.test(String(item?.date || "")) && String(item.date) >= today)
    .map((item) => ({
      date: String(item.date),
      templateId: String(item.templateId || ""),
      reason: String(item.reason || "智能恢复调节"),
      createdAt: item.createdAt || new Date().toISOString(),
    }));
}

function normalizeFoodRecords(records) {
  if (!Array.isArray(records)) return [];
  return records.map((record) => ({
    ...record,
    id: record.id || (crypto.randomUUID?.() || `food-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
    date: /^\d{4}-\d{2}-\d{2}$/.test(String(record.date || "")) ? String(record.date) : localDateISO(),
    meal: ["早餐", "午餐", "晚餐", "加餐"].includes(record.meal) ? record.meal : "加餐",
    name: String(record.name || record.meal || "饮食"),
    calories: Math.max(0, Math.round(Number(record.calories) || 0)),
    protein: Math.max(0, Number(record.protein) || 0),
    carbs: Math.max(0, Number(record.carbs) || 0),
    fat: Math.max(0, Number(record.fat) || 0),
    createdAt: record.createdAt || new Date().toISOString(),
    updatedAt: record.updatedAt,
  })).filter((record) => record.calories > 0 || record.protein > 0 || record.carbs > 0 || record.fat > 0);
}

function normalizeBodyRecords(records) {
  if (!Array.isArray(records)) return [];
  const byDate = new Map();
  records.forEach((record) => {
    const date = String(record?.date || "");
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return;
    const weight = Number(record.weight) > 0 ? Number(record.weight) : null;
    const bodyFat = Number(record.bodyFat) > 0 ? Number(record.bodyFat) : null;
    if (!weight && !bodyFat) return;
    byDate.set(date, {
      date,
      weight,
      bodyFat,
      createdAt: record.createdAt || new Date().toISOString(),
      updatedAt: record.updatedAt,
    });
  });
  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

function normalizeMealPresets(presets) {
  if (!Array.isArray(presets)) return [];
  return presets.map((preset) => ({
    id: preset.id || (crypto.randomUUID?.() || `meal-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`),
    name: String(preset.name || "常用餐"),
    meal: ["早餐", "午餐", "晚餐", "加餐"].includes(preset.meal) ? preset.meal : "加餐",
    items: normalizeFoodRecords((preset.items || []).map((item) => ({ ...item, date: localDateISO() }))).map(({ name, calories, protein, carbs, fat }) => ({ name, calories, protein, carbs, fat })),
    createdAt: preset.createdAt || new Date().toISOString(),
    useCount: Math.max(0, Number(preset.useCount) || 0),
    lastUsedAt: preset.lastUsedAt || "",
  })).filter((preset) => preset.items.length);
}

function normalizeTemplates(templates) {
  if (!Array.isArray(templates)) return [];
  return templates.map((template) => ({
    ...template,
    id: template.id || (crypto.randomUUID?.() || `template-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`),
    name: String(template.name || "训练模板"),
    exercises: Array.isArray(template.exercises) ? template.exercises.map((item) => ({
      exerciseId: item.exerciseId,
      note: item.note || "",
      sets: Array.isArray(item.sets) ? item.sets.map((set) => ({
        weight: Number(set.weight) || 0,
        reps: Number(set.reps) || 0,
        type: set.type || "normal",
        rpe: set.rpe === "" || set.rpe == null ? "" : Number(set.rpe),
      })) : [],
    })) : [],
  }));
}

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (!saved) return clone(defaultState);

    const oldGoal = Number(saved.settings?.calorieGoal);
    const calorieGoal = oldGoal >= 800 ? oldGoal : defaultState.settings.calorieGoal;
    const proteinGoal = Math.max(0, Number(saved.settings?.proteinGoal) || defaultState.settings.proteinGoal);
    const carbsGoal = Math.max(0, Number(saved.settings?.carbsGoal) || defaultState.settings.carbsGoal);
    const fatGoal = Math.max(0, Number(saved.settings?.fatGoal) || defaultState.settings.fatGoal);
    const restSeconds = Math.min(600, Math.max(15, Number(saved.settings?.restSeconds) || defaultState.settings.restSeconds));
    const records = Array.isArray(saved.records)
      ? saved.records.map((record) => ({
          id: record.id,
          date: record.date,
          exerciseId: record.exerciseId,
          sets: Array.isArray(record.sets) ? record.sets.map((set) => ({
            weight: Number(set.weight) || 0,
            reps: Number(set.reps) || 0,
            type: set.type || "normal",
            rpe: set.rpe === "" || set.rpe == null ? "" : Number(set.rpe),
            completed: set.completed !== false,
          })) : [],
          note: record.note || "",
          feedback: ["easy", "good", "hard"].includes(record.feedback) ? record.feedback : "",
          groupId: record.groupId || "",
          groupMode: record.groupMode || "",
          groupOrder: Number.isFinite(Number(record.groupOrder)) ? Number(record.groupOrder) : null,
          createdAt: record.createdAt,
        }))
      : [];

    return {
      schemaVersion: SCHEMA_VERSION,
      settings: { calorieGoal, proteinGoal, carbsGoal, fatGoal, restSeconds },
      exercises: normalizeExercises(saved.exercises),
      records,
      foodRecords: normalizeFoodRecords(saved.foodRecords),
      bodyRecords: normalizeBodyRecords(saved.bodyRecords),
      mealPresets: normalizeMealPresets(saved.mealPresets),
      templates: normalizeTemplates(saved.templates),
      weeklyPlan: normalizeWeeklyPlan(saved.weeklyPlan),
      trainingProfile: normalizeTrainingProfile(saved.trainingProfile),
      planOverrides: normalizePlanOverrides(saved.planOverrides),
    };
  } catch {
    return clone(defaultState);
  }
}

state = loadState();

function saveState() {
  state.schemaVersion = SCHEMA_VERSION;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

function localDateISO(date = new Date()) {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

function dateFromISO(iso) {
  const [y, m, d] = String(iso || "").split("-").map(Number);
  return new Date(y, m - 1, d);
}

function daysAgoISO(days) {
  const date = new Date();
  date.setHours(12, 0, 0, 0);
  date.setDate(date.getDate() - days);
  return localDateISO(date);
}

function formatDate(iso, withYear = false) {
  const d = dateFromISO(iso);
  return new Intl.DateTimeFormat("zh-CN", withYear
    ? { year: "numeric", month: "short", day: "numeric", weekday: "short" }
    : { month: "short", day: "numeric", weekday: "short" }
  ).format(d);
}

function formatNumber(value, digits = 0) {
  return new Intl.NumberFormat("zh-CN", { maximumFractionDigits: digits }).format(Number(value) || 0);
}

function exerciseById(id) {
  return state.exercises.find((item) => item.id === id);
}

function exerciseModeById(id) {
  return exerciseById(id)?.mode === "bodyweight" ? "bodyweight" : "weighted";
}

function isBodyweightExercise(id) {
  return exerciseModeById(id) === "bodyweight";
}

const SET_TYPES = {
  normal: { short: "N", label: "正式组" },
  warmup: { short: "W", label: "热身组" },
  drop: { short: "D", label: "递减组" },
  failure: { short: "F", label: "力竭组" },
};

function countableSets(sets) {
  return (sets || []).filter((set) => (set.type || "normal") !== "warmup");
}

function sumSets(sets) {
  return countableSets(sets).length;
}

function sumReps(sets) {
  return countableSets(sets).reduce((sum, set) => sum + (Number(set.reps) || 0), 0);
}

function sumVolume(sets) {
  return countableSets(sets).reduce((sum, set) => sum + (Number(set.weight) || 0) * (Number(set.reps) || 0), 0);
}

function rirFromRpe(rpe) {
  const value = Number(rpe);
  if (!Number.isFinite(value) || value < 6 || value > 10) return "";
  const rir = Math.max(0, 10 - value);
  return Number.isInteger(rir) ? `RIR ${rir}` : `RIR ${rir.toFixed(1)}`;
}

function aggregateRecords(records) {
  return {
    sets: records.reduce((sum, r) => sum + sumSets(r.sets), 0),
    reps: records.reduce((sum, r) => sum + sumReps(r.sets), 0),
    volume: records.reduce((sum, r) => sum + sumVolume(r.sets), 0),
  };
}

function maxWeightForRecords(records) {
  return (records || []).reduce((max, record) => {
    const recordMax = Math.max(0, ...countableSets(record.sets).map((set) => Number(set.weight) || 0));
    return Math.max(max, recordMax);
  }, 0);
}

function bestSetRepsForRecords(records) {
  return (records || []).reduce((best, record) => Math.max(
    best,
    ...countableSets(record.sets).map((set) => Number(set.reps) || 0),
  ), 0);
}

function bestDailyRepsForRecords(records) {
  const grouped = groupByDate(records || []);
  return Math.max(0, ...[...grouped.values()].map((dayRecords) => aggregateRecords(dayRecords).reps));
}

function metricValueForRecords(records, metricKey) {
  const totals = aggregateRecords(records || []);
  if (metricKey === "maxWeight") return maxWeightForRecords(records);
  if (metricKey === "sets") return totals.sets;
  if (metricKey === "reps") return totals.reps;
  return totals.volume;
}

function sumFoodCalories(records) {
  return (records || []).reduce((sum, record) => sum + (Number(record.calories) || 0), 0);
}

function foodMacroTotals(records) {
  return (records || []).reduce((totals, record) => {
    totals.calories += Number(record.calories) || 0;
    totals.protein += Number(record.protein) || 0;
    totals.carbs += Number(record.carbs) || 0;
    totals.fat += Number(record.fat) || 0;
    return totals;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
}

function foodRecordsForDate(date) {
  return state.foodRecords.filter((record) => record.date === date);
}

function nutritionRecordsForDays(days) {
  const start = daysAgoISO(Math.max(0, days - 1));
  return state.foodRecords.filter((record) => record.date >= start && record.date <= localDateISO());
}

function estimated1rm(weight, reps) {
  const w = Number(weight) || 0;
  const r = Number(reps) || 0;
  if (!w || !r) return 0;
  if (r === 1) return w;
  return w * (1 + r / 30);
}

function bestStatsForExercise(exerciseId) {
  const records = state.records.filter((record) => record.exerciseId === exerciseId);
  let bestWeight = 0;
  let best1rm = 0;
  let bestSetReps = 0;
  let bestSessionReps = 0;
  records.forEach((record) => {
    const workingSets = countableSets(record.sets);
    workingSets.forEach((set) => {
      bestWeight = Math.max(bestWeight, Number(set.weight) || 0);
      best1rm = Math.max(best1rm, estimated1rm(set.weight, set.reps));
      bestSetReps = Math.max(bestSetReps, Number(set.reps) || 0);
    });
  });
  bestSessionReps = bestDailyRepsForRecords(records);
  const last = records.slice().sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))[0];
  return { bestWeight, best1rm, bestSetReps, bestSessionReps, last };
}

const FOCUS_METRICS = {
  volume: { label: "训练容量", unit: "kg" },
  maxWeight: { label: "最高重量", unit: "kg" },
  reps: { label: "总次数", unit: "次" },
  bestSetReps: { label: "单组最多", unit: "次" },
  sets: { label: "正式组数", unit: "组" },
  avgReps: { label: "平均次数", unit: "次/组" },
};

function validFocusMetrics(exerciseId) {
  return isBodyweightExercise(exerciseId)
    ? ["reps", "bestSetReps", "sets", "avgReps"]
    : ["volume", "maxWeight", "reps", "sets", "avgReps"];
}

function focusValueFromSets(sets, metricKey) {
  const working = countableSets(sets || []).filter((set) => Number(set.reps) > 0);
  if (metricKey === "volume") return sumVolume(working);
  if (metricKey === "maxWeight") return Math.max(0, ...working.map((set) => Number(set.weight) || 0));
  if (metricKey === "bestSetReps") return Math.max(0, ...working.map((set) => Number(set.reps) || 0));
  if (metricKey === "sets") return working.length;
  if (metricKey === "avgReps") return working.length ? sumReps(working) / working.length : 0;
  return sumReps(working);
}

function lastComparableRecord(exerciseId) {
  return state.records
    .filter((record) => record.exerciseId === exerciseId && record.id !== editingWorkoutId)
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))[0];
}

function formatFocusValue(value, metricKey) {
  const metric = FOCUS_METRICS[metricKey] || FOCUS_METRICS.reps;
  const digits = metricKey === "avgReps" || metricKey === "maxWeight" ? 1 : 0;
  return `${formatNumber(value, digits)} ${metric.unit}`;
}

function renderFocusMetric() {
  const exerciseId = $("#exerciseSelect")?.value;
  const exercise = exerciseById(exerciseId);
  if (!exercise || !$("#focusMetricSelect")) return;
  const allowed = validFocusMetrics(exerciseId);
  if (!allowed.includes(exercise.focusMetric)) exercise.focusMetric = allowed[0];
  const select = $("#focusMetricSelect");
  select.innerHTML = "";
  allowed.forEach((key) => {
    const option = document.createElement("option");
    option.value = key;
    option.textContent = FOCUS_METRICS[key].label;
    select.appendChild(option);
  });
  select.value = exercise.focusMetric;
  const current = focusValueFromSets(draftSets, exercise.focusMetric);
  const previousRecord = lastComparableRecord(exerciseId);
  const previous = previousRecord ? focusValueFromSets(previousRecord.sets, exercise.focusMetric) : null;
  $("#focusCurrentValue").textContent = formatFocusValue(current, exercise.focusMetric);
  $("#focusPreviousValue").textContent = previous == null ? "—" : formatFocusValue(previous, exercise.focusMetric);
  if (previous == null) {
    $("#focusDeltaValue").textContent = "首次记录";
    $("#focusDeltaValue").className = "neutral";
    $("#focusHint").textContent = "保存后就能作为下次训练的比较基线。";
  } else {
    const diff = current - previous;
    const pct = previous ? (diff / previous) * 100 : 0;
    $("#focusDeltaValue").textContent = current ? `${diff >= 0 ? "+" : ""}${formatNumber(diff, 1)} · ${pct >= 0 ? "+" : ""}${formatNumber(pct, 1)}%` : "待填写";
    $("#focusDeltaValue").className = current ? (diff > 0 ? "positive" : diff < 0 ? "negative" : "neutral") : "neutral";
    $("#focusHint").textContent = `对比 ${formatDate(previousRecord.date)} 的同一动作。`;
  }
}

function currentExerciseRestSeconds() {
  const exercise = exerciseById($("#exerciseSelect")?.value);
  return Number(exercise?.restSeconds) || Number(state.settings.restSeconds) || 120;
}

function renderExerciseTools() {
  const exercise = exerciseById($("#exerciseSelect")?.value);
  if (!exercise || !$("#exerciseRestSelect")) return;
  const rest = currentExerciseRestSeconds();
  const select = $("#exerciseRestSelect");
  if (![...select.options].some((option) => Number(option.value) === rest)) {
    const option = document.createElement("option");
    option.value = String(rest);
    option.textContent = `${rest} 秒`;
    select.appendChild(option);
  }
  select.value = String(rest);
  const bodyweight = exercise.mode === "bodyweight";
  $("#warmupCalculatorButton").disabled = bodyweight;
  $("#plateCalculatorButton").disabled = bodyweight;
  $("#warmupCalculatorButton").title = bodyweight ? "自重动作不需要重量热身计算" : "按工作重量生成热身组";
  $("#plateCalculatorButton").title = bodyweight ? "自重动作不使用杠铃片" : "按目标重量计算每侧杠铃片";
  renderGroupStatus();
}

function exerciseLastUsedAt(exerciseId) {
  const record = state.records
    .filter((item) => item.exerciseId === exerciseId)
    .sort((a, b) => String(b.createdAt || b.date).localeCompare(String(a.createdAt || a.date)))[0];
  return record ? String(record.createdAt || record.date) : "";
}

function sortedExercises() {
  return [...state.exercises].sort((a, b) => {
    const recent = exerciseLastUsedAt(b.id).localeCompare(exerciseLastUsedAt(a.id));
    return recent || a.name.localeCompare(b.name, "zh-CN");
  });
}

function renderExerciseSelects() {
  const selects = [$("#exerciseSelect"), $("#analyticsExercise")];
  const currentValues = selects.map((s) => s.value);
  const exercises = sortedExercises();

  selects.forEach((select, index) => {
    select.innerHTML = "";
    exercises.forEach((exercise) => {
      const option = document.createElement("option");
      option.value = exercise.id;
      option.textContent = exercise.mode === "bodyweight" ? `${exercise.name} · 自重` : exercise.name;
      select.appendChild(option);
    });
    if (state.exercises.some((x) => x.id === currentValues[index])) select.value = currentValues[index];
  });

  if (!$("#analyticsExercise").value && exercises[0]) $("#analyticsExercise").value = exercises[0].id;
  if (!$("#exerciseSelect").value && exercises[0]) $("#exerciseSelect").value = exercises[0].id;
  updateCurrentExerciseName();
}

function exerciseModeLabel(exercise) {
  return exercise?.mode === "bodyweight" ? "自重 · 次数" : "负重 · kg + 次数";
}

function updateCurrentExerciseName() {
  const exercise = exerciseById($("#exerciseSelect").value);
  $("#currentExerciseName").textContent = exercise?.name || "选择动作";
  $("#exercisePickerName").textContent = exercise?.name || "选择动作";
  $("#exercisePickerMeta").textContent = exercise ? exerciseModeLabel(exercise) : "搜索或从最近动作中选择";
  renderExercisePr();
  renderSetRows();
  renderFocusMetric();
  renderExerciseTools();
  renderProgressionSuggestion();
}

function makeExercisePickerRow(exercise) {
  const button = document.createElement("button");
  button.type = "button";
  button.className = "exercise-pick-row";
  button.dataset.exercisePick = exercise.id;
  const copy = document.createElement("span");
  const name = document.createElement("strong");
  name.textContent = exercise.name;
  const meta = document.createElement("small");
  const lastUsed = exerciseLastUsedAt(exercise.id);
  meta.textContent = lastUsed ? `${exerciseModeLabel(exercise)} · 最近 ${formatDate(String(lastUsed).slice(0, 10))}` : `${exerciseModeLabel(exercise)} · 尚未记录`;
  copy.append(name, meta);
  const badge = document.createElement("b");
  badge.className = `exercise-mode-pill ${exercise.mode === "bodyweight" ? "bodyweight" : "weighted"}`;
  badge.textContent = exercise.mode === "bodyweight" ? "自重" : "负重";
  button.append(copy, badge);
  return button;
}

function renderExercisePicker(query = $("#exerciseSearchInput")?.value || "") {
  const root = $("#exercisePickerList");
  if (!root) return;
  root.innerHTML = "";
  const normalized = query.trim().toLowerCase();
  const exercises = sortedExercises();
  const matched = normalized
    ? exercises.filter((exercise) => exercise.name.toLowerCase().includes(normalized))
    : exercises;

  if (!matched.length) {
    root.innerHTML = '<div class="empty-state exercise-empty">没有找到动作，可以直接新建。</div>';
    return;
  }

  if (!normalized) {
    const recent = matched.filter((exercise) => exerciseLastUsedAt(exercise.id)).slice(0, 4);
    if (recent.length) {
      const label = document.createElement("p");
      label.className = "exercise-list-label";
      label.textContent = "最近使用";
      root.appendChild(label);
      recent.forEach((exercise) => root.appendChild(makeExercisePickerRow(exercise)));
    }
    const label = document.createElement("p");
    label.className = "exercise-list-label all-label";
    label.textContent = "全部动作";
    root.appendChild(label);
  }
  matched.forEach((exercise) => root.appendChild(makeExercisePickerRow(exercise)));
}

function renderExerciseManager() {
  const root = $("#exerciseManagerList");
  if (!root) return;
  root.innerHTML = "";
  sortedExercises().forEach((exercise) => {
    const row = document.createElement("article");
    row.className = "exercise-manager-row";
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = exercise.name;
    const count = state.records.filter((record) => record.exerciseId === exercise.id).length;
    const meta = document.createElement("span");
    meta.textContent = `${exerciseModeLabel(exercise)} · ${exercise.primaryMuscle || "其他"} · ${EQUIPMENT_LABELS[exercise.equipment] || "其他"} · ${count} 条记录`;
    copy.append(title, meta);
    const edit = document.createElement("button");
    edit.type = "button";
    edit.dataset.exerciseManageEdit = exercise.id;
    edit.textContent = "编辑";
    row.append(copy, edit);
    root.appendChild(row);
  });
}

function openExerciseEditor(exerciseId = null, origin = "training") {
  editingExerciseId = exerciseId;
  exerciseEditorOrigin = origin;
  const exercise = exerciseId ? exerciseById(exerciseId) : null;
  $("#exerciseDialogEyebrow").textContent = exercise ? "EDIT EXERCISE" : "NEW EXERCISE";
  $("#exerciseDialogTitle").textContent = exercise ? "编辑训练动作" : "新建训练动作";
  $("#exerciseFormSubmitButton").textContent = exercise ? "保存动作" : "添加动作";
  $("#exerciseNameInput").value = exercise?.name || "";
  $("#exerciseModeInput").value = exercise?.mode === "bodyweight" ? "bodyweight" : "weighted";
  $("#exerciseMuscleInput").value = exercise?.primaryMuscle || inferPrimaryMuscle(exercise?.name || "", exercise?.id || "", "");
  $("#exerciseEquipmentInput").value = exercise?.equipment || inferEquipment(exercise?.name || "", exercise?.mode || "weighted", exercise?.equipment);
  $("#exerciseEquipmentInput").disabled = exercise?.mode === "bodyweight";
  if ($("#exercisePickerDialog").open) $("#exercisePickerDialog").close();
  if ($("#exerciseManagerDialog").open) $("#exerciseManagerDialog").close();
  $("#exerciseDialog").showModal();
  setTimeout(() => $("#exerciseNameInput").focus(), 40);
}

function renderExercisePr() {
  const exerciseId = $("#exerciseSelect").value;
  const bodyweight = isBodyweightExercise(exerciseId);
  const { bestWeight, best1rm, bestSetReps, bestSessionReps, last } = bestStatsForExercise(exerciseId);
  $("#exercisePrimaryStatLabel").textContent = bodyweight ? "单组最多次数" : "历史最高重量";
  $("#exerciseSecondaryStatLabel").textContent = bodyweight ? "单次训练最多次数" : "预计 1RM";
  $("#exercisePrimaryStatUnit").textContent = bodyweight ? "次" : "kg";
  $("#exerciseSecondaryStatUnit").textContent = bodyweight ? "次" : "kg";
  $("#exerciseBestWeight").textContent = formatNumber(bodyweight ? bestSetReps : bestWeight, bodyweight ? 0 : 1);
  $("#exerciseBest1rm").textContent = formatNumber(bodyweight ? bestSessionReps : best1rm, bodyweight ? 0 : 1);
  $("#exerciseLastWorkout").textContent = last
    ? bodyweight
      ? `${formatDate(last.date)} · ${sumSets(last.sets)}组 · ${sumReps(last.sets)}次`
      : `${formatDate(last.date)} · ${sumSets(last.sets)}组 · ${formatNumber(sumVolume(last.sets))}kg`
    : "暂无记录";
}

function renderWorkoutDay() {
  const date = $("#workoutDate").value || localDateISO();
  const records = state.records
    .filter((record) => record.date === date)
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const totals = aggregateRecords(records);
  $("#workoutDayLabel").textContent = date === localDateISO() ? "今天" : formatDate(date, true);
  $("#workoutDaySummary").textContent = `${totals.sets} 组 · ${totals.reps} 次${totals.volume ? ` · ${formatNumber(totals.volume)} kg` : ""}`;

  const root = $("#workoutDayList");
  root.innerHTML = "";
  if (!records.length) {
    root.innerHTML = '<div class="empty-state">这一天还没有训练动作。保存第一个动作后会显示在这里。</div>';
    return;
  }

  records.forEach((record) => {
    const exercise = exerciseById(record.exerciseId);
    const bodyweight = exercise?.mode === "bodyweight";
    const card = document.createElement("article");
    card.className = "list-card session-record";
    const left = document.createElement("div");
    const titleRow = document.createElement("div");
    titleRow.className = "session-title-row";
    const title = document.createElement("strong");
    title.textContent = exercise?.name || "已删除动作";
    titleRow.appendChild(title);
    if (record.groupId) {
      const badge = document.createElement("span");
      badge.className = `session-group-badge ${record.groupMode === "circuit" ? "circuit" : "superset"}`;
      badge.textContent = record.groupMode === "circuit" ? "Circuit" : "超级组";
      titleRow.appendChild(badge);
    }
    const detail = document.createElement("p");
    detail.className = "muted session-set-line";
    detail.textContent = (record.sets || []).map((set) => {
      const type = SET_TYPES[set.type || "normal"]?.short || "N";
      const rpe = set.rpe ? ` RPE${formatNumber(set.rpe, 1)}` : "";
      return bodyweight
        ? `${type} ${formatNumber(set.reps)}次${rpe}`
        : `${type} ${formatNumber(set.weight, 1)}kg×${formatNumber(set.reps)}${rpe}`;
    }).join(" · ");
    left.append(titleRow, detail);
    if (record.note) {
      const note = document.createElement("p");
      note.className = "record-note";
      note.textContent = record.note;
      left.appendChild(note);
    }
    const actions = document.createElement("div");
    actions.className = "record-actions";
    const feedbackLabel = record.feedback === "easy" ? "太轻" : record.feedback === "hard" ? "太难" : record.feedback === "good" ? "合适" : "感受";
    actions.innerHTML = `<span class="record-volume">${bodyweight ? `${sumReps(record.sets)} 次` : `${formatNumber(sumVolume(record.sets))} kg`}</span><button type="button" data-workout-feedback-edit="${record.id}">${feedbackLabel}</button><button type="button" data-workout-edit="${record.id}">编辑</button><button type="button" class="danger-action" data-workout-delete="${record.id}">删除</button>`;
    card.append(left, actions);
    root.appendChild(card);
  });
}

function renderSetRows() {
  const root = $("#setRows");
  const exerciseId = $("#exerciseSelect")?.value;
  const bodyweight = isBodyweightExercise(exerciseId);
  root.innerHTML = "";
  root.classList.toggle("bodyweight-mode", bodyweight);
  $("#setTableHead")?.classList.toggle("bodyweight-mode", bodyweight);
  if ($("#weightColumnLabel")) $("#weightColumnLabel").textContent = bodyweight ? "自重" : "kg";
  draftSets.forEach((set, index) => {
    const row = document.createElement("div");
    row.className = `set-row ${set.completed ? "completed" : ""}`;

    const type = document.createElement("button");
    type.type = "button";
    type.className = `set-type set-type-${set.type || "normal"}`;
    type.dataset.setTypeIndex = index;
    type.textContent = SET_TYPES[set.type || "normal"].short;
    type.title = `${SET_TYPES[set.type || "normal"].label}，点击切换`;

    let weight;
    if (bodyweight) {
      weight = document.createElement("span");
      weight.className = "bodyweight-cell";
      weight.textContent = "自重";
    } else {
      weight = document.createElement("input");
      weight.type = "number";
      weight.min = "0";
      weight.step = "0.5";
      weight.inputMode = "decimal";
      weight.placeholder = "kg";
      weight.value = set.weight;
      weight.dataset.field = "weight";
      weight.dataset.index = index;
    }

    const reps = document.createElement("input");
    reps.type = "number";
    reps.min = "0";
    reps.step = "1";
    reps.inputMode = "numeric";
    reps.placeholder = "次";
    reps.value = set.reps;
    reps.dataset.field = "reps";
    reps.dataset.index = index;

    const rpe = document.createElement("input");
    rpe.type = "number";
    rpe.min = "6";
    rpe.max = "10";
    rpe.step = "0.5";
    rpe.inputMode = "decimal";
    rpe.placeholder = "—";
    rpe.value = set.rpe;
    rpe.dataset.field = "rpe";
    rpe.dataset.index = index;
    rpe.title = set.rpe ? rirFromRpe(set.rpe) : "RPE 6–10";

    const complete = document.createElement("button");
    complete.type = "button";
    complete.className = `complete-set ${set.completed ? "active" : ""}`;
    complete.dataset.completeIndex = index;
    complete.textContent = set.completed ? "✓" : "○";
    complete.setAttribute("aria-label", `${set.completed ? "取消" : "完成"}第 ${index + 1} 组`);

    const remove = document.createElement("button");
    remove.className = "remove-set";
    remove.type = "button";
    remove.textContent = "×";
    remove.dataset.removeIndex = index;
    remove.setAttribute("aria-label", `删除第 ${index + 1} 组`);

    row.append(type, weight, reps, rpe, complete, remove);
    root.appendChild(row);
  });
  renderFocusMetric();
}

function activeTemplate() {
  if (activeRuntimeTemplate?.id === activeTemplateId) return activeRuntimeTemplate;
  return state.templates.find((item) => item.id === activeTemplateId) || null;
}

function templateFromRecords(records, name = "临时训练") {
  return {
    id: `runtime-${Date.now()}`,
    name,
    runtime: true,
    exercises: [...records]
      .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")))
      .map((record) => ({
        exerciseId: record.exerciseId,
        note: record.note || "",
        sets: (record.sets || []).map((set) => ({
          weight: Number(set.weight) || 0,
          reps: Number(set.reps) || 0,
          type: set.type || "normal",
          rpe: set.rpe ?? "",
        })),
      })),
  };
}

function beginTemplateRun(template, runtime = false) {
  if (!template?.exercises?.length) return showToast("这个模板还没有动作");
  activeRuntimeTemplate = runtime ? template : null;
  activeTemplateId = template.id;
  activeTemplateIndex = 0;
  resetDraft();
  loadTemplateExercise(0);
  showToast(`已开始：${template.name}`);
}

function renderTemplates() {
  const select = $("#templateSelect");
  if (!select) return;
  const current = select.value;
  select.innerHTML = '<option value="">选择训练模板</option>';
  state.templates.forEach((template) => {
    const option = document.createElement("option");
    option.value = template.id;
    option.textContent = `${template.name} · ${template.exercises.length} 个动作`;
    select.appendChild(option);
  });
  if (state.templates.some((item) => item.id === current)) select.value = current;
  const active = activeTemplate();
  $("#templateStatus").textContent = active
    ? `${active.runtime ? "临时 · " : ""}${active.name} · ${Math.min(activeTemplateIndex + 1, active.exercises.length)}/${active.exercises.length}`
    : "未使用模板";
}

function loadTemplateExercise(index) {
  const template = activeTemplate();
  if (!template || !template.exercises[index]) {
    activeTemplateId = null;
    activeTemplateIndex = 0;
    activeRuntimeTemplate = null;
    renderTemplates();
    showToast("模板训练已完成");
    return;
  }
  const item = template.exercises[index];
  activeTemplateIndex = index;
  $("#exerciseSelect").value = item.exerciseId;
  $("#workoutNote").value = item.note || "";
  draftSets = (item.sets || []).length
    ? item.sets.map((set) => newDraftSet({ ...set, completed: false }))
    : [newDraftSet(), newDraftSet(), newDraftSet()];
  updateCurrentExerciseName();
  renderSetRows();
  renderTemplates();
}

function startSelectedTemplate() {
  const id = $("#templateSelect").value;
  const template = state.templates.find((item) => item.id === id);
  if (!template) return showToast("请先选择模板");
  beginTemplateRun(template, false);
}

function repeatLastWorkout() {
  const targetDate = $("#workoutDate").value || localDateISO();
  const dates = [...new Set(state.records.map((record) => record.date))]
    .filter((date) => date < targetDate)
    .sort((a, b) => b.localeCompare(a));
  const lastDate = dates[0];
  if (!lastDate) return showToast("还没有可重复的上一场训练");
  const records = state.records.filter((record) => record.date === lastDate);
  const runtime = templateFromRecords(records, `重复 ${formatDate(lastDate)}`);
  beginTemplateRun(runtime, true);
}

function saveDayAsTemplate() {
  const date = $("#workoutDate").value || localDateISO();
  const records = state.records.filter((record) => record.date === date);
  if (!records.length) return showToast("这一天还没有训练可保存");
  const name = window.prompt("给这个训练模板起个名字", `${formatDate(date)} 训练`);
  if (!name?.trim()) return;
  state.templates.push({
    id: crypto.randomUUID?.() || `template-${Date.now()}`,
    name: name.trim(),
    createdAt: new Date().toISOString(),
    exercises: records.map((record) => ({
      exerciseId: record.exerciseId,
      note: record.note || "",
      sets: (record.sets || []).map((set) => ({
        weight: Number(set.weight) || 0,
        reps: Number(set.reps) || 0,
        type: set.type || "normal",
        rpe: set.rpe ?? "",
      })),
    })),
  });
  saveState();
  renderTemplates();
  $("#templateSelect").value = state.templates[state.templates.length - 1].id;
  showToast("训练模板已保存");
}

const WEEKDAY_NAMES = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"];

function renderTemplateManager() {
  const root = $("#templateManagerList");
  if (!root) return;
  root.innerHTML = "";
  if (!state.templates.length) {
    root.innerHTML = '<div class="empty-state">还没有模板。先把某一天的训练保存成模板。</div>';
    return;
  }
  state.templates.forEach((template) => {
    const card = document.createElement("article");
    card.className = "template-manager-card";
    const names = template.exercises.map((item) => exerciseById(item.exerciseId)?.name || "已删除动作");
    card.innerHTML = `<div class="template-manager-head"><div><strong></strong><p></p></div><span>${template.exercises.length} 动作</span></div>
      <div class="template-manager-actions">
        <button type="button" data-template-start="${template.id}">开始</button>
        <button type="button" data-template-edit="${template.id}">编辑</button>
        <button type="button" data-template-duplicate="${template.id}">复制</button>
        <button type="button" class="danger-action" data-template-delete="${template.id}">删除</button>
      </div>`;
    card.querySelector("strong").textContent = template.name;
    card.querySelector("p").textContent = names.join(" → ") || "暂无动作";
    root.appendChild(card);
  });
}

function duplicateTemplate(templateId) {
  const template = state.templates.find((item) => item.id === templateId);
  if (!template) return;
  const copy = clone(template);
  copy.id = crypto.randomUUID?.() || `template-${Date.now()}`;
  copy.name = `${template.name} 副本`;
  copy.createdAt = new Date().toISOString();
  copy.updatedAt = copy.createdAt;
  state.templates.push(copy);
  saveState();
  renderTemplates();
  renderTemplateManager();
  renderWeeklyPlanRows();
  showToast("模板已复制");
}

function deleteTemplate(templateId) {
  const template = state.templates.find((item) => item.id === templateId);
  if (!template || !window.confirm(`确定删除模板“${template.name}”吗？`)) return;
  state.templates = state.templates.filter((item) => item.id !== templateId);
  state.weeklyPlan = normalizeWeeklyPlan(state.weeklyPlan).map((item) => item.templateId === templateId ? { ...item, templateId: "" } : item);
  state.planOverrides = normalizePlanOverrides(state.planOverrides).filter((item) => item.templateId !== templateId);
  if (activeTemplateId === templateId) {
    activeTemplateId = null;
    activeTemplateIndex = 0;
  }
  saveState();
  renderTemplates();
  renderTemplateManager();
  renderTodayPlan();
  showToast("模板已删除");
}

function openTemplateEditor(templateId) {
  const template = state.templates.find((item) => item.id === templateId);
  if (!template) return;
  editingTemplateId = templateId;
  templateEditDraft = clone(template);
  $("#templateNameInput").value = template.name;
  renderTemplateEditor();
  if ($("#templateManagerDialog").open) $("#templateManagerDialog").close();
  $("#templateEditorDialog").showModal();
}

function renderTemplateEditor() {
  const root = $("#templateExerciseEditor");
  if (!root || !templateEditDraft) return;
  root.innerHTML = "";
  if (!templateEditDraft.exercises.length) {
    root.innerHTML = '<div class="empty-state">模板里还没有动作，可以把当前训练动作加入。</div>';
    return;
  }
  templateEditDraft.exercises.forEach((item, exerciseIndex) => {
    const exercise = exerciseById(item.exerciseId);
    const bodyweight = exercise?.mode === "bodyweight";
    const card = document.createElement("article");
    card.className = "template-exercise-edit-card";
    const head = document.createElement("div");
    head.className = "template-exercise-edit-head";
    head.innerHTML = `<div><strong></strong><span>${bodyweight ? "自重" : "负重"} · ${(item.sets || []).length} 组</span></div>
      <div class="template-order-actions"><button type="button" data-template-move-up="${exerciseIndex}" ${exerciseIndex === 0 ? "disabled" : ""}>↑</button><button type="button" data-template-move-down="${exerciseIndex}" ${exerciseIndex === templateEditDraft.exercises.length - 1 ? "disabled" : ""}>↓</button><button type="button" class="danger-action" data-template-exercise-remove="${exerciseIndex}">移除</button></div>`;
    head.querySelector("strong").textContent = exercise?.name || "已删除动作";
    const note = document.createElement("input");
    note.className = "template-note-input";
    note.placeholder = "动作备注（可选）";
    note.value = item.note || "";
    note.dataset.templateNoteIndex = exerciseIndex;
    const setsRoot = document.createElement("div");
    setsRoot.className = "template-set-editor";
    (item.sets || []).forEach((set, setIndex) => {
      const row = document.createElement("div");
      row.className = `template-set-edit-row ${bodyweight ? "bodyweight" : ""}`;
      const typeOptions = Object.entries(SET_TYPES).map(([key, meta]) => `<option value="${key}" ${key === (set.type || "normal") ? "selected" : ""}>${meta.short}</option>`).join("");
      row.innerHTML = `<select data-template-set-field="type" data-exercise-index="${exerciseIndex}" data-set-index="${setIndex}">${typeOptions}</select>
        ${bodyweight ? '<span class="template-bodyweight-label">自重</span>' : `<input type="number" step="0.5" min="0" inputmode="decimal" value="${Number(set.weight) || 0}" data-template-set-field="weight" data-exercise-index="${exerciseIndex}" data-set-index="${setIndex}" aria-label="重量">`}
        <input type="number" step="1" min="0" inputmode="numeric" value="${Number(set.reps) || 0}" data-template-set-field="reps" data-exercise-index="${exerciseIndex}" data-set-index="${setIndex}" aria-label="次数">
        <input type="number" step="0.5" min="6" max="10" inputmode="decimal" value="${set.rpe ?? ""}" placeholder="RPE" data-template-set-field="rpe" data-exercise-index="${exerciseIndex}" data-set-index="${setIndex}" aria-label="RPE">
        <button type="button" class="danger-action" data-template-set-remove="${exerciseIndex}:${setIndex}">×</button>`;
      setsRoot.appendChild(row);
    });
    const addSet = document.createElement("button");
    addSet.type = "button";
    addSet.className = "template-add-set";
    addSet.dataset.templateSetAdd = exerciseIndex;
    addSet.textContent = "＋ 添加一组";
    card.append(head, note, setsRoot, addSet);
    root.appendChild(card);
  });
}

function moveTemplateExercise(index, delta) {
  if (!templateEditDraft) return;
  const next = index + delta;
  if (next < 0 || next >= templateEditDraft.exercises.length) return;
  const [item] = templateEditDraft.exercises.splice(index, 1);
  templateEditDraft.exercises.splice(next, 0, item);
  renderTemplateEditor();
}

function addCurrentExerciseToTemplate() {
  if (!templateEditDraft) return;
  const exerciseId = $("#exerciseSelect").value;
  if (!exerciseId) return showToast("请先选择当前动作");
  templateEditDraft.exercises.push({
    exerciseId,
    note: $("#workoutNote").value || "",
    sets: draftSets.map((set) => ({
      weight: isBodyweightExercise(exerciseId) ? 0 : Number(set.weight) || 0,
      reps: Number(set.reps) || 0,
      type: set.type || "normal",
      rpe: set.rpe === "" ? "" : Number(set.rpe),
    })),
  });
  renderTemplateEditor();
  showToast("已加入当前动作");
}

function saveTemplateEdits() {
  const template = state.templates.find((item) => item.id === editingTemplateId);
  if (!template || !templateEditDraft) return;
  const name = $("#templateNameInput").value.trim();
  if (!name) return showToast("模板名称不能为空");
  if (!templateEditDraft.exercises.length) return showToast("模板至少保留一个动作");
  templateEditDraft.name = name;
  templateEditDraft.updatedAt = new Date().toISOString();
  Object.assign(template, clone(templateEditDraft));
  saveState();
  $("#templateEditorDialog").close();
  editingTemplateId = null;
  templateEditDraft = null;
  renderTemplates();
  renderTemplateManager();
  renderWeeklyPlanRows();
  renderTodayPlan();
  $("#templateManagerDialog").showModal();
  showToast("模板修改已保存");
}

function currentWeekdayIndex(date = new Date()) {
  return (date.getDay() + 6) % 7;
}

function planEntryForDate(dateIso = localDateISO()) {
  const date = dateFromISO(dateIso);
  const base = normalizeWeeklyPlan(state.weeklyPlan)[currentWeekdayIndex(date)];
  const override = normalizePlanOverrides(state.planOverrides).find((item) => item.date === dateIso);
  if (!override || !base?.isTrainingDay) return base;
  return { ...base, templateId: override.templateId, overrideReason: override.reason, overrideDate: override.date };
}

function todayPlanEntry() {
  return planEntryForDate(localDateISO());
}

function renderTodayPlan() {
  const card = $("#todayPlanCard");
  if (!card) return;
  const entry = todayPlanEntry();
  const template = state.templates.find((item) => item.id === entry?.templateId);
  const todayRecords = state.records.filter((record) => record.date === localDateISO());
  card.classList.remove("due", "done");
  if (!entry?.isTrainingDay) {
    $("#todayPlanName").textContent = "今天是休息日";
    $("#todayPlanMeta").textContent = "周计划里可以随时把今天改成训练日。";
    $("#startTodayPlanButton").classList.add("hidden");
    if ($("#dashboardPlanName")) $("#dashboardPlanName").textContent = "今天是休息日";
    if ($("#dashboardPlanMeta")) $("#dashboardPlanMeta").textContent = "恢复也是训练计划的一部分";
    $("#dashboardPlanStrip")?.classList.remove("due", "done");
    return;
  }
  const planName = template?.name || "自由训练";
  const adaptiveSuffix = entry.overrideReason ? " · 智能调整" : "";
  $("#todayPlanName").textContent = `${planName}${adaptiveSuffix}`;
  const nowTime = `${String(new Date().getHours()).padStart(2, "0")}:${String(new Date().getMinutes()).padStart(2, "0")}`;
  if (todayRecords.length) {
    const totals = aggregateRecords(todayRecords);
    card.classList.add("done");
    $("#todayPlanMeta").textContent = `训练时间 ${entry.reminderTime} · 今天已记录 ${totals.sets} 组 / ${totals.reps} 次${entry.overrideReason ? ` · ${entry.overrideReason}` : ""}`;
  } else if (nowTime >= entry.reminderTime) {
    card.classList.add("due");
    $("#todayPlanMeta").textContent = `训练时间 ${entry.reminderTime} 已到 · 可以开始${planName}`;
  } else {
    $("#todayPlanMeta").textContent = template ? `训练时间 ${entry.reminderTime} · ${template.exercises.length} 个动作${entry.overrideReason ? " · 恢复调节" : ""}` : `训练时间 ${entry.reminderTime} · 自由训练`;
  }
  $("#startTodayPlanButton").classList.remove("hidden");
  if ($("#dashboardPlanName")) $("#dashboardPlanName").textContent = planName;
  if ($("#dashboardPlanMeta")) $("#dashboardPlanMeta").textContent = todayRecords.length
    ? `今日已训练 · 原计划 ${entry.reminderTime}`
    : nowTime >= entry.reminderTime ? `训练时间 ${entry.reminderTime} 已到` : `计划时间 ${entry.reminderTime}`;
  $("#dashboardPlanStrip")?.classList.toggle("due", !todayRecords.length && nowTime >= entry.reminderTime);
  $("#dashboardPlanStrip")?.classList.toggle("done", todayRecords.length > 0);
}

function renderWeeklyPlanRows() {
  const root = $("#weeklyPlanRows");
  if (!root) return;
  const plan = normalizeWeeklyPlan(state.weeklyPlan);
  root.innerHTML = "";
  plan.forEach((entry, dayIndex) => {
    const row = document.createElement("article");
    row.className = `weekly-plan-row ${entry.isTrainingDay ? "training-day" : "rest-day"}`;
    const options = ['<option value="">自由训练</option>', ...state.templates.map((template) => `<option value="${template.id}" ${entry.templateId === template.id ? "selected" : ""}>${template.name}</option>`)].join("");
    row.innerHTML = `<strong>${WEEKDAY_NAMES[dayIndex]}</strong><label class="weekly-day-toggle"><input type="checkbox" data-weekly-enabled="${dayIndex}" ${entry.isTrainingDay ? "checked" : ""}><span>${entry.isTrainingDay ? "训练" : "休息"}</span></label><div class="weekly-plan-detail ${entry.isTrainingDay ? "" : "hidden"}" data-weekly-detail="${dayIndex}"><select data-weekly-template="${dayIndex}" aria-label="${WEEKDAY_NAMES[dayIndex]}训练内容">${options}</select><input type="time" value="${entry.reminderTime || "18:00"}" data-weekly-time="${dayIndex}" aria-label="${WEEKDAY_NAMES[dayIndex]}训练时间"></div>`;
    root.appendChild(row);
  });
}

function saveWeeklyPlan() {
  state.weeklyPlan = Array.from({ length: 7 }, (_, dayIndex) => {
    const isTrainingDay = Boolean($(`[data-weekly-enabled="${dayIndex}"]`)?.checked);
    return {
      dayIndex,
      isTrainingDay,
      templateId: isTrainingDay ? ($(`[data-weekly-template="${dayIndex}"]`)?.value || "") : "",
      reminderTime: isTrainingDay ? ($(`[data-weekly-time="${dayIndex}"]`)?.value || "18:00") : "",
    };
  });
  state.planOverrides = [];
  saveState();
  $("#weeklyPlanDialog").close();
  renderTodayPlan();
  showToast("周训练计划已保存");
}

function startTodayPlan() {
  const entry = todayPlanEntry();
  if (!entry?.isTrainingDay) return showToast("今天是休息日");
  const template = state.templates.find((item) => item.id === entry?.templateId);
  $("#workoutDate").value = localDateISO();
  navigate("log");
  if (!template) {
    resetDraft();
    showToast("已开始自由训练");
    return;
  }
  $("#templateSelect").value = template.id;
  beginTemplateRun(template, false);
}

const TRAINING_GOAL_LABELS = { hypertrophy: "增肌", strength: "力量", fatloss: "减脂/体能" };
const TRAINING_LEVEL_LABELS = { beginner: "新手", intermediate: "中级", advanced: "高级" };

function renderSmartProfileSummary() {
  const profile = normalizeTrainingProfile(state.trainingProfile);
  state.trainingProfile = profile;
  if ($("#smartProfileSummary")) $("#smartProfileSummary").textContent = `${TRAINING_GOAL_LABELS[profile.goal]} · ${TRAINING_LEVEL_LABELS[profile.level]} · 每周 ${profile.daysPerWeek} 天 · ${profile.sessionMinutes} 分钟`;
}

function openSmartPlanDialog() {
  const profile = normalizeTrainingProfile(state.trainingProfile);
  $("#trainingGoalInput").value = profile.goal;
  $("#trainingLevelInput").value = profile.level;
  $("#trainingDaysInput").value = String(profile.daysPerWeek);
  $("#trainingMinutesInput").value = String(profile.sessionMinutes);
  $$("#trainingEquipmentInputs input").forEach((input) => { input.checked = profile.equipment.includes(input.value); });
  $("#smartPlanDialog").showModal();
}

function profileFromDialog() {
  return normalizeTrainingProfile({
    goal: $("#trainingGoalInput").value,
    level: $("#trainingLevelInput").value,
    daysPerWeek: Number($("#trainingDaysInput").value),
    sessionMinutes: Number($("#trainingMinutesInput").value),
    equipment: $$("#trainingEquipmentInputs input:checked").map((input) => input.value),
  });
}

function saveTrainingProfileOnly() {
  if (!$$('#trainingEquipmentInputs input:checked').length) return showToast("至少选择一种可用器械");
  state.trainingProfile = profileFromDialog();
  saveState();
  renderSmartProfileSummary();
  renderRecoveryAdvisor();
  $("#smartPlanDialog").close();
  showToast("训练目标已保存");
}

function trainingPrescription(profile, exercise) {
  const advanced = profile.level === "advanced";
  const beginner = profile.level === "beginner";
  if (exercise?.mode === "bodyweight") return { sets: beginner ? 2 : advanced ? 4 : 3, reps: profile.goal === "strength" ? 8 : profile.goal === "fatloss" ? 15 : 12 };
  if (profile.goal === "strength") return { sets: beginner ? 3 : advanced ? 5 : 4, reps: 5 };
  if (profile.goal === "fatloss") return { sets: beginner ? 2 : 3, reps: 12 };
  return { sets: beginner ? 2 : advanced ? 4 : 3, reps: 8 };
}

function routineBlueprint(days) {
  if (days <= 2) return [
    { name: "全身 A", muscles: ["胸", "背", "股四头", "后链", "肩", "核心"] },
    { name: "全身 B", muscles: ["背", "胸", "股四头", "臀", "二头", "三头"] },
  ];
  if (days === 3) return [
    { name: "Push", muscles: ["胸", "肩", "三头"] },
    { name: "Pull", muscles: ["背", "二头", "后链"] },
    { name: "Legs", muscles: ["股四头", "后链", "臀", "小腿", "核心"] },
  ];
  if (days === 4) return [
    { name: "Upper A", muscles: ["胸", "背", "肩", "二头", "三头"] },
    { name: "Lower A", muscles: ["股四头", "后链", "臀", "小腿", "核心"] },
    { name: "Upper B", muscles: ["背", "胸", "肩", "三头", "二头"] },
    { name: "Lower B", muscles: ["后链", "股四头", "臀", "核心", "小腿"] },
  ];
  const base = [
    { name: "Push", muscles: ["胸", "肩", "三头"] },
    { name: "Pull", muscles: ["背", "二头", "后链"] },
    { name: "Legs", muscles: ["股四头", "后链", "臀", "小腿"] },
    { name: "Upper", muscles: ["胸", "背", "肩", "二头", "三头"] },
    { name: "Lower", muscles: ["股四头", "后链", "臀", "核心"] },
    { name: "Full Body", muscles: ["胸", "背", "股四头", "后链", "肩", "核心"] },
  ];
  return base.slice(0, days);
}

function representativeWorkingWeight(sets) {
  const weights = countableSets(sets || []).map((set) => Number(set.weight) || 0).filter((weight) => weight > 0).sort((a, b) => a - b);
  if (!weights.length) return 0;
  const mid = Math.floor(weights.length / 2);
  return weights.length % 2 ? weights[mid] : (weights[mid - 1] + weights[mid]) / 2;
}

function latestWorkingWeight(exerciseId) {
  const last = lastComparableRecord(exerciseId);
  return last ? representativeWorkingWeight(last.sets) : 0;
}

function generatedTemplateFromMuscles(name, muscles, profile, minutes = profile.sessionMinutes) {
  const maxExercises = minutes <= 30 ? 4 : minutes <= 45 ? 5 : minutes <= 60 ? 6 : minutes <= 75 ? 7 : 8;
  const available = state.exercises.filter((exercise) => profile.equipment.includes(exercise.equipment || inferEquipment(exercise.name, exercise.mode, exercise.equipment)));
  const selected = [];
  muscles.forEach((muscle) => {
    const candidate = available.find((exercise) => exercise.primaryMuscle === muscle && !selected.some((item) => item.id === exercise.id));
    if (candidate && selected.length < maxExercises) selected.push(candidate);
  });
  available.filter((exercise) => muscles.includes(exercise.primaryMuscle)).forEach((exercise) => {
    if (selected.length < maxExercises && !selected.some((item) => item.id === exercise.id)) selected.push(exercise);
  });
  return {
    id: crypto.randomUUID?.() || `smart-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    name,
    generatedBy: "smart-plan",
    createdAt: new Date().toISOString(),
    exercises: selected.slice(0, maxExercises).map((exercise) => {
      const prescription = trainingPrescription(profile, exercise);
      const weight = exercise.mode === "bodyweight" ? 0 : latestWorkingWeight(exercise.id);
      return {
        exerciseId: exercise.id,
        note: "智能计划起始建议，可按当天状态调整",
        sets: Array.from({ length: prescription.sets }, () => ({ weight, reps: prescription.reps, type: "normal", rpe: 8 })),
      };
    }),
  };
}

function preferredTrainingDays(count) {
  const current = normalizeWeeklyPlan(state.weeklyPlan);
  const chosen = current.filter((entry) => entry.isTrainingDay).map((entry) => entry.dayIndex);
  const presets = { 2: [0, 3], 3: [0, 2, 4], 4: [0, 1, 3, 5], 5: [0, 1, 2, 4, 5], 6: [0, 1, 2, 3, 4, 5] };
  const result = [...chosen.slice(0, count)];
  (presets[count] || presets[4]).forEach((day) => { if (result.length < count && !result.includes(day)) result.push(day); });
  for (let day = 0; result.length < count && day < 7; day += 1) if (!result.includes(day)) result.push(day);
  return result.sort((a, b) => a - b);
}

function generateSmartWeeklyPlan() {
  if (!$$('#trainingEquipmentInputs input:checked').length) return showToast("至少选择一种可用器械");
  const profile = profileFromDialog();
  const blueprint = routineBlueprint(profile.daysPerWeek);
  const templates = blueprint.map((item) => generatedTemplateFromMuscles(`${item.name} · ${TRAINING_GOAL_LABELS[profile.goal]}`, item.muscles, profile));
  if (!templates.some((template) => template.exercises.length)) return showToast("当前器械条件下没有可用动作，请先补充动作或器械");
  const oldPlan = normalizeWeeklyPlan(state.weeklyPlan);
  const days = preferredTrainingDays(profile.daysPerWeek);
  state.templates = state.templates.filter((template) => template.generatedBy !== "smart-plan").concat(templates);
  state.weeklyPlan = Array.from({ length: 7 }, (_, dayIndex) => {
    const position = days.indexOf(dayIndex);
    if (position < 0) return { dayIndex, isTrainingDay: false, templateId: "", reminderTime: "" };
    const previous = oldPlan[dayIndex];
    return { dayIndex, isTrainingDay: true, templateId: templates[position % templates.length].id, reminderTime: previous?.reminderTime || "18:00" };
  });
  state.trainingProfile = profile;
  state.planOverrides = [];
  saveState();
  renderTemplates();
  renderTodayPlan();
  renderSmartProfileSummary();
  renderRecoveryAdvisor();
  $("#smartPlanDialog").close();
  showToast(`已生成 ${profile.daysPerWeek} 天训练计划，可在周计划里改日期和时间`);
}

function creatorMuscles(target) {
  if (target === "upper") return ["胸", "背", "肩", "二头", "三头"];
  if (target === "lower") return ["股四头", "后链", "臀", "小腿", "核心"];
  if (MUSCLE_GROUPS.includes(target)) return [target];
  return ["胸", "背", "股四头", "后链", "肩", "核心"];
}

function rebuildCreatorPreview() {
  const profile = normalizeTrainingProfile(state.trainingProfile);
  const target = $("#creatorTargetInput")?.value || "full";
  const minutes = Number($("#creatorMinutesInput")?.value) || profile.sessionMinutes;
  const label = $("#creatorTargetInput")?.selectedOptions?.[0]?.textContent || "全身";
  creatorDraftTemplate = generatedTemplateFromMuscles(`${label} · ${minutes} 分钟`, creatorMuscles(target), profile, minutes);
  creatorDraftTemplate.runtime = true;
  const root = $("#creatorPreview");
  if (!root) return;
  root.innerHTML = creatorDraftTemplate.exercises.length
    ? creatorDraftTemplate.exercises.map((item, index) => { const exercise = exerciseById(item.exerciseId); return `<div class="creator-row"><span>${index + 1}</span><div><strong>${exercise?.name || "动作"}</strong><small>${exercise?.primaryMuscle || "其他"} · ${item.sets.length} 组 × ${item.sets[0]?.reps || 0} 次</small></div></div>`; }).join("")
    : '<div class="empty-state">当前器械条件下没有匹配动作。</div>';
}

function openWorkoutCreator() {
  const profile = normalizeTrainingProfile(state.trainingProfile);
  $("#creatorMinutesInput").value = String([30, 45, 60, 75].includes(profile.sessionMinutes) ? profile.sessionMinutes : 60);
  $("#creatorTargetInput").value = "full";
  rebuildCreatorPreview();
  $("#workoutCreatorDialog").showModal();
}

function startCreatedWorkout() {
  if (!creatorDraftTemplate?.exercises?.length) return showToast("没有可开始的动作");
  $("#workoutCreatorDialog").close();
  $("#workoutDate").value = localDateISO();
  beginTemplateRun(clone(creatorDraftTemplate), true);
  navigate("log");
}

function saveCreatedWorkout() {
  if (!creatorDraftTemplate?.exercises?.length) return showToast("没有可保存的动作");
  const saved = clone(creatorDraftTemplate);
  saved.id = crypto.randomUUID?.() || `template-${Date.now()}`;
  saved.runtime = false;
  saved.generatedBy = "workout-creator";
  state.templates.push(saved);
  saveState();
  renderTemplates();
  showToast("已保存为训练模板");
}

function renderProgressionSuggestion() {
  const exercise = exerciseById($("#exerciseSelect")?.value);
  if (!exercise || !$("#progressionSuggestionTitle")) return;
  const record = lastComparableRecord(exercise.id);
  if (!record) {
    $("#progressionSuggestionTitle").textContent = "先完成一次这个动作";
    $("#progressionSuggestionBody").textContent = "有训练记录后，会结合重量、次数、RPE 和反馈给出下一次建议。";
    return;
  }
  const sets = countableSets(record.sets).filter((set) => Number(set.reps) > 0);
  const avgRpeValues = sets.map((set) => Number(set.rpe)).filter((value) => value >= 6 && value <= 10);
  const avgRpe = avgRpeValues.length ? avgRpeValues.reduce((sum, value) => sum + value, 0) / avgRpeValues.length : 8;
  const avgReps = sets.length ? sumReps(sets) / sets.length : 0;
  const feedback = record.feedback || "";
  if (exercise.mode === "bodyweight") {
    const add = feedback === "easy" || avgRpe <= 7.5 ? 2 : feedback === "hard" || avgRpe >= 9.5 ? 0 : 1;
    $("#progressionSuggestionTitle").textContent = add ? `每组尝试 +${add} 次` : "先保持次数，不急着增加";
    $("#progressionSuggestionBody").textContent = `上次平均 ${formatNumber(avgReps, 1)} 次 / RPE ${formatNumber(avgRpe, 1)}${feedback ? ` · 反馈：${feedback === "easy" ? "太轻" : feedback === "hard" ? "太难" : "合适"}` : ""}。`;
    return;
  }
  const workingWeight = representativeWorkingWeight(sets);
  if (feedback === "hard" || avgRpe >= 9.5) {
    $("#progressionSuggestionTitle").textContent = `保持 ${formatNumber(workingWeight, 1)} kg，先少 1 次/组`;
    $("#progressionSuggestionBody").textContent = `上次 RPE ${formatNumber(avgRpe, 1)} 偏高，优先把动作质量和完成度稳定下来。`;
  } else if (feedback === "easy" || avgRpe <= 7.5) {
    $("#progressionSuggestionTitle").textContent = `尝试 ${formatNumber(workingWeight + 2.5, 1)} kg`;
    $("#progressionSuggestionBody").textContent = `上次代表性重量 ${formatNumber(workingWeight, 1)} kg · 平均 ${formatNumber(avgReps, 1)} 次 · RPE ${formatNumber(avgRpe, 1)}，可以小幅加重。`;
  } else {
    $("#progressionSuggestionTitle").textContent = `保持 ${formatNumber(workingWeight, 1)} kg，每组 +1 次`;
    $("#progressionSuggestionBody").textContent = `先用相同重量增加总次数；当 RPE 仍稳定在 8 左右，再增加重量。`;
  }
}

function openWorkoutFeedback(recordId) {
  const record = state.records.find((item) => item.id === recordId);
  if (!record) return;
  pendingFeedbackRecordId = recordId;
  const exercise = exerciseById(record.exerciseId);
  $("#feedbackExerciseLabel").textContent = `${exercise?.name || "这个动作"} · 反馈会用于下一次渐进建议。`;
  $("#workoutFeedbackDialog").showModal();
}

function saveWorkoutFeedback(feedback) {
  const record = state.records.find((item) => item.id === pendingFeedbackRecordId);
  if (!record || !["easy", "good", "hard"].includes(feedback)) return;
  record.feedback = feedback;
  record.updatedAt = new Date().toISOString();
  saveState();
  pendingFeedbackRecordId = null;
  $("#workoutFeedbackDialog").close();
  renderProgressionSuggestion();
  renderWorkoutDay();
  renderAdaptiveInsights();
  showToast("训练反馈已记录");
}

function recordLoadMoment(record) {
  const created = record?.createdAt ? new Date(record.createdAt) : null;
  if (created && !Number.isNaN(created.getTime()) && localDateISO(created) === record.date) return created;
  const date = dateFromISO(record?.date);
  date.setHours(20, 0, 0, 0);
  return date;
}

function averageRecordRpe(record) {
  const values = countableSets(record?.sets || []).map((set) => Number(set.rpe)).filter((value) => value >= 6 && value <= 10);
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : 8;
}

function muscleRecoveryAt(targetDate = new Date()) {
  const target = new Date(targetDate);
  const targetIso = localDateISO(target);
  const fatigue = Object.fromEntries(MUSCLE_GROUPS.map((muscle) => [muscle, 0]));
  state.records.forEach((record) => {
    if (record.date > targetIso) return;
    const exercise = exerciseById(record.exerciseId);
    const muscle = MUSCLE_GROUPS.includes(exercise?.primaryMuscle) ? exercise.primaryMuscle : "其他";
    const sets = sumSets(record.sets);
    if (!sets) return;
    const hours = Math.max(0, (target - recordLoadMoment(record)) / 36e5);
    if (hours >= 72) return;
    const rpeFactor = Math.min(1.05, Math.max(.6, averageRecordRpe(record) / 10));
    const feedbackFactor = record.feedback === "hard" ? 1.2 : record.feedback === "easy" ? .85 : 1;
    const decay = Math.max(0, 1 - hours / 72);
    fatigue[muscle] += sets * rpeFactor * feedbackFactor * 14 * decay;
  });
  return Object.fromEntries(MUSCLE_GROUPS.map((muscle) => [muscle, Math.max(0, Math.round(100 - Math.min(100, fatigue[muscle])))]));
}

function recoveryStatus(value) {
  if (value >= 85) return { label: "可训练", level: "ready" };
  if (value >= 65) return { label: "基本恢复", level: "mostly" };
  if (value >= 40) return { label: "恢复中", level: "recovering" };
  return { label: "负荷偏高", level: "tired" };
}

function recoveryRecommendedMuscles(limit = 3) {
  const recovery = muscleRecoveryAt(new Date());
  const week = muscleWeekStats();
  const equipment = normalizeTrainingProfile(state.trainingProfile).equipment;
  const available = new Set(state.exercises
    .filter((exercise) => equipment.includes(exercise.equipment || inferEquipment(exercise.name, exercise.mode, exercise.equipment)))
    .map((exercise) => exercise.primaryMuscle));
  return MUSCLE_GROUPS
    .filter((muscle) => muscle !== "其他" && available.has(muscle))
    .map((muscle) => ({ muscle, recovery: recovery[muscle], weekSets: week[muscle] || 0, score: recovery[muscle] - (week[muscle] || 0) * 2.5 }))
    .sort((a, b) => b.score - a.score || b.recovery - a.recovery)
    .slice(0, limit);
}

function renderRecoveryAdvisor() {
  const recovery = muscleRecoveryAt(new Date());
  const ranked = recoveryRecommendedMuscles(3);
  const quick = $("#recoveryQuickMuscles");
  if (quick) quick.innerHTML = ranked.map((item) => {
    const status = recoveryStatus(item.recovery);
    return `<span class="recovery-chip ${status.level}"><b>${item.muscle}</b><strong>${item.recovery}%</strong></span>`;
  }).join("") || '<span class="muted">先添加可用训练动作</span>';

  if ($("#recoveryRecommendationTitle")) {
    const hasHistory = state.records.length > 0;
    const ready = ranked.filter((item) => item.recovery >= 65);
    $("#recoveryRecommendationTitle").textContent = !hasHistory
      ? "先按计划训练，之后会形成恢复估算"
      : ready.length ? `今天优先：${ready.map((item) => item.muscle).join(" + ")}` : "今天整体负荷偏高，建议降低训练量";
    $("#recoveryRecommendationBody").textContent = !hasHistory
      ? "恢复分数会根据最近训练时间、正式组数、RPE 与训练反馈逐步建立。"
      : ready.length
        ? `这些肌群当前恢复分数较高，同时本周训练量相对不过量。分数按约 72 小时负荷衰减估算。`
        : "近期多个可用肌群仍在恢复中；如果仍训练，优先减少正式组或选择技术性较轻的训练。";
    const best = ranked[0]?.recovery ?? 100;
    const badge = $("#recoveryRecommendationBadge");
    badge.textContent = `${best}% · ${recoveryStatus(best).label}`;
    badge.className = `recovery-status-badge ${recoveryStatus(best).level}`;
  }

  const grid = $("#muscleRecoveryGrid");
  if (grid) {
    grid.innerHTML = MUSCLE_GROUPS.filter((muscle) => muscle !== "其他").map((muscle) => {
      const value = recovery[muscle];
      const status = recoveryStatus(value);
      return `<article class="recovery-muscle-card ${status.level}"><div><span>${muscle}</span><small>${status.label}</small></div><strong>${value}%</strong><i><b style="width:${value}%"></b></i></article>`;
    }).join("");
  }
}

function startRecoveryWorkout() {
  const profile = normalizeTrainingProfile(state.trainingProfile);
  const ranked = recoveryRecommendedMuscles(4).filter((item) => item.recovery >= 55);
  const muscles = ranked.slice(0, profile.sessionMinutes <= 45 ? 2 : 3).map((item) => item.muscle);
  if (!muscles.length) return showToast("当前恢复分数偏低，建议先休息或手动选择轻量训练");
  const template = generatedTemplateFromMuscles(`恢复推荐 · ${muscles.join("+")}`, muscles, profile, profile.sessionMinutes);
  if (!template.exercises.length) return showToast("当前器械条件下没有匹配动作");
  template.runtime = true;
  beginTemplateRun(template, true);
  navigate("log");
}

function templateMuscles(template) {
  return [...new Set((template?.exercises || []).map((item) => exerciseById(item.exerciseId)?.primaryMuscle).filter((muscle) => MUSCLE_GROUPS.includes(muscle) && muscle !== "其他"))];
}

function templateRecoveryScore(template, readiness) {
  const muscles = templateMuscles(template);
  if (!muscles.length) return 40;
  return muscles.reduce((sum, muscle) => sum + (readiness[muscle] ?? 100), 0) / muscles.length;
}

function applyTemplateFatigue(readiness, template) {
  const setsByMuscle = Object.fromEntries(MUSCLE_GROUPS.map((muscle) => [muscle, 0]));
  (template?.exercises || []).forEach((item) => {
    const muscle = exerciseById(item.exerciseId)?.primaryMuscle || "其他";
    setsByMuscle[muscle] += (item.sets || []).filter((set) => (set.type || "normal") !== "warmup").length || 3;
  });
  MUSCLE_GROUPS.forEach((muscle) => {
    readiness[muscle] = Math.max(0, (readiness[muscle] ?? 100) - Math.min(65, setsByMuscle[muscle] * 9));
  });
}

function buildAdaptivePlanSuggestions() {
  const readiness = { ...muscleRecoveryAt(new Date()) };
  const basePlan = normalizeWeeklyPlan(state.weeklyPlan);
  const candidates = state.templates.filter((template) => template.exercises?.length);
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const suggestions = [];
  let previousTemplateId = "";

  for (let offset = 0; offset < 7; offset += 1) {
    if (offset > 0) MUSCLE_GROUPS.forEach((muscle) => { readiness[muscle] = Math.min(100, readiness[muscle] + 32); });
    const date = addDays(today, offset);
    const dateIso = localDateISO(date);
    const entry = basePlan[currentWeekdayIndex(date)];
    if (!entry?.isTrainingDay) continue;
    if (offset === 0 && state.records.some((record) => record.date === dateIso)) continue;
    const planned = state.templates.find((template) => template.id === entry.templateId) || null;
    const plannedScore = planned ? templateRecoveryScore(planned, readiness) : 0;
    const ranked = candidates.map((template) => ({
      template,
      score: templateRecoveryScore(template, readiness) - (template.id === previousTemplateId ? 8 : 0),
    })).sort((a, b) => b.score - a.score);
    const best = ranked[0] || null;
    let chosen = planned;
    let reason = planned ? `原计划平均恢复 ${formatNumber(plannedScore)}%` : "原计划为自由训练";
    if (!planned && best && best.score >= 60) {
      chosen = best.template;
      reason = `自由训练日建议 ${chosen.name}，相关肌群平均恢复约 ${formatNumber(best.score)}%`;
    } else if (planned && plannedScore < 55 && best && best.template.id !== planned.id && best.score >= plannedScore + 12) {
      chosen = best.template;
      reason = `${planned.name} 相关肌群仅约 ${formatNumber(plannedScore)}% 恢复，改为 ${chosen.name} 更合适`;
    } else if (planned) {
      reason = `${planned.name} 相关肌群平均恢复约 ${formatNumber(plannedScore)}%，建议保持`;
    }
    const chosenScore = chosen ? templateRecoveryScore(chosen, readiness) : 100;
    suggestions.push({
      date: dateIso,
      dayIndex: currentWeekdayIndex(date),
      reminderTime: entry.reminderTime,
      baseTemplateId: planned?.id || "",
      chosenTemplateId: chosen?.id || "",
      chosenName: chosen?.name || "自由训练",
      changed: (planned?.id || "") !== (chosen?.id || ""),
      score: chosenScore,
      reason,
    });
    if (chosen) {
      applyTemplateFatigue(readiness, chosen);
      previousTemplateId = chosen.id;
    }
  }
  return suggestions;
}

function renderAdaptivePlanPreview() {
  const root = $("#adaptivePlanPreview");
  if (!root) return;
  root.innerHTML = adaptivePlanDraft.length
    ? adaptivePlanDraft.map((item) => `<article class="adaptive-plan-row ${item.changed ? "changed" : "kept"}"><div><strong>${formatDate(item.date)} · ${item.reminderTime}</strong><small>${item.reason}</small></div><span>${item.changed ? "调整" : "保持"}</span><b>${item.chosenName}</b></article>`).join("")
    : '<div class="empty-state">未来 7 天没有训练日。先在周计划里选择训练日。</div>';
}

function openAdaptivePlanDialog() {
  adaptivePlanDraft = buildAdaptivePlanSuggestions();
  renderAdaptivePlanPreview();
  $("#adaptivePlanDialog").showModal();
}

function applyAdaptivePlan() {
  if (!adaptivePlanDraft.length) return showToast("未来 7 天没有可调整训练日");
  const dates = new Set(adaptivePlanDraft.map((item) => item.date));
  const preserved = normalizePlanOverrides(state.planOverrides).filter((item) => !dates.has(item.date));
  const overrides = adaptivePlanDraft
    .filter((item) => item.changed && item.chosenTemplateId)
    .map((item) => ({ date: item.date, templateId: item.chosenTemplateId, reason: item.reason, createdAt: new Date().toISOString() }));
  state.planOverrides = [...preserved, ...overrides];
  saveState();
  $("#adaptivePlanDialog").close();
  renderTodayPlan();
  showToast(overrides.length ? `已应用 ${overrides.length} 个临时调整` : "当前周计划无需调整");
}

function clearAdaptivePlan() {
  state.planOverrides = [];
  saveState();
  renderTodayPlan();
  adaptivePlanDraft = buildAdaptivePlanSuggestions();
  renderAdaptivePlanPreview();
  showToast("已清除恢复调节，恢复基础周计划");
}

function muscleStatsForRecords(records) {
  const stats = Object.fromEntries(MUSCLE_GROUPS.map((muscle) => [muscle, 0]));
  (records || []).forEach((record) => {
    const muscle = exerciseById(record.exerciseId)?.primaryMuscle || "其他";
    stats[MUSCLE_GROUPS.includes(muscle) ? muscle : "其他"] += sumSets(record.sets);
  });
  return stats;
}

function renderBalanceInsights() {
  const root = $("#balanceInsights");
  if (!root) return;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const records = recordsBetween(addDays(today, -27), today);
  const stats = muscleStatsForRecords(records);
  const push = stats["胸"] + stats["肩"] + stats["三头"];
  const pull = stats["背"] + stats["二头"];
  const frontLeg = stats["股四头"];
  const backLeg = stats["后链"] + stats["臀"];
  const insights = [];
  if (push + pull >= 12) {
    if (push > pull * 1.5) insights.push(`近 4 周推类 ${push} 组、拉类 ${pull} 组，拉类训练相对偏少。`);
    else if (pull > push * 1.5) insights.push(`近 4 周拉类 ${pull} 组、推类 ${push} 组，推类训练相对偏少。`);
  }
  if (frontLeg + backLeg >= 8) {
    if (frontLeg > backLeg * 1.7) insights.push(`股四头 ${frontLeg} 组明显多于后链/臀 ${backLeg} 组，可关注后侧训练。`);
    else if (backLeg > frontLeg * 1.7) insights.push(`后链/臀 ${backLeg} 组明显多于股四头 ${frontLeg} 组，可关注膝主导训练。`);
  }
  const active = MUSCLE_GROUPS.filter((muscle) => muscle !== "其他").map((muscle) => ({ muscle, sets: stats[muscle] })).sort((a, b) => b.sets - a.sets);
  const maxSets = active[0]?.sets || 0;
  const low = active.filter((item) => maxSets >= 8 && item.sets <= maxSets * .2 && state.exercises.some((exercise) => exercise.primaryMuscle === item.muscle)).slice(0, 2);
  low.forEach((item) => insights.push(`${item.muscle}近 4 周只有 ${item.sets} 组，相比最高肌群训练量明显偏少。`));
  if (!insights.length) insights.push(records.length ? "近 4 周没有发现明显的推/拉或前后腿训练量偏差。" : "训练数据还不足，至少积累几次训练后再判断分布。 ");
  $("#balanceStatusBadge").textContent = insights.length === 1 && /没有发现/.test(insights[0]) ? "较均衡" : records.length ? "需关注" : "待积累";
  root.innerHTML = insights.slice(0, 4).map((text) => `<div class="adaptive-insight-item"><span>•</span><p>${text}</p></div>`).join("");
}

function bestExerciseTrend(startCurrent, endCurrent, startPrevious, endPrevious) {
  let best = null;
  state.exercises.forEach((exercise) => {
    const current = state.records.filter((record) => record.exerciseId === exercise.id && record.date >= localDateISO(startCurrent) && record.date <= localDateISO(endCurrent));
    const previous = state.records.filter((record) => record.exerciseId === exercise.id && record.date >= localDateISO(startPrevious) && record.date <= localDateISO(endPrevious));
    if (!current.length || !previous.length) return;
    const currentValue = exercise.mode === "bodyweight" ? bestSetRepsForRecords(current) : Math.max(0, ...current.flatMap((record) => countableSets(record.sets).map((set) => estimated1rm(set.weight, set.reps))));
    const previousValue = exercise.mode === "bodyweight" ? bestSetRepsForRecords(previous) : Math.max(0, ...previous.flatMap((record) => countableSets(record.sets).map((set) => estimated1rm(set.weight, set.reps))));
    if (!previousValue || currentValue <= previousValue) return;
    const change = ((currentValue - previousValue) / previousValue) * 100;
    if (!best || change > best.change) best = { exercise, change, currentValue, previousValue };
  });
  return best;
}

function renderFourWeekSummary() {
  const root = $("#fourWeekSummary");
  if (!root) return;
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const currentStart = addDays(today, -27);
  const previousEnd = addDays(today, -28);
  const previousStart = addDays(today, -55);
  const currentRecords = recordsBetween(currentStart, today);
  const previousRecords = recordsBetween(previousStart, previousEnd);
  const current = periodTrainingStats(currentRecords);
  const previous = periodTrainingStats(previousRecords);
  const muscles = muscleStatsForRecords(currentRecords);
  const topMuscle = MUSCLE_GROUPS.filter((muscle) => muscle !== "其他").map((muscle) => ({ muscle, sets: muscles[muscle] })).sort((a, b) => b.sets - a.sets)[0];
  const trend = bestExerciseTrend(currentStart, today, previousStart, previousEnd);
  const hardFeedback = currentRecords.filter((record) => record.feedback === "hard").length;
  const insights = [];
  insights.push(`最近 4 周训练 ${current.days} 天、${current.sets} 个正式组${previous.sets ? `，组数较前 4 周 ${comparisonBadge(current, previous).replace(" 组数", "")}` : ""}。`);
  if (topMuscle?.sets) insights.push(`训练量最高的是${topMuscle.muscle}：${topMuscle.sets} 组。`);
  if (trend) insights.push(`${trend.exercise.name} 的${trend.exercise.mode === "bodyweight" ? "单组次数" : "估算力量表现"}较前 4 周提升约 ${formatNumber(trend.change)}%。`);
  if (hardFeedback) insights.push(`最近 4 周有 ${hardFeedback} 次“太难”反馈，自动建议会优先避免继续加量。`);
  if (insights.length < 3) insights.push("继续稳定记录 RPE 和训练反馈，阶段总结会更有参考价值。 ");
  $("#fourWeekBadge").textContent = `${current.days} 天 · ${current.sets} 组`;
  root.innerHTML = insights.slice(0, 4).map((text) => `<div class="adaptive-insight-item"><span>•</span><p>${text}</p></div>`).join("");
}

function renderAdaptiveInsights() {
  renderRecoveryAdvisor();
  renderBalanceInsights();
  renderFourWeekSummary();
}

function renderRestTimer() {
  const root = $("#restTimer");
  if (!root) return;
  const mins = String(Math.floor(restTimerRemaining / 60)).padStart(2, "0");
  const secs = String(restTimerRemaining % 60).padStart(2, "0");
  $("#restTimerValue").textContent = `${mins}:${secs}`;
  root.classList.toggle("hidden", restTimerRemaining <= 0 && !restTimerHandle);
}

function stopRestTimer(showFinished = false) {
  if (restTimerHandle) window.clearInterval(restTimerHandle);
  restTimerHandle = null;
  if (showFinished) {
    restTimerRemaining = 0;
    renderRestTimer();
    $("#restTimer").classList.remove("hidden");
    showToast("休息结束，准备下一组");
    setTimeout(() => $("#restTimer").classList.add("hidden"), 2500);
  } else {
    restTimerRemaining = 0;
    renderRestTimer();
  }
}

function startRestTimer(seconds = state.settings.restSeconds) {
  if (restTimerHandle) window.clearInterval(restTimerHandle);
  restTimerRemaining = Math.max(1, Number(seconds) || 120);
  renderRestTimer();
  $("#restTimer").classList.remove("hidden");
  restTimerHandle = window.setInterval(() => {
    restTimerRemaining -= 1;
    renderRestTimer();
    if (restTimerRemaining <= 0) stopRestTimer(true);
  }, 1000);
}

function adjustRestTimer(delta) {
  if (!restTimerHandle && restTimerRemaining <= 0) startRestTimer();
  restTimerRemaining = Math.max(0, restTimerRemaining + delta);
  if (restTimerRemaining === 0) return stopRestTimer(false);
  renderRestTimer();
}

function renderGroupExerciseList() {
  const root = $("#groupExerciseList");
  if (!root) return;
  root.innerHTML = "";
  const currentId = $("#exerciseSelect")?.value;
  const activeIds = activeGroup?.exerciseIds || [];
  sortedExercises().forEach((exercise) => {
    const label = document.createElement("label");
    label.className = "group-exercise-option";
    const input = document.createElement("input");
    input.type = "checkbox";
    input.value = exercise.id;
    input.dataset.groupExercise = exercise.id;
    input.checked = activeIds.length ? activeIds.includes(exercise.id) : exercise.id === currentId;
    const copy = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = exercise.name;
    const meta = document.createElement("small");
    meta.textContent = exerciseModeLabel(exercise);
    copy.append(name, meta);
    label.append(input, copy);
    root.appendChild(label);
  });
}

function renderGroupStatus() {
  if (!$("#groupStatus")) return;
  if (!activeGroup?.exerciseIds?.length) {
    $("#groupStatus").textContent = "普通顺序";
    $("#clearGroupButton").classList.add("hidden");
    return;
  }
  const modeLabel = activeGroup.mode === "circuit" ? "Circuit" : "超级组";
  const names = activeGroup.exerciseIds.map((id) => exerciseById(id)?.name || "动作");
  const currentId = $("#exerciseSelect")?.value;
  const currentIndex = activeGroup.exerciseIds.indexOf(currentId);
  const position = currentIndex >= 0 ? `${currentIndex + 1}/${activeGroup.exerciseIds.length}` : "已建立";
  $("#groupStatus").textContent = `${modeLabel} · ${position} · ${names.join(" → ")}`;
  $("#clearGroupButton").classList.remove("hidden");
}

function openGroupBuilder() {
  $("#groupModeSelect").value = activeGroup?.mode || "superset";
  renderGroupExerciseList();
  $("#groupBuilderDialog").showModal();
}

function applyTrainingGroup() {
  const mode = $("#groupModeSelect").value === "circuit" ? "circuit" : "superset";
  const selected = $$("[data-group-exercise]:checked").map((input) => input.value);
  const currentId = $("#exerciseSelect").value;
  if (!selected.includes(currentId)) selected.unshift(currentId);
  const unique = [...new Set(selected)];
  if (mode === "superset" && unique.length !== 2) return showToast("超级组需要刚好 2 个动作");
  if (mode === "circuit" && unique.length < 3) return showToast("Circuit 至少需要 3 个动作");
  const previousDrafts = activeGroup?.drafts || {};
  const previousNotes = activeGroup?.notes || {};
  previousDrafts[currentId] = clone(draftSets);
  previousNotes[currentId] = $("#workoutNote").value;
  activeGroup = {
    id: activeGroup?.id || (crypto.randomUUID?.() || `group-${Date.now()}`),
    mode,
    exerciseIds: unique,
    drafts: previousDrafts,
    notes: previousNotes,
    savedExerciseIds: [],
  };
  $("#groupBuilderDialog").close();
  renderGroupStatus();
  showToast(mode === "circuit" ? `Circuit 已建立 · ${unique.length} 个动作` : "超级组已建立");
}

function clearTrainingGroup() {
  activeGroup = null;
  renderGroupStatus();
  showToast("已退出训练编组");
}

function stashCurrentGroupDraft() {
  const currentId = $("#exerciseSelect")?.value;
  if (!activeGroup?.exerciseIds?.includes(currentId)) return;
  activeGroup.drafts ||= {};
  activeGroup.notes ||= {};
  activeGroup.drafts[currentId] = clone(draftSets);
  activeGroup.notes[currentId] = $("#workoutNote").value;
}

function loadGroupExercise(exerciseId) {
  if (!activeGroup?.exerciseIds?.includes(exerciseId)) return false;
  $("#exerciseSelect").value = exerciseId;
  draftSets = activeGroup.drafts?.[exerciseId]
    ? activeGroup.drafts[exerciseId].map((set) => newDraftSet(set))
    : [newDraftSet(), newDraftSet(), newDraftSet()];
  $("#workoutNote").value = activeGroup.notes?.[exerciseId] || "";
  updateCurrentExerciseName();
  renderGroupStatus();
  return true;
}

function advanceTrainingGroup(savedExerciseId, preserveCurrent = true) {
  if (!activeGroup?.exerciseIds?.includes(savedExerciseId)) return false;
  if (preserveCurrent) stashCurrentGroupDraft();
  const currentIndex = activeGroup.exerciseIds.indexOf(savedExerciseId);
  const nextId = activeGroup.exerciseIds[(currentIndex + 1) % activeGroup.exerciseIds.length];
  loadGroupExercise(nextId);
  showToast(`下一项：${exerciseById(nextId)?.name || "动作"}`);
  return true;
}

function currentWorkWeight() {
  const draftMax = Math.max(0, ...draftSets
    .filter((set) => (set.type || "normal") !== "warmup")
    .map((set) => Number(set.weight) || 0));
  if (draftMax) return draftMax;
  return bestStatsForExercise($("#exerciseSelect")?.value).bestWeight || 20;
}

function warmupPlan(workWeight, count) {
  const presets = {
    2: [[0.5, 8], [0.75, 3]],
    3: [[0.4, 8], [0.6, 5], [0.8, 2]],
    4: [[0.4, 8], [0.55, 5], [0.7, 3], [0.85, 1]],
  };
  return (presets[count] || presets[3]).map(([ratio, reps]) => ({
    weight: Math.max(2.5, Math.round((workWeight * ratio) / 2.5) * 2.5),
    reps,
    ratio,
  }));
}

function renderWarmupPreview() {
  const workWeight = Number($("#warmupWorkWeight")?.value) || 0;
  const count = Number($("#warmupSetCount")?.value) || 3;
  const root = $("#warmupPreview");
  if (!root) return;
  if (!workWeight) {
    root.innerHTML = '<div class="empty-state calculator-empty">输入工作重量后生成热身方案。</div>';
    return;
  }
  const plan = warmupPlan(workWeight, count);
  root.innerHTML = plan.map((set, index) => `<div class="calculator-line"><span>W${index + 1} · ${Math.round(set.ratio * 100)}%</span><strong>${formatNumber(set.weight, 1)} kg × ${set.reps}</strong></div>`).join("");
}

function openWarmupCalculator() {
  if (isBodyweightExercise($("#exerciseSelect").value)) return;
  $("#warmupWorkWeight").value = formatNumber(currentWorkWeight(), 1).replace(/,/g, "");
  renderWarmupPreview();
  $("#warmupDialog").showModal();
}

function applyWarmupPlan() {
  const workWeight = Number($("#warmupWorkWeight").value);
  const count = Number($("#warmupSetCount").value) || 3;
  if (!workWeight || workWeight <= 0) return showToast("请输入有效工作重量");
  const warmups = warmupPlan(workWeight, count).map((set) => newDraftSet({
    weight: String(set.weight),
    reps: String(set.reps),
    type: "warmup",
    completed: false,
  }));
  draftSets = [...warmups, ...draftSets.filter((set) => (set.type || "normal") !== "warmup")];
  renderSetRows();
  renderFocusMetric();
  $("#warmupDialog").close();
  showToast(`已加入 ${warmups.length} 组热身`);
}

function platePlan(target, barWeight) {
  const perSide = Math.max(0, (target - barWeight) / 2);
  const plates = [20, 15, 10, 5, 2.5, 1.25];
  let remaining = perSide;
  const result = [];
  plates.forEach((plate) => {
    const count = Math.floor((remaining + 0.0001) / plate);
    if (count > 0) {
      result.push({ plate, count });
      remaining -= plate * count;
    }
  });
  return { perSide, result, remaining: Math.max(0, remaining) };
}

function renderPlateResult() {
  const target = Number($("#plateTargetWeight")?.value) || 0;
  const barWeight = Number($("#barWeightSelect")?.value) || 20;
  const root = $("#plateResult");
  if (!root) return;
  if (target < barWeight) {
    root.innerHTML = `<div class="empty-state calculator-empty">目标重量不能低于 ${barWeight} kg 杠铃杆。</div>`;
    return;
  }
  const plan = platePlan(target, barWeight);
  const plateText = plan.result.length
    ? plan.result.map((item) => `${formatNumber(item.plate, 2)}×${item.count}`).join(" + ")
    : "无需加片";
  root.innerHTML = `<div class="plate-total"><span>每侧需要</span><strong>${plateText}</strong></div>
    <div class="calculator-line"><span>每侧片重</span><strong>${formatNumber(plan.perSide - plan.remaining, 2)} kg</strong></div>
    ${plan.remaining > 0.001 ? `<div class="calculator-warning">现有常见片无法精确达到，还差每侧 ${formatNumber(plan.remaining, 2)} kg。</div>` : '<div class="calculator-success">可以精确配到目标重量。</div>'}`;
}

function openPlateCalculator() {
  if (isBodyweightExercise($("#exerciseSelect").value)) return;
  const exercise = exerciseById($("#exerciseSelect").value);
  $("#plateTargetWeight").value = formatNumber(currentWorkWeight(), 1).replace(/,/g, "");
  $("#barWeightSelect").value = String(exercise?.barWeight || 20);
  renderPlateResult();
  $("#plateDialog").showModal();
}

function renderDashboard() {
  const today = localDateISO();
  const todayRecords = state.records.filter((r) => r.date === today);
  const todayStats = aggregateRecords(todayRecords);
  const foodCalories = sumFoodCalories(state.foodRecords.filter((r) => r.date === today));
  const goal = Number(state.settings.calorieGoal) || 2200;
  const delta = goal - foodCalories;
  const rawPercent = Math.round(foodCalories / Math.max(1, goal) * 100);
  const ringPercent = Math.min(100, rawPercent);

  $("#todayCalories").textContent = formatNumber(foodCalories);
  $("#todayCalorieGoal").textContent = formatNumber(goal);
  $("#calorieDeltaLabel").textContent = delta >= 0
    ? `剩余 ${formatNumber(delta)} kcal`
    : `超出 ${formatNumber(Math.abs(delta))} kcal`;
  $("#caloriePercent").textContent = `${rawPercent}%`;
  $("#calorieRing").style.setProperty("--progress", `${ringPercent * 3.6}deg`);

  $("#todaySets").textContent = formatNumber(todayStats.sets);
  $("#todayReps").textContent = formatNumber(todayStats.reps);
  $("#todayVolume").textContent = formatNumber(todayStats.volume);

  const weekday = new Intl.DateTimeFormat("zh-CN", { month: "long", day: "numeric", weekday: "long" }).format(new Date());
  $("#todayLabel").textContent = weekday;

  renderWeeklyChart();
  renderRecentExercises();
}

function renderWeeklyChart() {
  const data = [];
  for (let i = 6; i >= 0; i -= 1) {
    const date = daysAgoISO(i);
    const records = state.records.filter((r) => r.date === date);
    data.push({ date, volume: aggregateRecords(records).volume });
  }
  const max = Math.max(...data.map((d) => d.volume), 1);
  const root = $("#weeklyChart");
  root.innerHTML = "";

  data.forEach(({ date, volume }) => {
    const wrap = document.createElement("div");
    wrap.className = "bar-wrap";
    const bar = document.createElement("div");
    bar.className = "bar";
    bar.style.height = `${Math.max(volume ? 8 : 3, (volume / max) * 110)}px`;
    bar.title = `${formatDate(date)}：${formatNumber(volume)} kg`;
    const label = document.createElement("span");
    label.className = "bar-label";
    label.textContent = new Intl.DateTimeFormat("zh-CN", { weekday: "short" }).format(dateFromISO(date)).replace("周", "");
    wrap.append(bar, label);
    root.appendChild(wrap);
  });
}

function renderRecentExercises() {
  const root = $("#recentExercises");
  root.innerHTML = "";
  const latest = [...state.records].sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date)).slice(0, 4);
  if (!latest.length) {
    root.innerHTML = '<div class="empty-state">还没有训练记录。点底部“训练”开始第一组。</div>';
    return;
  }

  latest.forEach((record) => {
    const exercise = exerciseById(record.exerciseId);
    const card = document.createElement("article");
    card.className = "list-card";
    const left = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = exercise?.name || "已删除动作";
    const date = document.createElement("p");
    date.className = "muted";
    date.style.marginTop = "5px";
    date.textContent = formatDate(record.date);
    left.append(title, date);

    const meta = document.createElement("div");
    meta.className = "meta";
    const bodyweight = exercise?.mode === "bodyweight";
    meta.innerHTML = bodyweight
      ? `${sumSets(record.sets)} 组 · ${sumReps(record.sets)} 次<br>自重训练`
      : `${sumSets(record.sets)} 组 · ${sumReps(record.sets)} 次<br>${formatNumber(sumVolume(record.sets))} kg`;
    card.dataset.recentEdit = record.id;
    card.classList.add("clickable-card");
    card.append(left, meta);
    root.appendChild(card);
  });
}

function frequentFoodStats() {
  const map = new Map();
  state.foodRecords.forEach((record) => {
    const key = String(record.name || "").trim().toLowerCase();
    if (!key) return;
    const current = map.get(key) || { name: record.name, count: 0, latest: "", record };
    current.count += 1;
    const stamp = record.updatedAt || record.createdAt || record.date || "";
    if (stamp >= current.latest) {
      current.latest = stamp;
      current.name = record.name;
      current.record = record;
    }
    map.set(key, current);
  });
  return [...map.values()].sort((a, b) => b.count - a.count || String(b.latest).localeCompare(String(a.latest))).slice(0, 8);
}

function fillFoodDraftFromRecord(record) {
  if (!record) return;
  $("#foodName").value = record.name || "";
  $("#foodCalories").value = Number(record.calories) || "";
  $("#foodProtein").value = Number(record.protein) || "";
  $("#foodCarbs").value = Number(record.carbs) || "";
  $("#foodFat").value = Number(record.fat) || "";
}

function renderNutritionShortcuts() {
  const frequentRoot = $("#frequentFoods");
  const mealRoot = $("#mealPresets");
  if (frequentRoot) {
    const foods = frequentFoodStats();
    frequentRoot.innerHTML = foods.length
      ? foods.map((item, index) => `<button type="button" data-frequent-food="${index}"><strong>${item.name}</strong><small>${formatNumber(item.record.calories)} kcal · P${formatNumber(item.record.protein, 1)} C${formatNumber(item.record.carbs, 1)} F${formatNumber(item.record.fat, 1)}</small></button>`).join("")
      : '<div class="empty-state compact-empty">记录几次饮食后，这里会自动出现常用食物。</div>';
  }
  if (mealRoot) {
    const presets = state.mealPresets.slice().sort((a, b) => (b.useCount || 0) - (a.useCount || 0) || String(b.lastUsedAt || b.createdAt).localeCompare(String(a.lastUsedAt || a.createdAt)));
    mealRoot.innerHTML = presets.length
      ? presets.map((preset) => {
          const totals = foodMacroTotals(preset.items);
          return `<span class="meal-preset-chip"><button type="button" data-meal-preset="${preset.id}"><strong>${preset.name}</strong><small>${preset.items.length} 项 · ${formatNumber(totals.calories)} kcal</small></button><button class="preset-delete" type="button" data-meal-preset-delete="${preset.id}" aria-label="删除${preset.name}">×</button></span>`;
        }).join("")
      : '<div class="empty-state compact-empty">把当天某一餐保存后，可以一键重复整餐。</div>';
  }
}

function saveCurrentMealPreset() {
  const date = $("#foodDate").value || localDateISO();
  const meal = $("#mealSelect").value || "加餐";
  const items = state.foodRecords.filter((record) => record.date === date && record.meal === meal);
  if (!items.length) return showToast("当前餐次还没有可保存的食物");
  const name = window.prompt("给这份常用餐起个名字", `${meal} · ${formatDate(date)}`)?.trim();
  if (!name) return;
  state.mealPresets.push({
    id: crypto.randomUUID?.() || `meal-${Date.now()}`,
    name,
    meal,
    items: items.map(({ name: itemName, calories, protein, carbs, fat }) => ({ name: itemName, calories, protein, carbs, fat })),
    createdAt: new Date().toISOString(),
    useCount: 0,
    lastUsedAt: "",
  });
  saveState();
  renderNutritionShortcuts();
  showToast("已保存为常用餐");
}

function addMealPresetToDay(presetId) {
  const preset = state.mealPresets.find((item) => item.id === presetId);
  if (!preset) return;
  const date = $("#foodDate").value || localDateISO();
  const now = new Date().toISOString();
  preset.items.forEach((item, index) => {
    state.foodRecords.push({
      id: crypto.randomUUID?.() || `food-${Date.now()}-${index}`,
      date,
      meal: preset.meal,
      name: item.name,
      calories: Number(item.calories) || 0,
      protein: Number(item.protein) || 0,
      carbs: Number(item.carbs) || 0,
      fat: Number(item.fat) || 0,
      createdAt: now,
    });
  });
  preset.useCount = (Number(preset.useCount) || 0) + 1;
  preset.lastUsedAt = now;
  saveState();
  renderCalories();
  renderDashboard();
  showToast(`已加入常用餐：${preset.name}`);
}

function copyPreviousDayFood() {
  const target = dateFromISO($("#foodDate").value || localDateISO());
  const sourceDate = localDateISO(addDays(target, -1));
  const targetDate = localDateISO(target);
  const source = state.foodRecords.filter((record) => record.date === sourceDate);
  if (!source.length) return showToast("前一天没有饮食记录");
  const targetHasFood = state.foodRecords.some((record) => record.date === targetDate);
  if (targetHasFood && !window.confirm("当天已经有饮食记录，继续会追加复制。确定继续吗？")) return;
  const now = new Date().toISOString();
  source.forEach((record, index) => state.foodRecords.push({
    ...record,
    id: crypto.randomUUID?.() || `food-${Date.now()}-${index}`,
    date: targetDate,
    createdAt: now,
    updatedAt: undefined,
  }));
  saveState();
  renderCalories();
  renderDashboard();
  showToast(`已复制 ${source.length} 条前一天饮食`);
}

function nutritionDailySeries(days) {
  return Array.from({ length: days }, (_, index) => {
    const date = daysAgoISO(days - 1 - index);
    return { date, ...foodMacroTotals(foodRecordsForDate(date)) };
  });
}

function renderNutritionTrend() {
  const root = $("#nutritionTrendChart");
  const summary = $("#nutritionTrendSummary");
  if (!root || !summary) return;
  const series = nutritionDailySeries(nutritionRangeDays);
  const logged = series.filter((day) => day.calories > 0);
  const divisor = Math.max(1, logged.length);
  const totals = logged.reduce((acc, day) => {
    acc.calories += day.calories; acc.protein += day.protein; acc.carbs += day.carbs; acc.fat += day.fat; return acc;
  }, { calories: 0, protein: 0, carbs: 0, fat: 0 });
  summary.innerHTML = `
    <article><span>有记录</span><strong>${logged.length}</strong><small>天</small></article>
    <article><span>平均热量</span><strong>${formatNumber(totals.calories / divisor)}</strong><small>kcal</small></article>
    <article><span>平均蛋白</span><strong>${formatNumber(totals.protein / divisor, 1)}</strong><small>g</small></article>
    <article><span>平均碳水 / 脂肪</span><strong>${formatNumber(totals.carbs / divisor, 1)} / ${formatNumber(totals.fat / divisor, 1)}</strong><small>g</small></article>`;

  const width = 680;
  const height = 210;
  const padX = 28;
  const padTop = 18;
  const padBottom = 28;
  const plotH = height - padTop - padBottom;
  const maxCalories = Math.max(Number(state.settings.calorieGoal) || 1, ...series.map((d) => d.calories), 1);
  const maxProtein = Math.max(Number(state.settings.proteinGoal) || 1, ...series.map((d) => d.protein), 1);
  const step = (width - padX * 2) / Math.max(1, series.length);
  const proteinPoints = series.map((day, index) => {
    const x = padX + step * index + step / 2;
    const y = padTop + plotH * (1 - day.protein / maxProtein);
    return `${x},${y}`;
  }).join(" ");
  root.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="${nutritionRangeDays}天热量和蛋白质趋势">
    <line x1="${padX}" y1="${padTop + plotH}" x2="${width - padX}" y2="${padTop + plotH}" class="nutrition-axis" />
    ${series.map((day, index) => {
      const barH = Math.max(0, plotH * day.calories / maxCalories);
      const x = padX + step * index + step * 0.14;
      const barW = Math.max(2, step * 0.72);
      return `<rect x="${x}" y="${padTop + plotH - barH}" width="${barW}" height="${barH}" rx="3" class="nutrition-calorie-bar" />`;
    }).join("")}
    <polyline points="${proteinPoints}" class="nutrition-protein-line" />
    ${series.map((day, index) => {
      if (nutritionRangeDays > 7 && index % 5 !== 0 && index !== series.length - 1) return "";
      const x = padX + step * index + step / 2;
      return `<text x="${x}" y="${height - 8}" text-anchor="middle" class="nutrition-chart-label">${day.date.slice(5).replace("-", "/")}</text>`;
    }).join("")}
  </svg><div class="nutrition-chart-legend"><span><i class="calorie-legend"></i>热量</span><span><i class="protein-legend"></i>蛋白质</span></div>`;
}

function saveBodyRecord() {
  const date = $("#bodyDate").value || localDateISO();
  const weight = Number($("#bodyWeight").value) > 0 ? Number($("#bodyWeight").value) : null;
  const bodyFat = Number($("#bodyFat").value) > 0 ? Number($("#bodyFat").value) : null;
  if (!weight && !bodyFat) return showToast("至少填写体重或体脂一项");
  const existing = state.bodyRecords.find((record) => record.date === date);
  if (existing) Object.assign(existing, { weight, bodyFat, updatedAt: new Date().toISOString() });
  else state.bodyRecords.push({ date, weight, bodyFat, createdAt: new Date().toISOString() });
  state.bodyRecords = normalizeBodyRecords(state.bodyRecords);
  editingBodyDate = null;
  saveState();
  $("#saveBodyRecordButton").textContent = "保存身体记录";
  renderBodyTracking();
  showToast(existing ? "身体记录已更新" : "身体记录已保存");
}

function renderBodyTracking() {
  const summary = $("#bodySummaryGrid");
  const list = $("#bodyRecordList");
  const chart = $("#bodyNutritionChart");
  if (!summary || !list || !chart) return;
  const sorted = state.bodyRecords.slice().sort((a, b) => b.date.localeCompare(a.date));
  const latestWeight = sorted.find((record) => Number(record.weight) > 0);
  const latestFat = sorted.find((record) => Number(record.bodyFat) > 0);
  const thirtyStart = daysAgoISO(29);
  const weight30 = state.bodyRecords.filter((record) => record.date >= thirtyStart && Number(record.weight) > 0).sort((a, b) => a.date.localeCompare(b.date));
  const weightDelta = weight30.length >= 2 ? Number(weight30.at(-1).weight) - Number(weight30[0].weight) : null;
  const recent7 = state.bodyRecords.filter((record) => record.date >= daysAgoISO(6) && Number(record.weight) > 0);
  const avg7 = recent7.length ? recent7.reduce((sum, record) => sum + Number(record.weight), 0) / recent7.length : null;
  summary.innerHTML = `
    <article><span>最新体重</span><strong>${latestWeight ? formatNumber(latestWeight.weight, 1) : "—"}</strong><small>${latestWeight ? "kg" : "暂无"}</small></article>
    <article><span>7天平均</span><strong>${avg7 != null ? formatNumber(avg7, 1) : "—"}</strong><small>${avg7 != null ? "kg" : "暂无"}</small></article>
    <article><span>30天变化</span><strong>${weightDelta == null ? "—" : `${weightDelta > 0 ? "+" : ""}${formatNumber(weightDelta, 1)}`}</strong><small>${weightDelta == null ? "暂无" : "kg"}</small></article>
    <article><span>最新体脂</span><strong>${latestFat ? formatNumber(latestFat.bodyFat, 1) : "—"}</strong><small>${latestFat ? "%" : "暂无"}</small></article>`;

  const days = 30;
  const series = Array.from({ length: days }, (_, index) => {
    const date = daysAgoISO(days - 1 - index);
    const body = state.bodyRecords.find((record) => record.date === date);
    return { date, weight: Number(body?.weight) || null, calories: sumFoodCalories(foodRecordsForDate(date)) };
  });
  const weights = series.map((d) => d.weight).filter(Boolean);
  const maxCal = Math.max(Number(state.settings.calorieGoal) || 1, ...series.map((d) => d.calories), 1);
  if (!weights.length && !series.some((d) => d.calories)) {
    chart.innerHTML = '<div class="empty-state">记录体重和饮食后，这里会把两条趋势放在同一时间轴上。</div>';
  } else {
    const width = 680, height = 220, px = 28, top = 18, bottom = 28, plotH = height - top - bottom;
    const minW = weights.length ? Math.min(...weights) - 0.5 : 0;
    const maxW = weights.length ? Math.max(...weights) + 0.5 : 1;
    const step = (width - px * 2) / days;
    const weightPoints = series.map((day, index) => {
      if (!day.weight) return null;
      const x = px + step * index + step / 2;
      const y = top + plotH * (1 - (day.weight - minW) / Math.max(0.1, maxW - minW));
      return `${x},${y}`;
    }).filter(Boolean).join(" ");
    chart.innerHTML = `<div class="body-chart-title"><strong>30天体重 × 热量</strong><span>用于观察同一阶段趋势，不推断因果</span></div><svg viewBox="0 0 ${width} ${height}">
      ${series.map((day, index) => { const h = plotH * day.calories / maxCal; return `<rect x="${px + step * index + step * .12}" y="${top + plotH - h}" width="${Math.max(2, step * .76)}" height="${h}" rx="2" class="body-calorie-bar" />`; }).join("")}
      ${weightPoints ? `<polyline points="${weightPoints}" class="body-weight-line" />` : ""}
      ${series.map((day, index) => index % 5 === 0 || index === 29 ? `<text x="${px + step * index + step / 2}" y="${height - 8}" text-anchor="middle" class="nutrition-chart-label">${day.date.slice(5).replace("-", "/")}</text>` : "").join("")}
    </svg><div class="nutrition-chart-legend"><span><i class="body-weight-legend"></i>体重</span><span><i class="calorie-legend"></i>热量</span></div>`;
  }
  list.innerHTML = sorted.length
    ? sorted.slice(0, 12).map((record) => `<article class="body-record-row"><div><strong>${formatDate(record.date, true)}</strong><small>${record.weight ? `${formatNumber(record.weight, 1)} kg` : "未记体重"}${record.bodyFat ? ` · 体脂 ${formatNumber(record.bodyFat, 1)}%` : ""}</small></div><div><button type="button" data-body-edit="${record.date}">编辑</button><button type="button" class="danger-action" data-body-delete="${record.date}">删除</button></div></article>`).join("")
    : '<div class="empty-state">还没有身体记录。</div>';
}

function renderCalories() {
  const dateInput = $("#foodDate");
  if (!dateInput.value) dateInput.value = localDateISO();
  const date = dateInput.value;
  const goal = Number(state.settings.calorieGoal) || 2200;
  const entries = state.foodRecords
    .filter((record) => record.date === date)
    .sort((a, b) => String(a.createdAt || "").localeCompare(String(b.createdAt || "")));
  const totals = foodMacroTotals(entries);
  const total = totals.calories;
  const delta = goal - total;

  $("#foodDateLabel").textContent = `${formatDate(date)} `;
  $("#foodDayTotal").textContent = formatNumber(total);
  $("#foodGoal").textContent = formatNumber(goal);
  $("#foodRemaining").textContent = delta >= 0
    ? `剩余 ${formatNumber(delta)} kcal`
    : `超出 ${formatNumber(Math.abs(delta))} kcal`;
  const foodPercent = Math.round(total / Math.max(1, goal) * 100);
  $("#foodProgressBar").style.width = `${Math.min(100, Math.max(0, foodPercent))}%`;
  $("#foodProgressBar").classList.toggle("over", total > goal);
  $("#foodProgressMeta").textContent = `${foodPercent}%`;
  const macroGoals = {
    protein: Number(state.settings.proteinGoal) || 0,
    carbs: Number(state.settings.carbsGoal) || 0,
    fat: Number(state.settings.fatGoal) || 0,
  };
  [["Protein", "protein"], ["Carbs", "carbs"], ["Fat", "fat"]].forEach(([idPart, key]) => {
    const value = totals[key];
    const goalValue = macroGoals[key];
    $("#food" + idPart + "Total").textContent = `${formatNumber(value, 1)} / ${formatNumber(goalValue)} g`;
    $("#food" + idPart + "Bar").style.width = `${goalValue ? Math.min(100, value / goalValue * 100) : 0}%`;
  });
  $$("[data-meal-quick]").forEach((button) => button.classList.toggle("active", button.dataset.mealQuick === $("#mealSelect").value));

  const root = $("#foodEntries");
  root.innerHTML = "";
  if (!entries.length) {
    root.innerHTML = '<div class="empty-state">这一天还没有饮食记录。</div>';
  } else {
    entries.forEach((record) => {
      const row = document.createElement("article");
      row.className = "list-card food-entry";
      const left = document.createElement("div");
      const name = document.createElement("strong");
      name.textContent = record.name || record.meal || "饮食";
      const meal = document.createElement("p");
      meal.className = "muted";
      meal.style.marginTop = "5px";
      meal.textContent = `${record.meal || "饮食"} · P ${formatNumber(record.protein, 1)}g · C ${formatNumber(record.carbs, 1)}g · F ${formatNumber(record.fat, 1)}g`;
      left.append(name, meal);

      const actions = document.createElement("div");
      actions.className = "food-entry-actions";
      const calories = document.createElement("strong");
      calories.className = "accent-text";
      calories.textContent = `${formatNumber(record.calories)} kcal`;
      const edit = document.createElement("button");
      edit.className = "food-edit";
      edit.type = "button";
      edit.dataset.foodEdit = record.id;
      edit.textContent = "编辑";
      const remove = document.createElement("button");
      remove.className = "food-delete";
      remove.type = "button";
      remove.dataset.foodDelete = record.id;
      remove.textContent = "删除";
      actions.append(calories, edit, remove);
      row.append(left, actions);
      root.appendChild(row);
    });
  }

  const week = $("#foodWeek");
  week.innerHTML = "";
  for (let i = 0; i < 7; i += 1) {
    const day = daysAgoISO(i);
    const dayTotal = sumFoodCalories(state.foodRecords.filter((record) => record.date === day));
    const diff = goal - dayTotal;
    const item = document.createElement("article");
    item.className = "history-card food-day-row clickable-card";
    item.dataset.foodDay = day;
    item.innerHTML = `<div><strong>${formatDate(day, i > 5)}</strong><div class="date">${diff >= 0 ? `剩余 ${formatNumber(diff)}` : `超出 ${formatNumber(Math.abs(diff))}`} kcal</div></div><div class="total">${formatNumber(dayTotal)} kcal</div>`;
    week.appendChild(item);
  }
  renderNutritionShortcuts();
  renderNutritionTrend();
  renderBodyTracking();
}

function recordsForExerciseInRange(exerciseId, days) {
  const start = dateFromISO(daysAgoISO(days - 1));
  return state.records.filter((r) => r.exerciseId === exerciseId && dateFromISO(r.date) >= start);
}

function groupByDate(records) {
  return records.reduce((map, record) => {
    if (!map.has(record.date)) map.set(record.date, []);
    map.get(record.date).push(record);
    return map;
  }, new Map());
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function startOfWeek(date = new Date()) {
  const next = new Date(date);
  next.setHours(12, 0, 0, 0);
  const mondayIndex = (next.getDay() + 6) % 7;
  next.setDate(next.getDate() - mondayIndex);
  return next;
}

function recordsBetween(start, end) {
  const startIso = localDateISO(start);
  const endIso = localDateISO(end);
  return state.records.filter((record) => record.date >= startIso && record.date <= endIso);
}

function periodTrainingStats(records) {
  const totals = aggregateRecords(records);
  return {
    ...totals,
    days: new Set(records.map((record) => record.date)).size,
    exercises: records.length,
  };
}

function comparisonPeriods() {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const weekStart = startOfWeek(today);
  const previousWeekStart = addDays(weekStart, -7);
  const previousWeekEnd = addDays(today, -7);

  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1, 12);
  const previousMonthStart = new Date(today.getFullYear(), today.getMonth() - 1, 1, 12);
  const previousMonthLast = new Date(today.getFullYear(), today.getMonth(), 0, 12);
  const previousMonthEnd = new Date(
    previousMonthStart.getFullYear(),
    previousMonthStart.getMonth(),
    Math.min(today.getDate(), previousMonthLast.getDate()),
    12,
  );

  return {
    currentWeek: periodTrainingStats(recordsBetween(weekStart, today)),
    previousWeek: periodTrainingStats(recordsBetween(previousWeekStart, previousWeekEnd)),
    currentMonth: periodTrainingStats(recordsBetween(monthStart, today)),
    previousMonth: periodTrainingStats(recordsBetween(previousMonthStart, previousMonthEnd)),
  };
}

function percentageChange(current, previous) {
  if (!previous) return current ? null : 0;
  return ((current - previous) / previous) * 100;
}

function comparisonBadge(current, previous) {
  const change = percentageChange(current.sets, previous.sets);
  if (change == null) return current.sets ? "新增长" : "—";
  return `${change >= 0 ? "+" : ""}${formatNumber(change, 0)}% 组数`;
}

function renderComparisonBody(root, current, previous) {
  const items = [
    ["训练天", current.days, previous.days, "天"],
    ["正式组", current.sets, previous.sets, "组"],
    ["总次数", current.reps, previous.reps, "次"],
    ["负重容量", current.volume, previous.volume, "kg"],
  ];
  root.innerHTML = items.map(([label, now, before, unit]) => {
    const change = percentageChange(now, before);
    const changeText = change == null ? (now ? "新增" : "—") : `${change >= 0 ? "+" : ""}${formatNumber(change, 0)}%`;
    return `<div><span>${label}</span><strong>${formatNumber(now)} ${unit}</strong><small class="${change != null && change > 0 ? "positive" : change != null && change < 0 ? "negative" : "neutral"}">${changeText}</small></div>`;
  }).join("");
}

function activeWeekStreak() {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const currentStart = startOfWeek(today);
  let streak = 0;
  for (let offset = 0; offset < 104; offset += 1) {
    const start = addDays(currentStart, -7 * offset);
    const end = addDays(start, 6);
    if (recordsBetween(start, end).length) streak += 1;
    else break;
  }
  return streak;
}

function muscleWeekStats() {
  const today = new Date();
  today.setHours(12, 0, 0, 0);
  const records = recordsBetween(startOfWeek(today), today);
  const stats = Object.fromEntries(MUSCLE_GROUPS.map((muscle) => [muscle, 0]));
  records.forEach((record) => {
    const exercise = exerciseById(record.exerciseId);
    const muscle = MUSCLE_GROUPS.includes(exercise?.primaryMuscle) ? exercise.primaryMuscle : "其他";
    stats[muscle] += sumSets(record.sets);
  });
  return stats;
}

function renderMuscleProgress() {
  const stats = muscleWeekStats();
  const max = Math.max(1, ...Object.values(stats));
  const heatmap = $("#muscleHeatmap");
  const list = $("#muscleWeekList");
  if (!heatmap || !list) return;
  heatmap.innerHTML = MUSCLE_GROUPS.map((muscle) => {
    const sets = stats[muscle];
    const level = sets ? Math.max(1, Math.ceil((sets / max) * 4)) : 0;
    return `<article class="muscle-heat-cell heat-${level}"><span>${muscle}</span><strong>${sets}</strong><small>组</small></article>`;
  }).join("");

  const active = MUSCLE_GROUPS.map((muscle) => ({ muscle, sets: stats[muscle] })).sort((a, b) => b.sets - a.sets);
  list.innerHTML = active.map(({ muscle, sets }) => `<div class="muscle-bar-row"><span>${muscle}</span><div><i style="width:${sets ? Math.max(6, (sets / max) * 100) : 0}%"></i></div><strong>${sets} 组</strong></div>`).join("");
}

function renderTrainingCalendar() {
  const root = $("#trainingCalendar");
  if (!root) return;
  const now = new Date();
  const month = new Date(now.getFullYear(), now.getMonth() + calendarMonthOffset, 1, 12);
  const year = month.getFullYear();
  const monthIndex = month.getMonth();
  const daysInMonth = new Date(year, monthIndex + 1, 0).getDate();
  const firstMondayIndex = (month.getDay() + 6) % 7;
  const monthRecords = state.records.filter((record) => {
    const date = dateFromISO(record.date);
    return date.getFullYear() === year && date.getMonth() === monthIndex;
  });
  const grouped = groupByDate(monthRecords);
  const maxSets = Math.max(1, ...[...grouped.values()].map((records) => aggregateRecords(records).sets));
  $("#calendarTitle").textContent = `${year}年${monthIndex + 1}月`;
  root.innerHTML = "";
  for (let i = 0; i < firstMondayIndex; i += 1) {
    const empty = document.createElement("span");
    empty.className = "calendar-day empty";
    root.appendChild(empty);
  }
  for (let day = 1; day <= daysInMonth; day += 1) {
    const iso = localDateISO(new Date(year, monthIndex, day, 12));
    const records = grouped.get(iso) || [];
    const stats = aggregateRecords(records);
    const cell = document.createElement("article");
    const intensity = stats.sets ? Math.max(1, Math.ceil((stats.sets / maxSets) * 4)) : 0;
    cell.className = `calendar-day intensity-${intensity} ${iso === localDateISO() ? "today" : ""}`;
    cell.title = records.length ? `${formatDate(iso)} · ${stats.sets}组 · ${stats.reps}次` : formatDate(iso);
    cell.innerHTML = `<span>${day}</span>${records.length ? `<strong>${stats.sets}</strong><small>组</small>` : ""}`;
    root.appendChild(cell);
  }
}

const REP_PR_TARGETS = [1, 3, 5, 8, 10, 12];

function repPrsForExercise(exerciseId) {
  const result = Object.fromEntries(REP_PR_TARGETS.map((reps) => [reps, null]));
  state.records.filter((record) => record.exerciseId === exerciseId).forEach((record) => {
    countableSets(record.sets).forEach((set) => {
      const reps = Number(set.reps) || 0;
      const weight = Number(set.weight) || 0;
      if (!REP_PR_TARGETS.includes(reps) || !weight) return;
      if (!result[reps] || weight > result[reps].weight) result[reps] = { weight, date: record.date, recordId: record.id };
    });
  });
  return result;
}

function prTimelineForExercise(exerciseId) {
  const bodyweight = isBodyweightExercise(exerciseId);
  const records = state.records
    .filter((record) => record.exerciseId === exerciseId)
    .slice()
    .sort((a, b) => `${a.date}|${a.createdAt || ""}`.localeCompare(`${b.date}|${b.createdAt || ""}`));
  const events = [];
  if (bodyweight) {
    let bestReps = 0;
    records.forEach((record) => countableSets(record.sets).forEach((set) => {
      const reps = Number(set.reps) || 0;
      if (reps > bestReps) {
        bestReps = reps;
        events.push({ date: record.date, label: "单组次数 PR", value: `${reps} 次` });
      }
    }));
  } else {
    let bestWeight = 0;
    const repBests = Object.fromEntries(REP_PR_TARGETS.map((reps) => [reps, 0]));
    records.forEach((record) => countableSets(record.sets).forEach((set) => {
      const reps = Number(set.reps) || 0;
      const weight = Number(set.weight) || 0;
      if (weight > bestWeight) {
        bestWeight = weight;
        events.push({ date: record.date, label: "最高重量 PR", value: `${formatNumber(weight, 1)} kg` });
      }
      if (REP_PR_TARGETS.includes(reps) && weight > repBests[reps]) {
        repBests[reps] = weight;
        events.push({ date: record.date, label: `${reps}RM PR`, value: `${formatNumber(weight, 1)} kg` });
      }
    }));
  }
  return events.reverse().slice(0, 14);
}

function renderRepPrs(exerciseId) {
  const root = $("#repPrGrid");
  const timeline = $("#prTimeline");
  if (!root || !timeline) return;
  const bodyweight = isBodyweightExercise(exerciseId);
  if (bodyweight) {
    const records = state.records.filter((record) => record.exerciseId === exerciseId);
    $("#repPrTitle").textContent = "自重次数 PR";
    $("#repPrHint").textContent = "按单组与单日次数记录";
    const bestSet = bestSetRepsForRecords(records);
    const bestDay = bestDailyRepsForRecords(records);
    const totalSessions = new Set(records.map((record) => record.date)).size;
    const totalReps = aggregateRecords(records).reps;
    root.innerHTML = `
      <article><span>单组最多</span><strong>${bestSet}</strong><small>次</small></article>
      <article><span>单日最多</span><strong>${bestDay}</strong><small>次</small></article>
      <article><span>训练天数</span><strong>${totalSessions}</strong><small>天</small></article>
      <article><span>累计次数</span><strong>${formatNumber(totalReps)}</strong><small>次</small></article>`;
  } else {
    $("#repPrTitle").textContent = "1 / 3 / 5 / 8 / 10 / 12RM PR";
    $("#repPrHint").textContent = "精确次数下的历史最高重量";
    const prs = repPrsForExercise(exerciseId);
    root.innerHTML = REP_PR_TARGETS.map((reps) => {
      const pr = prs[reps];
      return `<article><span>${reps}RM</span><strong>${pr ? formatNumber(pr.weight, 1) : "—"}</strong><small>${pr ? "kg" : "暂无"}</small>${pr ? `<em>${formatDate(pr.date)}</em>` : ""}</article>`;
    }).join("");
  }
  const events = prTimelineForExercise(exerciseId);
  timeline.innerHTML = events.length
    ? events.map((event) => `<article class="pr-event"><span class="pr-dot"></span><div><strong>${event.label}</strong><small>${formatDate(event.date, true)}</small></div><b>${event.value}</b></article>`).join("")
    : '<div class="empty-state">还没有 PR 记录，继续训练后会自动形成时间线。</div>';
}

function renderProgressOverview() {
  const periods = comparisonPeriods();
  $("#progressWeekDays").textContent = periods.currentWeek.days;
  $("#progressStreakWeeks").textContent = activeWeekStreak();
  $("#progressWeekSets").textContent = periods.currentWeek.sets;
  $("#progressMonthDays").textContent = periods.currentMonth.days;
  $("#weekCompareBadge").textContent = comparisonBadge(periods.currentWeek, periods.previousWeek);
  $("#monthCompareBadge").textContent = comparisonBadge(periods.currentMonth, periods.previousMonth);
  renderComparisonBody($("#weekCompareBody"), periods.currentWeek, periods.previousWeek);
  renderComparisonBody($("#monthCompareBody"), periods.currentMonth, periods.previousMonth);
  renderMuscleProgress();
  renderTrainingCalendar();
  renderAdaptiveInsights();
}

function renderAnalytics() {
  renderProgressOverview();
  const exerciseId = $("#analyticsExercise").value;
  const exercise = exerciseById(exerciseId);
  const bodyweight = exercise?.mode === "bodyweight";
  const days = Number($("#rangeSelect").value) || 30;
  const records = recordsForExerciseInRange(exerciseId, days);
  const stats = aggregateRecords(records);

  if (bodyweight && (analyticsMetricKey === "volume" || analyticsMetricKey === "maxWeight")) analyticsMetricKey = "reps";
  const metric = ANALYTICS_METRICS[analyticsMetricKey] || ANALYTICS_METRICS.reps;

  $("#analyticsModeBadge").textContent = bodyweight ? "自重动作" : "负重动作";
  $("#analyticsModeBadge").classList.toggle("bodyweight", bodyweight);
  $$("[data-metric]").forEach((button) => {
    const unavailable = bodyweight && (button.dataset.metric === "volume" || button.dataset.metric === "maxWeight");
    button.classList.toggle("hidden", unavailable);
    button.classList.toggle("active", button.dataset.metric === analyticsMetricKey);
  });

  $("#rangeSets").textContent = formatNumber(stats.sets);
  $("#rangeReps").textContent = formatNumber(stats.reps);
  if (bodyweight) {
    $("#rangeThirdLabel").textContent = "单组最多";
    $("#rangeFourthLabel").textContent = "单日最多";
    $("#rangeVolume").textContent = `${formatNumber(bestSetRepsForRecords(records))} 次`;
    $("#rangeMaxWeight").textContent = `${formatNumber(bestDailyRepsForRecords(records))} 次`;
  } else {
    $("#rangeThirdLabel").textContent = "总容量";
    $("#rangeFourthLabel").textContent = "阶段最高重量";
    $("#rangeVolume").textContent = `${formatNumber(stats.volume)} kg`;
    $("#rangeMaxWeight").textContent = `${formatNumber(maxWeightForRecords(records), 1)} kg`;
  }
  $("#chartExerciseTitle").textContent = exercise?.name || "动作";
  $("#chartMetricLabel").textContent = `每天该动作${metric.label}`;
  $("#chartMetricBadge").textContent = metric.badge;

  renderRepPrs(exerciseId);
  renderTrendChart(records, days, analyticsMetricKey);
  renderExerciseHistory(records);
}

function renderTrendChart(records, days, metricKey) {
  const root = $("#exerciseTrendChart");
  const grouped = groupByDate(records);
  const metric = ANALYTICS_METRICS[metricKey] || ANALYTICS_METRICS.volume;
  const data = [];
  for (let i = days - 1; i >= 0; i -= 1) {
    const date = daysAgoISO(i);
    data.push({ date, value: metricValueForRecords(grouped.get(date) || [], metricKey) });
  }

  const width = 620;
  const height = 220;
  const pad = { top: 14, right: 12, bottom: 30, left: 46 };
  const plotW = width - pad.left - pad.right;
  const plotH = height - pad.top - pad.bottom;
  const maxVal = Math.max(...data.map((d) => d.value), 1);
  const x = (i) => pad.left + (data.length === 1 ? plotW / 2 : (i / (data.length - 1)) * plotW);
  const y = (v) => pad.top + plotH - (v / maxVal) * plotH;

  const points = data.map((d, i) => `${x(i)},${y(d.value)}`).join(" ");
  const areaPoints = `${pad.left},${pad.top + plotH} ${points} ${pad.left + plotW},${pad.top + plotH}`;
  const tickEvery = days <= 7 ? 1 : days <= 30 ? 5 : days <= 90 ? 15 : 60;
  const labels = data.map((d, i) => {
    if (i % tickEvery !== 0 && i !== data.length - 1) return "";
    const label = new Intl.DateTimeFormat("zh-CN", { month: "numeric", day: "numeric" }).format(dateFromISO(d.date));
    return `<text class="chart-axis-label" x="${x(i)}" y="214" text-anchor="middle">${label}</text>`;
  }).join("");

  const yTicks = [0, .5, 1].map((ratio) => {
    const yy = pad.top + plotH - ratio * plotH;
    const value = maxVal * ratio;
    return `<line class="chart-grid" x1="${pad.left}" y1="${yy}" x2="${width - pad.right}" y2="${yy}" />
      <text class="chart-axis-label" x="${pad.left - 7}" y="${yy + 3}" text-anchor="end">${formatNumber(value, metricKey === "maxWeight" ? 1 : 0)}</text>`;
  }).join("");

  const dotEvery = days <= 30 ? 1 : days <= 90 ? 3 : 14;
  const dots = data.map((d, i) => {
    if (!d.value || (i % dotEvery !== 0 && i !== data.length - 1)) return "";
    const formatted = formatNumber(d.value, metricKey === "maxWeight" ? 1 : 0);
    return `<circle class="chart-dot" cx="${x(i)}" cy="${y(d.value)}" r="3.5"><title>${formatDate(d.date)}：${formatted} ${metric.unit}</title></circle>`;
  }).join("");

  root.innerHTML = `<svg viewBox="0 0 ${width} ${height}" role="img" aria-label="每日${metric.label}折线图">
    <defs><linearGradient id="areaGradient" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#b9ff63" stop-opacity=".24"/><stop offset="1" stop-color="#b9ff63" stop-opacity="0"/></linearGradient></defs>
    ${yTicks}
    <polygon class="chart-area" points="${areaPoints}" />
    <polyline class="chart-line" points="${points}" />
    ${dots}
    ${labels}
  </svg>`;
}

function renderExerciseHistory(records) {
  const root = $("#exerciseHistory");
  const exercise = exerciseById($("#analyticsExercise").value);
  const bodyweight = exercise?.mode === "bodyweight";
  root.innerHTML = "";
  const grouped = [...groupByDate(records).entries()].sort(([a], [b]) => b.localeCompare(a));
  if (!grouped.length) {
    root.innerHTML = '<div class="empty-state">这个阶段还没有该动作的记录。</div>';
    return;
  }

  grouped.forEach(([date, dayRecords]) => {
    const sets = dayRecords.flatMap((r) => r.sets || []);
    const stats = aggregateRecords(dayRecords);
    const card = document.createElement("article");
    card.className = "history-card";

    const head = document.createElement("div");
    head.className = "history-card-head";
    const dayMaxWeight = maxWeightForRecords(dayRecords);
    const dayBestReps = bestSetRepsForRecords(dayRecords);
    head.innerHTML = bodyweight
      ? `<div><strong>${formatDate(date, true)}</strong><div class="date">${stats.sets} 组 · 单组最多 ${dayBestReps} 次</div></div><div class="total">${stats.reps} 次</div>`
      : `<div><strong>${formatDate(date, true)}</strong><div class="date">${stats.sets} 组 · 最高 ${formatNumber(dayMaxWeight, 1)} kg</div></div><div class="total">${formatNumber(stats.volume)} kg</div>`;

    const chips = document.createElement("div");
    chips.className = "set-chips";
    sets.forEach((set, index) => {
      const chip = document.createElement("span");
      chip.className = "set-chip";
      const type = SET_TYPES[set.type || "normal"]?.short || "N";
      const rpe = set.rpe ? ` · RPE ${formatNumber(set.rpe, 1)} (${rirFromRpe(set.rpe)})` : "";
      chip.textContent = bodyweight
        ? `${index + 1}. ${type} · ${formatNumber(set.reps)}次${rpe}`
        : `${index + 1}. ${type} · ${formatNumber(set.weight, 1)}kg × ${formatNumber(set.reps)}${rpe}`;
      chips.appendChild(chip);
    });

    const totals = document.createElement("div");
    totals.className = "history-totals";
    totals.innerHTML = bodyweight
      ? `<span>合计 ${stats.sets} 组</span><span>${stats.reps} 次</span><span>单组最多 ${dayBestReps} 次</span>`
      : `<span>合计 ${stats.sets} 组</span><span>${stats.reps} 次</span><span>${formatNumber(stats.volume)} kg</span><span>最高 ${formatNumber(dayMaxWeight, 1)} kg</span>`;
    card.append(head, chips, totals);
    root.appendChild(card);
  });
}

function renderHistoryPage() {
  const root = $("#historyPageList");
  root.innerHTML = "";
  const grouped = [...groupByDate(state.records).entries()].sort(([a], [b]) => b.localeCompare(a));
  const allStats = aggregateRecords(state.records);
  $("#historyDays").textContent = formatNumber(grouped.length);
  $("#historySets").textContent = formatNumber(allStats.sets);
  $("#historyReps").textContent = formatNumber(allStats.reps);

  if (!grouped.length) {
    root.innerHTML = '<div class="empty-state">暂无历史训练。</div>';
    return;
  }

  grouped.forEach(([date, records]) => {
    const dayStats = aggregateRecords(records);
    const outer = document.createElement("article");
    outer.className = "history-card history-day-card";
    const head = document.createElement("div");
    head.className = "history-card-head history-day-head";
    head.innerHTML = `<div><span class="history-date-dot"></span><strong>${formatDate(date, true)}</strong><div class="date">${records.length} 个动作</div></div><div class="total">${dayStats.sets} 组 · ${dayStats.reps} 次</div>`;
    outer.appendChild(head);

    records.forEach((record) => {
      const row = document.createElement("div");
      row.className = "list-card history-exercise-row";
      const exercise = exerciseById(record.exerciseId);
      const bodyweight = exercise?.mode === "bodyweight";
      const meta = bodyweight
        ? `${sumSets(record.sets)} 组 · ${sumReps(record.sets)} 次 · 自重`
        : `${sumSets(record.sets)} 组 · ${sumReps(record.sets)} 次 · ${formatNumber(sumVolume(record.sets))} kg`;
      row.innerHTML = `<div><strong></strong><p class="muted">${meta}${record.note ? " · 有备注" : ""}</p></div><div class="history-record-actions"><button type="button" data-history-edit="${record.id}">编辑</button><button type="button" class="danger-action" data-history-delete="${record.id}">删除</button></div>`;
      row.querySelector("strong").textContent = exercise?.name || "已删除动作";
      outer.appendChild(row);
    });

    const totals = document.createElement("div");
    totals.className = "history-totals";
    totals.innerHTML = `<span>全天 ${dayStats.sets} 组</span><span>${dayStats.reps} 次</span>${dayStats.volume ? `<span>负重容量 ${formatNumber(dayStats.volume)} kg</span>` : ""}`;
    outer.appendChild(totals);
    root.appendChild(outer);
  });
}

function renderAll() {
  renderExerciseSelects();
  renderSetRows();
  renderTemplates();
  renderWeeklyPlanRows();
  renderTodayPlan();
  renderSmartProfileSummary();
  renderProgressionSuggestion();
  renderRecoveryAdvisor();
  renderDashboard();
  renderCalories();
  renderAnalytics();
  renderHistoryPage();
  renderWorkoutDay();
  renderExercisePr();
  renderRestTimer();
}

function navigate(pageName) {
  $$(".page").forEach((page) => page.classList.toggle("active", page.dataset.page === pageName));
  $$(".nav-item").forEach((item) => item.classList.toggle("active", item.dataset.nav === pageName));
  if (pageName === "analytics") renderAnalytics();
  if (pageName === "history") renderHistoryPage();
  if (pageName === "calories") renderCalories();
  if (pageName === "dashboard") renderDashboard();
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("show");
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(() => toast.classList.remove("show"), 1800);
}

function resetDraft() {
  draftSets = [newDraftSet(), newDraftSet(), newDraftSet()];
  editingWorkoutId = null;
  $("#workoutNote").value = "";
  $("#saveWorkoutButton").textContent = "保存动作 · 继续训练";
  $("#cancelWorkoutEditButton").classList.add("hidden");
  renderSetRows();
}

function startWorkoutEdit(recordId) {
  const record = state.records.find((item) => item.id === recordId);
  if (!record) return;
  editingWorkoutId = record.id;
  $("#workoutDate").value = record.date;
  $("#exerciseSelect").value = record.exerciseId;
  $("#workoutNote").value = record.note || "";
  draftSets = (record.sets || []).map((set) => newDraftSet({
    weight: String(set.weight),
    reps: String(set.reps),
    type: set.type || "normal",
    rpe: set.rpe ?? "",
    completed: set.completed !== false,
  }));
  $("#saveWorkoutButton").textContent = "保存修改";
  $("#cancelWorkoutEditButton").classList.remove("hidden");
  updateCurrentExerciseName();
  renderSetRows();
  renderWorkoutDay();
  navigate("log");
}

function deleteWorkout(recordId) {
  state.records = state.records.filter((item) => item.id !== recordId);
  if (editingWorkoutId === recordId) resetDraft();
  saveState();
  renderAll();
  showToast("训练记录已删除");
}

function copyLastExerciseRecord() {
  const exerciseId = $("#exerciseSelect").value;
  const previous = [...state.records]
    .filter((r) => r.exerciseId === exerciseId)
    .sort((a, b) => (b.createdAt || b.date).localeCompare(a.createdAt || a.date))[0];

  if (!previous) {
    showToast("这个动作还没有上次记录");
    return;
  }
  draftSets = previous.sets.map((set) => newDraftSet({
    weight: String(set.weight),
    reps: String(set.reps),
    type: set.type || "normal",
    rpe: set.rpe ?? "",
    completed: false,
  }));
  renderSetRows();
  showToast(isBodyweightExercise(exerciseId) ? "已复制上次组数和次数" : "已复制上次组数和重量");
}

function saveWorkout() {
  const exerciseId = $("#exerciseSelect").value;
  const bodyweight = isBodyweightExercise(exerciseId);
  const validSets = draftSets
    .map((set) => ({
      weight: bodyweight ? 0 : Number(set.weight),
      reps: Number(set.reps),
      type: set.type || "normal",
      rpe: set.rpe === "" ? "" : Number(set.rpe),
      completed: Boolean(set.completed),
    }))
    .filter((set) => Number.isFinite(set.weight) && set.weight >= 0 && Number.isFinite(set.reps) && set.reps > 0);

  if (!exerciseId) {
    showToast("请先选择动作");
    return;
  }
  if (!validSets.length) {
    showToast("至少填写一组有效次数");
    return;
  }

  const now = new Date();
  const date = $("#workoutDate").value || localDateISO(now);
  const note = $("#workoutNote").value.trim();
  const beforeBest = bestStatsForExercise(exerciseId);
  const isGrouped = activeGroup?.exerciseIds?.includes(exerciseId);
  const groupMeta = isGrouped ? {
    groupId: activeGroup.id,
    groupMode: activeGroup.mode,
    groupOrder: activeGroup.exerciseIds.indexOf(exerciseId),
  } : null;

  if (isGrouped) {
    activeGroup.drafts ||= {};
    activeGroup.notes ||= {};
    activeGroup.drafts[exerciseId] = validSets.map((set) => newDraftSet(set));
    activeGroup.notes[exerciseId] = note;
  }

  let savedRecordId = editingWorkoutId || "";
  if (editingWorkoutId) {
    const record = state.records.find((item) => item.id === editingWorkoutId);
    if (record) Object.assign(record, {
      date, exerciseId, sets: validSets, note,
      groupId: groupMeta?.groupId || record.groupId || "",
      groupMode: groupMeta?.groupMode || record.groupMode || "",
      groupOrder: groupMeta?.groupOrder ?? record.groupOrder ?? null,
      updatedAt: now.toISOString(),
    });
  } else {
    const newRecordId = crypto.randomUUID?.() || `r-${Date.now()}`;
    savedRecordId = newRecordId;
    state.records.push({
      id: newRecordId,
      date,
      exerciseId,
      sets: validSets,
      note,
      groupId: groupMeta?.groupId || "",
      groupMode: groupMeta?.groupMode || "",
      groupOrder: groupMeta?.groupOrder ?? null,
      createdAt: now.toISOString(),
    });
  }

  const workSets = countableSets(validSets);
  const newMaxWeight = Math.max(0, ...workSets.map((set) => Number(set.weight) || 0));
  const new1rm = Math.max(0, ...workSets.map((set) => estimated1rm(set.weight, set.reps)));
  const newBestSetReps = Math.max(0, ...workSets.map((set) => Number(set.reps) || 0));
  const newSessionReps = sumReps(workSets);
  const isPr = !editingWorkoutId && (bodyweight
    ? newBestSetReps > beforeBest.bestSetReps || newSessionReps > beforeBest.bestSessionReps
    : newMaxWeight > beforeBest.bestWeight || new1rm > beforeBest.best1rm);

  saveState();
  const wasEditing = Boolean(editingWorkoutId);
  resetDraft();
  renderAll();
  showToast(wasEditing ? "训练修改已保存" : (isPr ? "训练已保存 · 新 PR！" : "训练已保存，可继续记录下一个动作"));
  if (!wasEditing && isGrouped && activeGroup) {
    activeGroup.savedExerciseIds ||= [];
    if (!activeGroup.savedExerciseIds.includes(exerciseId)) activeGroup.savedExerciseIds.push(exerciseId);
    const groupDone = activeGroup.exerciseIds.every((id) => activeGroup.savedExerciseIds.includes(id));
    if (groupDone) {
      activeGroup = null;
      renderGroupStatus();
      showToast(isPr ? "编组训练已完成 · 新 PR！" : "编组训练已完成");
    } else {
      advanceTrainingGroup(exerciseId, false);
    }
  } else if (!wasEditing && activeTemplateId) {
    activeTemplateIndex += 1;
    loadTemplateExercise(activeTemplateIndex);
  }
  if (!wasEditing && savedRecordId) setTimeout(() => openWorkoutFeedback(savedRecordId), 40);
}

function resetFoodDraft() {
  editingFoodId = null;
  $("#foodName").value = "";
  $("#foodCalories").value = "";
  $("#foodProtein").value = "";
  $("#foodCarbs").value = "";
  $("#foodFat").value = "";
  $("#saveFoodButton").textContent = "＋ 记入当天";
  $("#cancelFoodEditButton").classList.add("hidden");
}

function startFoodEdit(recordId) {
  const record = state.foodRecords.find((item) => item.id === recordId);
  if (!record) return;
  editingFoodId = record.id;
  $("#foodDate").value = record.date;
  $("#mealSelect").value = record.meal || "加餐";
  fillFoodDraftFromRecord(record);
  $("#saveFoodButton").textContent = "保存修改";
  $("#cancelFoodEditButton").classList.remove("hidden");
  renderCalories();
}

function saveFood() {
  const date = $("#foodDate").value || localDateISO();
  const meal = $("#mealSelect").value || "加餐";
  const calories = Math.round(Number($("#foodCalories").value) || 0);
  const protein = Math.max(0, Number($("#foodProtein").value) || 0);
  const carbs = Math.max(0, Number($("#foodCarbs").value) || 0);
  const fat = Math.max(0, Number($("#foodFat").value) || 0);
  const name = $("#foodName").value.trim() || meal;

  if (calories <= 0) {
    showToast("请输入有效热量");
    return;
  }

  if (editingFoodId) {
    const record = state.foodRecords.find((item) => item.id === editingFoodId);
    if (record) Object.assign(record, { date, meal, name, calories, protein, carbs, fat, updatedAt: new Date().toISOString() });
  } else {
    state.foodRecords.push({
      id: crypto.randomUUID?.() || `food-${Date.now()}`,
      date,
      meal,
      name,
      calories,
      protein,
      carbs,
      fat,
      createdAt: new Date().toISOString(),
    });
  }
  const wasEditing = Boolean(editingFoodId);
  saveState();
  resetFoodDraft();
  renderCalories();
  renderDashboard();
  showToast(wasEditing ? "饮食修改已保存" : "饮食已记录");
}

function exportData() {
  const payload = JSON.stringify({ ...state, exportedAt: new Date().toISOString() }, null, 2);
  const blob = new Blob([payload], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `liftlog-backup-${localDateISO()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast("备份文件已导出");
}

async function importData(file) {
  try {
    const data = JSON.parse(await file.text());
    if (!Array.isArray(data.records) || !Array.isArray(data.foodRecords) || !Array.isArray(data.exercises)) throw new Error("bad-format");
    state = {
      schemaVersion: SCHEMA_VERSION,
      settings: {
        calorieGoal: Math.max(800, Number(data.settings?.calorieGoal) || 2200),
        proteinGoal: Math.max(0, Number(data.settings?.proteinGoal) || 140),
        carbsGoal: Math.max(0, Number(data.settings?.carbsGoal) || 250),
        fatGoal: Math.max(0, Number(data.settings?.fatGoal) || 70),
        restSeconds: Math.min(600, Math.max(15, Number(data.settings?.restSeconds) || 120)),
      },
      exercises: normalizeExercises(data.exercises),
      records: data.records,
      foodRecords: normalizeFoodRecords(data.foodRecords),
      bodyRecords: normalizeBodyRecords(data.bodyRecords),
      mealPresets: normalizeMealPresets(data.mealPresets),
      templates: normalizeTemplates(data.templates),
      weeklyPlan: normalizeWeeklyPlan(data.weeklyPlan),
      trainingProfile: normalizeTrainingProfile(data.trainingProfile),
      planOverrides: normalizePlanOverrides(data.planOverrides),
    };
    saveState();
    resetDraft();
    resetFoodDraft();
    renderAll();
    showToast("备份已恢复");
  } catch {
    showToast("备份文件格式不正确");
  }
}

function slugId(name) {
  const clean = name.trim().toLowerCase().replace(/\s+/g, "-").replace(/[^\w\u4e00-\u9fff-]/g, "");
  return `${clean || "exercise"}-${Date.now().toString(36)}`;
}

function bindEvents() {
  $$("[data-nav]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.nav)));
  $$("[data-nav-target]").forEach((button) => button.addEventListener("click", () => navigate(button.dataset.navTarget)));

  $("#exerciseSelect").addEventListener("change", updateCurrentExerciseName);
  $("#exercisePickerButton").addEventListener("click", () => {
    $("#exerciseSearchInput").value = "";
    renderExercisePicker();
    $("#exercisePickerDialog").showModal();
    setTimeout(() => $("#exerciseSearchInput").focus(), 40);
  });
  $("#closeExercisePickerButton").addEventListener("click", () => $("#exercisePickerDialog").close());
  $("#exerciseSearchInput").addEventListener("input", () => renderExercisePicker());
  $("#exercisePickerList").addEventListener("click", (event) => {
    const button = event.target.closest("[data-exercise-pick]");
    if (!button) return;
    if (activeGroup?.exerciseIds?.includes($("#exerciseSelect").value)) stashCurrentGroupDraft();
    if (activeGroup?.exerciseIds?.includes(button.dataset.exercisePick)) loadGroupExercise(button.dataset.exercisePick);
    else {
      $("#exerciseSelect").value = button.dataset.exercisePick;
      updateCurrentExerciseName();
    }
    $("#exercisePickerDialog").close();
  });
  $("#pickerAddExerciseButton").addEventListener("click", () => openExerciseEditor(null, "picker"));
  $("#manageExercisesButton").addEventListener("click", () => {
    renderExerciseManager();
    $("#exerciseManagerDialog").showModal();
  });
  $("#closeExerciseManagerButton").addEventListener("click", () => $("#exerciseManagerDialog").close());
  $("#exerciseManagerList").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-exercise-manage-edit]");
    if (edit) openExerciseEditor(edit.dataset.exerciseManageEdit, "manager");
  });
  $("#managerAddExerciseButton").addEventListener("click", () => openExerciseEditor(null, "manager"));
  $("#workoutDate").addEventListener("change", renderWorkoutDay);

  $("#setRows").addEventListener("input", (event) => {
    const target = event.target;
    if (!target.dataset.field) return;
    draftSets[Number(target.dataset.index)][target.dataset.field] = target.value;
    renderFocusMetric();
  });

  $("#setRows").addEventListener("click", (event) => {
    const typeButton = event.target.closest("[data-set-type-index]");
    if (typeButton) {
      const index = Number(typeButton.dataset.setTypeIndex);
      const order = ["normal", "warmup", "drop", "failure"];
      const current = draftSets[index].type || "normal";
      draftSets[index].type = order[(order.indexOf(current) + 1) % order.length];
      renderSetRows();
      renderFocusMetric();
      return;
    }
    const completeButton = event.target.closest("[data-complete-index]");
    if (completeButton) {
      const index = Number(completeButton.dataset.completeIndex);
      const next = !draftSets[index].completed;
      draftSets[index].completed = next;
      const currentExerciseId = $("#exerciseSelect").value;
      const shouldRotateGroup = next && (draftSets[index].type || "normal") !== "warmup" && activeGroup?.exerciseIds?.includes(currentExerciseId);
      renderSetRows();
      if (next) startRestTimer(currentExerciseRestSeconds());
      if (shouldRotateGroup) advanceTrainingGroup(currentExerciseId, true);
      return;
    }
    const button = event.target.closest("[data-remove-index]");
    if (!button) return;
    const index = Number(button.dataset.removeIndex);
    if (draftSets.length === 1) draftSets[0] = newDraftSet();
    else draftSets.splice(index, 1);
    renderSetRows();
    renderFocusMetric();
  });

  $("#addSetButton").addEventListener("click", () => {
    const previous = draftSets[draftSets.length - 1] || newDraftSet();
    draftSets.push(newDraftSet({ weight: previous.weight }));
    renderSetRows();
    renderFocusMetric();
    const row = $$("#setRows .set-row").at(-1);
    row?.querySelector('input[data-field="reps"]')?.focus();
  });

  $("#copyLastButton").addEventListener("click", copyLastExerciseRecord);
  $("#focusMetricSelect").addEventListener("change", () => {
    const exercise = exerciseById($("#exerciseSelect").value);
    if (!exercise) return;
    exercise.focusMetric = $("#focusMetricSelect").value;
    saveState();
    renderFocusMetric();
  });
  $("#exerciseRestSelect").addEventListener("change", () => {
    const exercise = exerciseById($("#exerciseSelect").value);
    if (!exercise) return;
    exercise.restSeconds = Number($("#exerciseRestSelect").value) || state.settings.restSeconds;
    saveState();
    showToast(`${exercise.name} 休息设为 ${exercise.restSeconds} 秒`);
  });
  $("#groupBuilderButton").addEventListener("click", openGroupBuilder);
  $("#clearGroupButton").addEventListener("click", clearTrainingGroup);
  $("#closeGroupBuilderButton").addEventListener("click", () => $("#groupBuilderDialog").close());
  $("#applyGroupButton").addEventListener("click", applyTrainingGroup);
  $("#warmupCalculatorButton").addEventListener("click", openWarmupCalculator);
  $("#closeWarmupButton").addEventListener("click", () => $("#warmupDialog").close());
  $("#warmupWorkWeight").addEventListener("input", renderWarmupPreview);
  $("#warmupSetCount").addEventListener("change", renderWarmupPreview);
  $("#applyWarmupButton").addEventListener("click", applyWarmupPlan);
  $("#plateCalculatorButton").addEventListener("click", openPlateCalculator);
  $("#closePlateButton").addEventListener("click", () => $("#plateDialog").close());
  $("#plateTargetWeight").addEventListener("input", renderPlateResult);
  $("#barWeightSelect").addEventListener("change", () => {
    const exercise = exerciseById($("#exerciseSelect").value);
    if (exercise) {
      exercise.barWeight = Number($("#barWeightSelect").value) || 20;
      saveState();
    }
    renderPlateResult();
  });
  $("#startTemplateButton").addEventListener("click", startSelectedTemplate);
  $("#saveTemplateButton").addEventListener("click", saveDayAsTemplate);
  $("#repeatLastWorkoutButton").addEventListener("click", repeatLastWorkout);
  $("#manageTemplatesButton").addEventListener("click", () => {
    renderTemplateManager();
    $("#templateManagerDialog").showModal();
  });
  $("#closeTemplateManagerButton").addEventListener("click", () => $("#templateManagerDialog").close());
  $("#templateManagerList").addEventListener("click", (event) => {
    const start = event.target.closest("[data-template-start]");
    if (start) {
      const template = state.templates.find((item) => item.id === start.dataset.templateStart);
      if (template) {
        $("#templateManagerDialog").close();
        $("#templateSelect").value = template.id;
        beginTemplateRun(template, false);
      }
      return;
    }
    const edit = event.target.closest("[data-template-edit]");
    if (edit) return openTemplateEditor(edit.dataset.templateEdit);
    const duplicate = event.target.closest("[data-template-duplicate]");
    if (duplicate) return duplicateTemplate(duplicate.dataset.templateDuplicate);
    const remove = event.target.closest("[data-template-delete]");
    if (remove) deleteTemplate(remove.dataset.templateDelete);
  });
  $("#closeTemplateEditorButton").addEventListener("click", () => {
    $("#templateEditorDialog").close();
    editingTemplateId = null;
    templateEditDraft = null;
    renderTemplateManager();
    $("#templateManagerDialog").showModal();
  });
  $("#templateExerciseEditor").addEventListener("input", (event) => {
    if (!templateEditDraft) return;
    const noteIndex = event.target.dataset.templateNoteIndex;
    if (noteIndex != null) {
      templateEditDraft.exercises[Number(noteIndex)].note = event.target.value;
      return;
    }
    const field = event.target.dataset.templateSetField;
    if (!field) return;
    const exerciseIndex = Number(event.target.dataset.exerciseIndex);
    const setIndex = Number(event.target.dataset.setIndex);
    const set = templateEditDraft.exercises[exerciseIndex]?.sets?.[setIndex];
    if (!set) return;
    if (field === "type") set.type = event.target.value;
    else if (field === "rpe") set.rpe = event.target.value === "" ? "" : Number(event.target.value);
    else set[field] = Number(event.target.value) || 0;
  });
  $("#templateExerciseEditor").addEventListener("change", (event) => {
    const field = event.target.dataset.templateSetField;
    if (field === "type") {
      const exerciseIndex = Number(event.target.dataset.exerciseIndex);
      const setIndex = Number(event.target.dataset.setIndex);
      const set = templateEditDraft?.exercises?.[exerciseIndex]?.sets?.[setIndex];
      if (set) set.type = event.target.value;
    }
  });
  $("#templateExerciseEditor").addEventListener("click", (event) => {
    const up = event.target.closest("[data-template-move-up]");
    if (up) return moveTemplateExercise(Number(up.dataset.templateMoveUp), -1);
    const down = event.target.closest("[data-template-move-down]");
    if (down) return moveTemplateExercise(Number(down.dataset.templateMoveDown), 1);
    const removeExercise = event.target.closest("[data-template-exercise-remove]");
    if (removeExercise && templateEditDraft) {
      templateEditDraft.exercises.splice(Number(removeExercise.dataset.templateExerciseRemove), 1);
      renderTemplateEditor();
      return;
    }
    const addSet = event.target.closest("[data-template-set-add]");
    if (addSet && templateEditDraft) {
      const index = Number(addSet.dataset.templateSetAdd);
      const item = templateEditDraft.exercises[index];
      const previous = item.sets?.at(-1) || { weight: 0, reps: 10, type: "normal", rpe: "" };
      item.sets ||= [];
      item.sets.push({ weight: Number(previous.weight) || 0, reps: Number(previous.reps) || 10, type: "normal", rpe: "" });
      renderTemplateEditor();
      return;
    }
    const removeSet = event.target.closest("[data-template-set-remove]");
    if (removeSet && templateEditDraft) {
      const [exerciseIndex, setIndex] = removeSet.dataset.templateSetRemove.split(":").map(Number);
      templateEditDraft.exercises[exerciseIndex]?.sets?.splice(setIndex, 1);
      renderTemplateEditor();
    }
  });
  $("#addCurrentExerciseToTemplateButton").addEventListener("click", addCurrentExerciseToTemplate);
  $("#saveTemplateEditsButton").addEventListener("click", saveTemplateEdits);
  $("#weeklyPlanButton").addEventListener("click", () => {
    renderWeeklyPlanRows();
    $("#weeklyPlanDialog").showModal();
  });
  $("#weeklyPlanRows").addEventListener("change", (event) => {
    const toggle = event.target.closest("[data-weekly-enabled]");
    if (!toggle) return;
    const dayIndex = toggle.dataset.weeklyEnabled;
    const detail = $(`[data-weekly-detail="${dayIndex}"]`);
    const row = toggle.closest(".weekly-plan-row");
    detail?.classList.toggle("hidden", !toggle.checked);
    row?.classList.toggle("training-day", toggle.checked);
    row?.classList.toggle("rest-day", !toggle.checked);
    const label = toggle.closest(".weekly-day-toggle")?.querySelector("span");
    if (label) label.textContent = toggle.checked ? "训练" : "休息";
  });
  $("#closeWeeklyPlanButton").addEventListener("click", () => $("#weeklyPlanDialog").close());
  $("#saveWeeklyPlanButton").addEventListener("click", saveWeeklyPlan);
  $("#startTodayPlanButton").addEventListener("click", startTodayPlan);
  $("#smartPlanButton").addEventListener("click", openSmartPlanDialog);
  $("#closeSmartPlanButton").addEventListener("click", () => $("#smartPlanDialog").close());
  $("#saveTrainingProfileButton").addEventListener("click", saveTrainingProfileOnly);
  $("#generateWeeklyPlanButton").addEventListener("click", generateSmartWeeklyPlan);
  $("#workoutCreatorButton").addEventListener("click", openWorkoutCreator);
  $("#recoveryWorkoutButton").addEventListener("click", startRecoveryWorkout);
  $("#adaptivePlanButton").addEventListener("click", openAdaptivePlanDialog);
  $("#closeAdaptivePlanButton").addEventListener("click", () => $("#adaptivePlanDialog").close());
  $("#applyAdaptivePlanButton").addEventListener("click", applyAdaptivePlan);
  $("#clearAdaptivePlanButton").addEventListener("click", clearAdaptivePlan);
  $("#closeWorkoutCreatorButton").addEventListener("click", () => $("#workoutCreatorDialog").close());
  $("#creatorTargetInput").addEventListener("change", rebuildCreatorPreview);
  $("#creatorMinutesInput").addEventListener("change", rebuildCreatorPreview);
  $("#startCreatedWorkoutButton").addEventListener("click", startCreatedWorkout);
  $("#saveCreatedWorkoutButton").addEventListener("click", saveCreatedWorkout);
  $("#closeWorkoutFeedbackButton").addEventListener("click", () => { pendingFeedbackRecordId = null; $("#workoutFeedbackDialog").close(); });
  $("#workoutFeedbackDialog").addEventListener("click", (event) => {
    const button = event.target.closest("[data-workout-feedback]");
    if (button) saveWorkoutFeedback(button.dataset.workoutFeedback);
  });
  $("#restMinusButton").addEventListener("click", () => adjustRestTimer(-15));
  $("#restPlusButton").addEventListener("click", () => adjustRestTimer(15));
  $("#restSkipButton").addEventListener("click", () => stopRestTimer(false));
  $("#saveWorkoutButton").addEventListener("click", saveWorkout);
  $("#cancelWorkoutEditButton").addEventListener("click", () => {
    resetDraft();
    renderWorkoutDay();
    showToast("已取消编辑");
  });
  $("#recentExercises").addEventListener("click", (event) => {
    const card = event.target.closest("[data-recent-edit]");
    if (card) startWorkoutEdit(card.dataset.recentEdit);
  });
  $("#workoutDayList").addEventListener("click", (event) => {
    const feedback = event.target.closest("[data-workout-feedback-edit]");
    if (feedback) return openWorkoutFeedback(feedback.dataset.workoutFeedbackEdit);
    const edit = event.target.closest("[data-workout-edit]");
    if (edit) return startWorkoutEdit(edit.dataset.workoutEdit);
    const remove = event.target.closest("[data-workout-delete]");
    if (remove && window.confirm("确定删除这条训练记录吗？")) deleteWorkout(remove.dataset.workoutDelete);
  });

  $("#foodDate").addEventListener("change", renderCalories);
  $("#mealQuickSelect").addEventListener("click", (event) => {
    const button = event.target.closest("[data-meal-quick]");
    if (!button) return;
    $("#mealSelect").value = button.dataset.mealQuick;
    renderCalories();
    $("#foodName").focus();
  });
  $("#saveFoodButton").addEventListener("click", saveFood);
  $("#copyPreviousDayFoodButton").addEventListener("click", copyPreviousDayFood);
  $("#saveMealPresetButton").addEventListener("click", saveCurrentMealPreset);
  $("#frequentFoods").addEventListener("click", (event) => {
    const button = event.target.closest("[data-frequent-food]");
    if (!button) return;
    const item = frequentFoodStats()[Number(button.dataset.frequentFood)];
    if (!item) return;
    fillFoodDraftFromRecord(item.record);
    $("#foodName").focus();
  });
  $("#mealPresets").addEventListener("click", (event) => {
    const remove = event.target.closest("[data-meal-preset-delete]");
    if (remove) {
      const preset = state.mealPresets.find((item) => item.id === remove.dataset.mealPresetDelete);
      if (!preset || !window.confirm(`删除常用餐“${preset.name}”吗？`)) return;
      state.mealPresets = state.mealPresets.filter((item) => item.id !== preset.id);
      saveState();
      renderNutritionShortcuts();
      return showToast("常用餐已删除");
    }
    const button = event.target.closest("[data-meal-preset]");
    if (button) addMealPresetToDay(button.dataset.mealPreset);
  });
  $("#foodEntries").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-food-edit]");
    if (edit) return startFoodEdit(edit.dataset.foodEdit);
    const button = event.target.closest("[data-food-delete]");
    if (!button) return;
    if (!window.confirm("确定删除这条饮食记录吗？")) return;
    state.foodRecords = state.foodRecords.filter((record) => record.id !== button.dataset.foodDelete);
    if (editingFoodId === button.dataset.foodDelete) resetFoodDraft();
    saveState();
    renderCalories();
    renderDashboard();
    showToast("饮食记录已删除");
  });
  $("#cancelFoodEditButton").addEventListener("click", () => {
    resetFoodDraft();
    showToast("已取消编辑");
  });
  $("#foodWeek").addEventListener("click", (event) => {
    const day = event.target.closest("[data-food-day]");
    if (!day) return;
    $("#foodDate").value = day.dataset.foodDay;
    resetFoodDraft();
    renderCalories();
    window.scrollTo({ top: 0, behavior: "smooth" });
  });
  $$("[data-nutrition-range]").forEach((button) => button.addEventListener("click", () => {
    nutritionRangeDays = Number(button.dataset.nutritionRange) === 30 ? 30 : 7;
    $$("[data-nutrition-range]").forEach((item) => item.classList.toggle("active", item === button));
    renderNutritionTrend();
  }));
  $("#saveBodyRecordButton").addEventListener("click", saveBodyRecord);
  $("#bodyRecordList").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-body-edit]");
    if (edit) {
      const record = state.bodyRecords.find((item) => item.date === edit.dataset.bodyEdit);
      if (!record) return;
      editingBodyDate = record.date;
      $("#bodyDate").value = record.date;
      $("#bodyWeight").value = record.weight || "";
      $("#bodyFat").value = record.bodyFat || "";
      $("#saveBodyRecordButton").textContent = "更新身体记录";
      return;
    }
    const remove = event.target.closest("[data-body-delete]");
    if (!remove || !window.confirm("确定删除这天的身体记录吗？")) return;
    state.bodyRecords = state.bodyRecords.filter((record) => record.date !== remove.dataset.bodyDelete);
    saveState();
    renderBodyTracking();
    showToast("身体记录已删除");
  });

  $("#historyPageList").addEventListener("click", (event) => {
    const edit = event.target.closest("[data-history-edit]");
    if (edit) return startWorkoutEdit(edit.dataset.historyEdit);
    const remove = event.target.closest("[data-history-delete]");
    if (remove && window.confirm("确定删除这条训练记录吗？")) deleteWorkout(remove.dataset.historyDelete);
  });

  $("#analyticsExercise").addEventListener("change", renderAnalytics);
  $("#rangeSelect").addEventListener("change", renderAnalytics);
  $("#calendarPrevButton").addEventListener("click", () => {
    calendarMonthOffset -= 1;
    renderTrainingCalendar();
  });
  $("#calendarNextButton").addEventListener("click", () => {
    calendarMonthOffset += 1;
    renderTrainingCalendar();
  });
  $("#calendarTodayButton").addEventListener("click", () => {
    calendarMonthOffset = 0;
    renderTrainingCalendar();
  });
  $("#metricSwitch").addEventListener("click", (event) => {
    const button = event.target.closest("[data-metric]");
    if (!button || !ANALYTICS_METRICS[button.dataset.metric]) return;
    analyticsMetricKey = button.dataset.metric;
    renderAnalytics();
  });

  $("#exerciseDialog").addEventListener("close", () => {
    if (exerciseEditorOrigin === "manager" && !$("#exerciseManagerDialog").open) {
      renderExerciseManager();
      $("#exerciseManagerDialog").showModal();
    }
    exerciseEditorOrigin = "training";
  });

  $("#exerciseModeInput").addEventListener("change", () => {
    const bodyweight = $("#exerciseModeInput").value === "bodyweight";
    $("#exerciseEquipmentInput").disabled = bodyweight;
    if (bodyweight) $("#exerciseEquipmentInput").value = "bodyweight";
  });

  $("#exerciseForm").addEventListener("submit", (event) => {
    const submitterValue = event.submitter?.value;
    if (submitterValue === "cancel") {
      editingExerciseId = null;
      return;
    }
    event.preventDefault();
    const name = $("#exerciseNameInput").value.trim();
    if (!name) return;
    const duplicate = state.exercises.find((exercise) => exercise.id !== editingExerciseId && exercise.name.toLowerCase() === name.toLowerCase());
    if (duplicate) {
      showToast("已经有同名动作");
      return;
    }
    const mode = $("#exerciseModeInput").value === "bodyweight" ? "bodyweight" : "weighted";
    const primaryMuscle = MUSCLE_GROUPS.includes($("#exerciseMuscleInput").value) ? $("#exerciseMuscleInput").value : "其他";
    const equipment = mode === "bodyweight" ? "bodyweight" : (EQUIPMENT_TYPES.includes($("#exerciseEquipmentInput").value) ? $("#exerciseEquipmentInput").value : "other");
    let exercise;
    if (editingExerciseId) {
      exercise = exerciseById(editingExerciseId);
      if (!exercise) return;
      exercise.name = name;
      exercise.mode = mode;
      exercise.primaryMuscle = primaryMuscle;
      exercise.equipment = equipment;
      if (!validFocusMetrics(exercise.id).includes(exercise.focusMetric)) exercise.focusMetric = mode === "bodyweight" ? "reps" : "volume";
    } else {
      exercise = {
        id: slugId(name), name, mode, primaryMuscle, equipment,
        restSeconds: null,
        focusMetric: mode === "bodyweight" ? "reps" : "volume",
        barWeight: 20,
      };
      state.exercises.push(exercise);
    }
    const wasEditing = Boolean(editingExerciseId);
    editingExerciseId = null;
    saveState();
    renderExerciseSelects();
    $("#exerciseSelect").value = exercise.id;
    updateCurrentExerciseName();
    $("#exerciseDialog").close();
    renderExercisePicker();
    renderExerciseManager();
    renderAnalytics();
    showToast(wasEditing ? "动作已更新" : "动作已添加");
  });

  $("#settingsButton").addEventListener("click", () => {
    $("#calorieGoalInput").value = state.settings.calorieGoal;
    $("#proteinGoalInput").value = state.settings.proteinGoal;
    $("#carbsGoalInput").value = state.settings.carbsGoal;
    $("#fatGoalInput").value = state.settings.fatGoal;
    $("#restSecondsInput").value = state.settings.restSeconds;
    $("#settingsDialog").showModal();
  });

  $("#exportDataButton").addEventListener("click", exportData);
  $("#importDataInput").addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (file) await importData(file);
    event.target.value = "";
  });

  $("#settingsForm").addEventListener("submit", (event) => {
    const submitterValue = event.submitter?.value;
    if (submitterValue === "cancel") return;
    event.preventDefault();
    state.settings.calorieGoal = Math.max(800, Number($("#calorieGoalInput").value) || 2200);
    state.settings.proteinGoal = Math.max(0, Number($("#proteinGoalInput").value) || 0);
    state.settings.carbsGoal = Math.max(0, Number($("#carbsGoalInput").value) || 0);
    state.settings.fatGoal = Math.max(0, Number($("#fatGoalInput").value) || 0);
    state.settings.restSeconds = Math.min(600, Math.max(15, Number($("#restSecondsInput").value) || 120));
    saveState();
    $("#settingsDialog").close();
    renderAll();
    showToast("设置已保存");
  });
}

$("#foodDate").value = localDateISO();
$("#bodyDate").value = localDateISO();
$("#workoutDate").value = localDateISO();
bindEvents();
renderAll();

if ('serviceWorker' in navigator && window.isSecureContext) {
  navigator.serviceWorker.register('./service-worker.js').catch(() => {});
}

const state = {
  counters: Object.create(null),
  gauges: Object.create(null),
  events: [],
  lastUpdatedAt: null
};

const incrementCounter = (name, value = 1) => {
  state.counters[name] = (state.counters[name] || 0) + value;
  state.lastUpdatedAt = new Date().toISOString();
};

const setGauge = (name, value) => {
  state.gauges[name] = value;
  state.lastUpdatedAt = new Date().toISOString();
};

const recordEvent = (type, timestamp = new Date()) => {
  state.events.push({
    type,
    timestamp: new Date(timestamp).toISOString()
  });

  const cutoff = Date.now() - 60 * 60 * 1000;
  state.events = state.events.filter((event) => Date.parse(event.timestamp) >= cutoff);
  state.lastUpdatedAt = new Date().toISOString();
};

const getThroughputPerMinute = () => {
  const cutoff = Date.now() - 60 * 1000;
  return state.events.filter((event) => Date.parse(event.timestamp) >= cutoff && event.type === 'sent').length;
};

const snapshot = () => ({
  counters: { ...state.counters },
  gauges: { ...state.gauges },
  throughputPerMinute: getThroughputPerMinute(),
  lastUpdatedAt: state.lastUpdatedAt
});

module.exports = {
  incrementCounter,
  setGauge,
  recordEvent,
  getThroughputPerMinute,
  snapshot
};

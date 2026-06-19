let Bottleneck;

try {
  Bottleneck = require('bottleneck');
} catch (error) {
  Bottleneck = null;
}

const createLimiter = () => {
  if (Bottleneck) {
    return new Bottleneck({
      maxConcurrent: 3,
      minTime: 1000
    });
  }

  let active = 0;
  let lastRun = 0;
  const queue = [];

  const drain = () => {
    if (active >= 3 || queue.length === 0) return;
    const now = Date.now();
    const wait = Math.max(0, 1000 - (now - lastRun));
    if (wait > 0) {
      setTimeout(drain, wait);
      return;
    }

    const next = queue.shift();
    if (!next) return;
    active += 1;
    lastRun = Date.now();
    Promise.resolve()
      .then(next.task)
      .then(next.resolve)
      .catch(next.reject)
      .finally(() => {
        active -= 1;
        drain();
      });
  };

  return {
    schedule(task) {
      return new Promise((resolve, reject) => {
        queue.push({ task, resolve, reject });
        drain();
      });
    }
  };
};

module.exports = {
  createLimiter
};

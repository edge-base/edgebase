function locksAvailable(job, heldLocks) {
  return job.locks.every((lock) => !heldLocks.has(lock));
}

function failedDependency(job, results) {
  return job.needs.find((dependency) => {
    const state = results.get(dependency)?.state;
    return state === 'failed' || state === 'blocked';
  });
}

export async function runWeightedJobs(jobs, options) {
  const { execute, maxJobs, maxWeight, onEvent = () => {} } = options;
  const byId = new Map(jobs.map((job) => [job.id, job]));
  if (byId.size !== jobs.length) throw new Error('Local CI job IDs must be unique.');

  for (const job of jobs) {
    for (const dependency of job.needs) {
      if (!byId.has(dependency)) {
        throw new Error(`${job.id} depends on unknown job ${dependency}.`);
      }
    }
    if (job.weight > maxWeight) {
      throw new Error(`${job.id} weight ${job.weight} exceeds capacity ${maxWeight}.`);
    }
  }

  const pending = new Set(jobs.map((job) => job.id));
  const running = new Map();
  const results = new Map();
  const heldLocks = new Set();
  let runningWeight = 0;

  while (pending.size > 0 || running.size > 0) {
    let changed = false;

    for (const id of [...pending]) {
      const job = byId.get(id);
      const dependency = failedDependency(job, results);
      if (!dependency) continue;
      pending.delete(id);
      results.set(id, { state: 'blocked', dependency });
      onEvent({ type: 'blocked', job, dependency });
      changed = true;
    }

    const ready = [...pending]
      .map((id) => byId.get(id))
      .filter((job) =>
        job.needs.every((dependency) => results.get(dependency)?.state === 'success'),
      )
      .sort((left, right) => right.weight - left.weight || left.id.localeCompare(right.id));

    for (const job of ready) {
      if (running.size >= maxJobs) break;
      if (runningWeight + job.weight > maxWeight) continue;
      if (!locksAvailable(job, heldLocks)) continue;

      pending.delete(job.id);
      runningWeight += job.weight;
      for (const lock of job.locks) heldLocks.add(lock);
      onEvent({ type: 'start', job });

      const promise = Promise.resolve()
        .then(() => execute(job))
        .then(
          (value) => ({ state: 'success', value }),
          (error) => ({ state: 'failed', error }),
        )
        .then((result) => ({ job, result }));
      running.set(job.id, promise);
      changed = true;
    }

    if (running.size === 0) {
      if (pending.size === 0) break;
      const ids = [...pending].join(', ');
      throw new Error(`Local CI dependency cycle or unschedulable jobs: ${ids}`);
    }

    if (!changed || running.size >= maxJobs || runningWeight >= maxWeight || ready.length === 0) {
      const { job, result } = await Promise.race(running.values());
      running.delete(job.id);
      runningWeight -= job.weight;
      for (const lock of job.locks) heldLocks.delete(lock);
      results.set(job.id, result);
      onEvent({ type: result.state, job, ...result });
    }
  }

  return results;
}

export type JobParentLinkRow = {
  id: string
  parent_job_id: string | null
}

export function getJobGroupRootId(
  jobId: string,
  parentByJobId: Map<string, string | null>,
  knownJobIds?: Set<string>
) {
  const parentJobId = parentByJobId.get(jobId) ?? null

  if (!parentJobId) return jobId
  if (knownJobIds && !knownJobIds.has(parentJobId)) return jobId

  return parentJobId
}

export function buildJobGroups<T extends JobParentLinkRow>(jobs: T[]) {
  const jobsById = new Map(jobs.map((job) => [job.id, job]))
  const knownJobIds = new Set(jobsById.keys())
  const parentByJobId = new Map(jobs.map((job) => [job.id, job.parent_job_id ?? null]))
  const groups = new Map<string, T[]>()

  for (const job of jobs) {
    const rootId = getJobGroupRootId(job.id, parentByJobId, knownJobIds)
    const current = groups.get(rootId) ?? []
    current.push(job)
    groups.set(rootId, current)
  }

  return {
    jobsById,
    parentByJobId,
    groups,
  }
}

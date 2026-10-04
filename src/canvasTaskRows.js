const RUN_STATUS = { running: '运行中', waiting: '等待确认', done: '已完成', failed: '失败', stopped: '已停止' };
const JOB_STATUS = { running: '运行中', done: '已完成', failed: '失败', stopped: '已停止' };

export function buildCanvasTaskRows(jobs = [], runs = [], agents = [], canvasRuns = []) {
  const agentNames = new Map(agents.map((agent) => [agent.id, agent.name]));
  const jobRows = jobs.map((job) => {
    const total = Number(job.total) || 0;
    const done = Number(job.done) || 0;
    const failed = Number(job.failed) || 0;
    return {
      id: `job:${job.id}`,
      source: 'job',
      title: ({ 'shot.image': '分镜生图', 'shot.video': '分镜视频', 'movie.export': '成片导出' })[job.kind] || job.kind || '生成任务',
      subtitle: `${done + failed}/${total} 项${failed ? ` · 失败 ${failed}` : ''}`,
      status: job.status === 'done' && failed > 0 ? '部分失败' : (JOB_STATUS[job.status] || job.status || '未知状态'),
      progress: total ? Math.min(100, Math.round(((done + failed) / total) * 100)) : 0,
      updatedAt: job.update_time || job.create_time || '',
      error: job.error || job.log?.find((item) => !item.ok)?.error || '',
    };
  });
  const runRows = runs.map((run) => ({
    id: `agent:${run.id}`,
    source: 'agent',
    runId: run.id,
    scriptId: run.script_id,
    title: run.goal || 'Agent 创作任务',
    subtitle: agentNames.get(run.agent_id) || 'Agent',
    status: RUN_STATUS[run.status] || run.status || '未知状态',
    progress: null,
    updatedAt: run.update_time || run.create_time || '',
    error: run.error || '',
  }));
  const canvasRows = canvasRuns.map((run) => ({
    id: `canvas:${run.id}`,
    source: 'canvas',
    canvasId: run.canvas_id,
    title: '画布执行',
    subtitle: run.canvas_title || '未命名画布',
    status: ({ running: '运行中', success: '已完成', partial: '部分失败', failed: '失败' })[run.status]
      || run.status || '未知状态',
    progress: null,
    updatedAt: run.create_time || '',
    error: run.error || '',
  }));
  return [...jobRows, ...runRows, ...canvasRows]
    .sort((a, b) => String(b.updatedAt).localeCompare(String(a.updatedAt)));
}

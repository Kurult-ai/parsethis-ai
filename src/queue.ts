import { Queue, type JobsOptions } from "bullmq";
import { getRedis } from "./redis.js";

export interface EvaluationJobData {
  evaluationId: string;
  apiKeyId: string;
  prompt: string;
  model: string;
  variables: Record<string, string> | null;
  testCases: Array<{ input: string; expected?: string | null }>;
  evaluators: string[];
  config: {
    temperature: number;
    max_tokens: number;
    timeout_seconds: number;
    num_runs: number;
  };
  tier: string;
}

const TIER_PRIORITY: Record<string, number> = {
  enterprise: 1,
  team: 2,
  pro: 3,
  free: 4,
};

let evaluationQueue: Queue<EvaluationJobData> | null = null;

export function getEvaluationQueue(): Queue<EvaluationJobData> {
  if (!evaluationQueue) {
    evaluationQueue = new Queue<EvaluationJobData>("evaluation", {
      connection: getRedis() as any,
      defaultJobOptions: {
        attempts: 3,
        backoff: { type: "exponential", delay: 1000 },
        removeOnComplete: { age: 86400 },
        removeOnFail: { age: 604800 },
      },
    });
  }
  return evaluationQueue!;
}

export async function addEvaluationJob(data: EvaluationJobData): Promise<string> {
  const queue = getEvaluationQueue();
  const priority = TIER_PRIORITY[data.tier] ?? 4;

  const opts: JobsOptions = {
    jobId: data.evaluationId,
    priority,
  };

  const job = await queue.add("evaluate", data, opts);
  return job.id!;
}

export async function getEvaluationJob(jobId: string) {
  const queue = getEvaluationQueue();
  return queue.getJob(jobId);
}

export async function closeQueue(): Promise<void> {
  if (evaluationQueue) {
    await evaluationQueue.close();
    evaluationQueue = null;
  }
}

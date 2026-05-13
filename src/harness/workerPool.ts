import type { WorkerAssignment, WorkerResult } from "./types.js";

export class WorkerPool {
  private assignments = new Map<string, WorkerAssignment>();
  private results = new Map<string, WorkerResult>();

  register(assignments: WorkerAssignment[]): WorkerAssignment[] {
    for (const assignment of assignments) {
      this.assignments.set(assignment.workerId, { ...assignment, status: "queued" });
    }
    return this.snapshotAssignments();
  }

  markRunning(workerId: string): void {
    this.updateStatus(workerId, "running");
  }

  complete(workerId: string, result: Omit<WorkerResult, "workerId" | "status">): void {
    this.updateStatus(workerId, "completed");
    this.results.set(workerId, {
      workerId,
      status: "completed",
      ...result,
    });
  }

  fail(workerId: string, summary: string, findings: string[] = []): void {
    this.updateStatus(workerId, "failed");
    this.results.set(workerId, {
      workerId,
      status: "failed",
      summary,
      changedFiles: [],
      findings,
      risks: [],
      nextActions: [],
      verification: {
        checksRun: [],
        checksPending: [],
      },
    });
  }

  snapshotAssignments(): WorkerAssignment[] {
    return [...this.assignments.values()].map((assignment) => ({ ...assignment }));
  }

  snapshotResults(): WorkerResult[] {
    return [...this.results.values()].map((result) => ({
      ...result,
      changedFiles: [...result.changedFiles],
      findings: [...result.findings],
      risks: [...result.risks],
      nextActions: [...result.nextActions],
      verification: {
        checksRun: [...result.verification.checksRun],
        checksPending: [...result.verification.checksPending],
      },
    }));
  }

  private updateStatus(workerId: string, status: WorkerAssignment["status"]): void {
    const assignment = this.assignments.get(workerId);
    if (!assignment) return;
    this.assignments.set(workerId, { ...assignment, status });
  }
}

export function summarizeWorkerAssignment(assignment: WorkerAssignment): Omit<WorkerResult, "workerId" | "status"> {
  return {
    summary: `${assignment.role} scope registered`,
    changedFiles: [],
    findings: [],
    risks: [],
    nextActions: [],
    verification: {
      checksRun: ["assignment-registered"],
      checksPending: [],
    },
  };
}

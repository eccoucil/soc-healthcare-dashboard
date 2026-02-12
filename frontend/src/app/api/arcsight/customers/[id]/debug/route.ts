import {
  getCustomerPathsToRoot,
  getGroupChildren,
  getConnectorsByIds,
  getConnectorDevices,
} from "@/lib/arcsight-client";

type StepResult =
  | { status: "ok"; data: unknown; durationMs: number }
  | { status: "error"; error: string; durationMs: number }
  | { status: "skipped"; reason: string };

async function runStep<T>(
  fn: () => Promise<T>
): Promise<{ status: "ok"; data: T; durationMs: number } | { status: "error"; error: string; durationMs: number }> {
  const start = Date.now();
  try {
    const data = await fn();
    return { status: "ok", data, durationMs: Date.now() - start };
  } catch (err) {
    return {
      status: "error",
      error: err instanceof Error ? err.message : String(err),
      durationMs: Date.now() - start,
    };
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: customerId } = await params;

  const report: Record<string, StepResult> & { customerId: string } = {
    customerId,
  } as never;

  // Step 1: Get paths to root
  const step1 = await runStep(() => getCustomerPathsToRoot(customerId));
  report.step1_pathsToRoot = step1;

  if (step1.status !== "ok" || (step1.data as string[]).length === 0) {
    report.step2_groupChildren = {
      status: "skipped",
      reason:
        step1.status === "error"
          ? "step 1 failed"
          : "customer has no parent group — no connectors possible",
    };
    report.step3_connectors = { status: "skipped", reason: "step 2 skipped" };
    report.step4_devices = { status: "skipped", reason: "step 2 skipped" };
    return Response.json(report, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  // Step 2: Get group children
  const parentGroupId = (step1.data as string[])[0];
  const step2 = await runStep(() => getGroupChildren(parentGroupId));
  report.step2_groupChildren = step2;

  if (step2.status !== "ok" || (step2.data as string[]).length === 0) {
    report.step3_connectors = {
      status: "skipped",
      reason:
        step2.status === "error"
          ? "step 2 failed"
          : "group has no children — no connectors",
    };
    report.step4_devices = { status: "skipped", reason: "step 3 skipped" };
    return Response.json(report, {
      headers: { "Cache-Control": "no-store" },
    });
  }

  const childIds = step2.data as string[];

  // Step 3: Fetch connector details
  const step3 = await runStep(() => getConnectorsByIds(childIds));
  report.step3_connectors = step3;

  // Step 4: Fetch device map (independent of step 3)
  const step4 = await runStep(() => getConnectorDevices());
  report.step4_devices =
    step4.status === "ok"
      ? {
          status: "ok",
          data: { totalDeviceMappings: Object.keys(step4.data as object).length },
          durationMs: step4.durationMs,
        }
      : step4;

  return Response.json(report, {
    headers: { "Cache-Control": "no-store" },
  });
}

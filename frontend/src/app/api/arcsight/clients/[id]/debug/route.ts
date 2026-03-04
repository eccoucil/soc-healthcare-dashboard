import {
  getClientPathsToRoot,
  getGroupChildren,
  getConnectorsByIds,
  getConnectorDevices,
} from "@/lib/arcsight-client";
import { withAuthRetry, AuthError } from "@/lib/session";

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
  try {
    const { id: clientId } = await params;

    const { data: report, cookieHeader } = await withAuthRetry(async (auth) => {
      const result: Record<string, StepResult> & { clientId: string } = {
        clientId,
      } as never;

      // Step 1: Get paths to root
      const step1 = await runStep(() => getClientPathsToRoot(auth, clientId));
      result.step1_pathsToRoot = step1;

      if (step1.status !== "ok" || (step1.data as string[]).length === 0) {
        result.step2_groupChildren = {
          status: "skipped",
          reason:
            step1.status === "error"
              ? "step 1 failed"
              : "client has no parent group — no connectors possible",
        };
        result.step3_connectors = { status: "skipped", reason: "step 2 skipped" };
        result.step4_devices = { status: "skipped", reason: "step 2 skipped" };
        return result;
      }

      // Step 2: Get group children — path is slash-delimited "root/.../parent/client"
      const segments = ((step1.data as string[])[0]).split("/");
      if (segments.length < 2) {
        result.step2_groupChildren = { status: "skipped", reason: "client is at root level" };
        result.step3_connectors = { status: "skipped", reason: "step 2 skipped" };
        result.step4_devices = { status: "skipped", reason: "step 2 skipped" };
        return result;
      }
      const parentGroupId = segments[segments.length - 2];
      const step2 = await runStep(() => getGroupChildren(auth, parentGroupId));
      result.step2_groupChildren = step2;

      if (step2.status !== "ok" || (step2.data as string[]).length === 0) {
        result.step3_connectors = {
          status: "skipped",
          reason:
            step2.status === "error"
              ? "step 2 failed"
              : "group has no children — no connectors",
        };
        result.step4_devices = { status: "skipped", reason: "step 3 skipped" };
        return result;
      }

      const childIds = step2.data as string[];

      // Step 3: Fetch connector details
      const step3 = await runStep(() => getConnectorsByIds(auth, childIds));
      result.step3_connectors = step3;

      // Step 4: Fetch device map (independent of step 3)
      const step4 = await runStep(() => getConnectorDevices(auth));
      result.step4_devices =
        step4.status === "ok"
          ? {
              status: "ok",
              data: { totalDeviceMappings: Object.keys(step4.data as object).length },
              durationMs: step4.durationMs,
            }
          : step4;

      return result;
    });

    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return Response.json(report, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    return Response.json(
      { error: error instanceof Error ? error.message : "Unknown error" },
      { status: 500 }
    );
  }
}

import {
  getFieldSetResource,
  updateFieldSetResource,
} from "@/lib/arcsight-query-client";
import { withAuthRetry, AuthError } from "@/lib/session";

const FIELD_SET_ID = process.env.ARCSIGHT_FIELD_SET_ID ?? "";

/** Columns to add to the FieldSet if missing. */
const COLUMNS_TO_ADD = ["agentHostName", "agentAddress"];

/**
 * GET — Inspect the current FieldSet resource structure.
 */
export async function GET() {
  try {
    const { data: result, cookieHeader } = await withAuthRetry(async (auth) => {
      const resource = await getFieldSetResource(auth, FIELD_SET_ID);

      if (!resource) {
        return {
          _notFound: true as const,
          error: "FieldSet resource not found or API not supported",
          fieldSetId: FIELD_SET_ID,
        };
      }

      // Find the column/field list property
      const columnProperty = findColumnProperty(resource);

      return {
        fieldSetId: FIELD_SET_ID,
        columnProperty: columnProperty
          ? {
              key: columnProperty.key,
              currentColumns: columnProperty.columns,
              count: columnProperty.columns.length,
            }
          : null,
        missingColumns: columnProperty
          ? COLUMNS_TO_ADD.filter(
              (c) =>
                !columnProperty.columns.some(
                  (col: string) =>
                    col.toLowerCase() === c.toLowerCase()
                )
            )
          : COLUMNS_TO_ADD,
        resource,
      };
    });

    // Handle not-found case returned from inside withAuthRetry
    if (result && typeof result === "object" && "_notFound" in result) {
      const { _notFound, ...rest } = result;
      void _notFound;
      return Response.json(rest, {
        status: 404,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[api/channels/fieldset-update] GET error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

/**
 * POST — Add agentHostName and agentAddress to the FieldSet.
 */
export async function POST() {
  try {
    const { data: result, cookieHeader } = await withAuthRetry(async (auth) => {
      // 1. Fetch current FieldSet
      const resource = await getFieldSetResource(auth, FIELD_SET_ID);
      if (!resource) {
        return {
          _status: 404 as const,
          error: "FieldSet resource not found — cannot update",
          fieldSetId: FIELD_SET_ID,
        };
      }

      // 2. Find the column list
      const columnProperty = findColumnProperty(resource);
      if (!columnProperty) {
        return {
          _status: 422 as const,
          error:
            "Could not locate column/field list in FieldSet resource. " +
            "Manual update via ACC UI may be required.",
          resourceKeys: Object.keys(resource),
          resource,
        };
      }

      // 3. Determine which columns are missing
      const existing = columnProperty.columns.map((c: string) =>
        c.toLowerCase()
      );
      const toAdd = COLUMNS_TO_ADD.filter(
        (c) => !existing.includes(c.toLowerCase())
      );

      if (toAdd.length === 0) {
        return {
          message: "All columns already present — no update needed",
          fieldSetId: FIELD_SET_ID,
          currentColumns: columnProperty.columns,
        };
      }

      // 4. Add the missing columns (append — non-destructive)
      const updatedColumns = [...columnProperty.columns, ...toAdd];
      setNestedValue(resource, columnProperty.key, updatedColumns);

      console.log(
        `[fieldset-update] Adding columns: [${toAdd.join(", ")}] to FieldSet ${FIELD_SET_ID}. ` +
          `Total columns: ${updatedColumns.length}`
      );

      // 5. Submit the update
      const updateResult = await updateFieldSetResource(auth, resource);

      if (updateResult.success) {
        return {
          message: `Successfully added columns: [${toAdd.join(", ")}]`,
          fieldSetId: FIELD_SET_ID,
          previousColumns: columnProperty.columns,
          updatedColumns,
          response: updateResult.data,
        };
      }

      return {
        _status: 422 as const,
        error: "FieldSet update failed — REST API may not support this operation",
        detail: updateResult.error,
        fieldSetId: FIELD_SET_ID,
        columnsAttempted: updatedColumns,
        fallback:
          "Update the FieldSet manually via ACC UI: " +
          "RESOURCES > Field Sets > FORTRESS > Device Monitoring — " +
          "add 'Agent Host Name' and 'Agent Address' columns",
      };
    });

    // Handle error status codes returned from inside withAuthRetry
    if (result && typeof result === "object" && "_status" in result) {
      const { _status, ...rest } = result as { _status: number } & Record<string, unknown>;
      return Response.json(rest, {
        status: _status,
        headers: { "Cache-Control": "no-store" },
      });
    }

    const headers: Record<string, string> = { "Cache-Control": "no-store" };
    if (cookieHeader) headers["Set-Cookie"] = cookieHeader;
    return Response.json(result, { headers });
  } catch (error) {
    if (error instanceof AuthError) {
      return Response.json({ error: "Not authenticated" }, { status: 401 });
    }
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[api/channels/fieldset-update] POST error:", message);
    return Response.json({ error: message }, { status: 500 });
  }
}

// --- Helpers ---

interface ColumnProperty {
  key: string;
  columns: string[];
}

/**
 * Search the resource object for the property containing the column/field list.
 * ArcSight FieldSet resources can use various property names.
 */
function findColumnProperty(
  resource: Record<string, unknown>
): ColumnProperty | null {
  // Known property names for FieldSet columns
  const candidates = [
    "fields",
    "columns",
    "fieldNames",
    "columnNames",
    "fieldList",
    "columnList",
    "displayedFields",
    "selectedFields",
    "attributeIDs",
    "attributes",
  ];

  // Direct check
  for (const key of candidates) {
    const val = resource[key];
    if (Array.isArray(val) && val.length > 0 && typeof val[0] === "string") {
      return { key, columns: val };
    }
  }

  // Recursive check one level deep (e.g., resource.fieldSet.fields)
  for (const [topKey, topVal] of Object.entries(resource)) {
    if (topVal && typeof topVal === "object" && !Array.isArray(topVal)) {
      const nested = topVal as Record<string, unknown>;
      for (const key of candidates) {
        const val = nested[key];
        if (
          Array.isArray(val) &&
          val.length > 0 &&
          typeof val[0] === "string"
        ) {
          return { key: `${topKey}.${key}`, columns: val };
        }
      }
    }
  }

  // Fallback: find any string[] property with 5+ elements that looks like field names
  for (const [key, val] of Object.entries(resource)) {
    if (
      Array.isArray(val) &&
      val.length >= 5 &&
      val.every((v) => typeof v === "string") &&
      val.some(
        (v: string) =>
          v === "name" ||
          v === "deviceHostName" ||
          v === "managerReceiptTime" ||
          v === "customerName"
      )
    ) {
      return { key, columns: val };
    }
  }

  return null;
}

/** Set a possibly nested key (e.g. "fieldSet.fields") on an object. */
function setNestedValue(
  obj: Record<string, unknown>,
  keyPath: string,
  value: unknown
): void {
  const parts = keyPath.split(".");
  if (parts.length === 1) {
    obj[parts[0]] = value;
    return;
  }
  let current = obj;
  for (let i = 0; i < parts.length - 1; i++) {
    const part = parts[i];
    if (!current[part] || typeof current[part] !== "object") {
      current[part] = {};
    }
    current = current[part] as Record<string, unknown>;
  }
  current[parts[parts.length - 1]] = value;
}

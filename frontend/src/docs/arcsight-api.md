# ArcSight DETECT API Reference

> **Version:** 1.1.2 | **Swagger:** 2.0 | **Base Path:** `/detect-api/rest`

## Authentication

All endpoints require a Bearer token in the `Authorization` header.

```
Authorization: Bearer <token>
```

Authentication type: `apiKey` (header-based).

## Common Response Codes

| Code | Description |
|------|-------------|
| 200  | Successful operation |
| 204  | Success (no content body) — used for delete, link, command operations |
| 400  | Invalid input / Bad request |
| 401  | Unauthorized — missing or invalid token |
| 403  | Forbidden — insufficient permissions |
| 404  | Resource not found |
| 500  | Internal server error |
| 503  | Temporarily unavailable (events only) |

## Path Versioning

Every endpoint exists at both `/{resource}` and `/v1/{resource}` (identical behavior). This document uses `/v1/` paths exclusively.

---

## Common CRUD Pattern

Most resource types (activelists, cases, connectors, customers, files, filters, groups, queryviewers, rules, sessionlists, users) share these standard endpoints. They are listed here once and **not repeated** in each resource section.

| Method | Path | Description | Parameters | Response |
|--------|------|-------------|------------|----------|
| GET | `/v1/{resource}/allIds` | Get all resource IDs | — | `string[]` |
| GET | `/v1/{resource}/ids` | Get resources by IDs | `ids` (query, array) | `Resource[]` |
| GET | `/v1/{resource}/{id}` | Get resource by ID | `id` (path) | `Resource` |
| GET | `/v1/{resource}/name/{name}` | Find first by name (case-sensitive) | `name` (path) | `Resource` |
| GET | `/v1/{resource}/findAll/{name}` | Find all by name (case-insensitive) | `name` (path) | `Resource[]` |
| GET | `/v1/{resource}/localId/{localId}` | Get by local ID | `localId` (path, integer) | `Resource` |
| DELETE | `/v1/{resource}/localId/{localId}` | Delete by local ID | `localId` (path, integer) | 204 |
| DELETE | `/v1/{resource}/{id}` | Delete by resource ID | `id` (path) | 204 |
| POST | `/v1/{resource}` | Create resource | body: `Create*Request` | `Resource` |
| POST | `/v1/{resource}/update/{id}` | Update resource | `id` (path), body: `*Request` | `Resource` |
| POST | `/v1/{resource}/{id}/copy` | Copy to another group | `id` (path), body: `CopyResourceRequest` | 204 |
| GET | `/v1/{resource}/{id}/allPathsToRoot` | Get all group paths to root | `id` (path) | `string[]` |
| GET | `/v1/{resource}/metaGroupId` | Get meta group ID | — | `ResultObject` |
| GET | `/v1/{resource}/personalGroup` | Get user's personal group | `userId` (query, optional) | `ResultObject` |
| GET | `/v1/{resource}/version` | Get API version | — | `VersionResponse` |

### Notes on Common Endpoints

- **`personalGroup`** returns 404 "Unsupported operation" for connectors, customers, and users
- **`copy`** returns 404 "Unsupported operation" for customers
- **`ids`** accepts comma-separated resource IDs as query parameter: `?ids=id1,id2,id3`
- **`allPathsToRoot`** returns an array of group resource IDs representing the hierarchy path

---

## 1. Connectors

**20 endpoints** (15 common + 5 unique)

Connectors represent SmartConnector agents that collect and forward events to ESM.

### Unique Endpoints

| Method | Path | Description | Parameters | Response |
|--------|------|-------------|------------|----------|
| GET | `/v1/connectors/live` | Get all live connector IDs | — | `string[]` |
| GET | `/v1/connectors/dead` | Get all dead connector IDs | — | `string[]` |
| GET | `/v1/connectors/devices` | Get devices reported by all connectors | — | `Map<string, DeviceDetail[]>` |
| GET | `/v1/connectors/operationalStatus/{type}` | Get connector IDs by operational status | `type` (path): `RUNNING` \| `STOPPED` \| `PAUSED` \| `UNKNOWN` | `string[]` |
| GET | `/v1/connectors/{id}/allCommands` | Get available commands for connector | `id` (path) | `ConnectorCommandAction[]` |
| POST | `/v1/connectors/{id}/command` | Send command to connector | `id` (path), body: command string | 204 |

### Connector Commands

The `/command` endpoint accepts one of:

| Command | Description |
|---------|-------------|
| `START` | Start the connector |
| `STOP` | Stop the connector |
| `PAUSE` | Pause event collection |
| `RESTART` | Restart the connector |
| `CONTINUE` | Resume from pause |
| `TERMINATE` | Terminate the connector process |

### Performance Notes

- **`/connectors/devices`** is the slowest endpoint — returns a global map of all connector IDs to their device details. Our codebase uses a 45-second timeout for this call.
- **`/connectors/live`** and **`/connectors/dead`** are fast, returning only ID arrays.
- **`/connectors/operationalStatus/{type}`** can replace live/dead checks with finer granularity.

### Update Model: `UpdateConnector`

| Field | Type | Description |
|-------|------|-------------|
| `alias` | string | Display alias |
| `description` | string | Description |
| `externalId` | string | External system ID |
| `notificationGroupIds` | string[] | Notification group IDs |

---

## 2. Customers

**15 endpoints** (15 common, 0 unique beyond common pattern)

Customers represent organizational tenants. They include address fields for customer location tracking.

### Create Model: `CreateCustomer`

| Field | Type | Required |
|-------|------|----------|
| `name` | string | Yes |
| `description` | string | No |
| `alias` | string | No |
| `parentId` | string | No |
| `address` | string | No |
| `address2` | string | No |
| `city` | string | No |
| `addressState` | string | No |
| `postalCode` | string | No |
| `country` | string | No |

### Update Model: `CustomerRequest`

Same as `CreateCustomer` minus `parentId`.

### Customer-to-Connector Resolution

There is **no direct API** to get connectors for a customer. The resolution requires a 4-step group hierarchy traversal:

```
Step 1: GET /v1/customers/{id}/allPathsToRoot
         → Returns group IDs in the customer's hierarchy

Step 2: GET /v1/groups/{groupId}/children
         → Returns child resource IDs (mixed types: connectors, other resources)

Step 3: GET /v1/connectors/ids?ids=id1,id2,...
         → Fetch as connectors; non-connector IDs are silently ignored

Step 4: GET /v1/connectors/devices
         → Global device map for enriching connector data
```

Steps 3 and 4 can run in parallel via `Promise.all`.

**Optimization opportunity:** `GET /v1/groups/{groupId}/children/{type}` can filter children by resource type (integer), potentially replacing Steps 2+3. The type integer for connectors needs to be discovered empirically.

---

## 3. Groups

**22 endpoints** (15 common + 7 unique)

Groups organize resources into a tree hierarchy. Every resource type has a group structure.

### Unique Endpoints

| Method | Path | Description | Parameters | Response |
|--------|------|-------------|------------|----------|
| GET | `/v1/groups/{groupId}/children` | Get all children of group | `groupId` (path) | `string[]` |
| POST | `/v1/groups/{groupId}/children` | Link children to group | `groupId` (path), body: `string[]` | 204 |
| POST | `/v1/groups/{groupId}/removeChildren` | Unlink children from group | `groupId` (path), body: `string[]` | 204 |
| GET | `/v1/groups/{groupId}/children/{type}` | Get children by resource type | `groupId` (path), `type` (path, integer) | `string[]` |
| GET | `/v1/groups/{groupId}/children/count` | Get children count | `groupId` (path) | `ResultObject` |
| GET | `/v1/groups/{groupId}/childByNameOrAlias` | Find child by name or alias | `groupId` (path), `name` (query), `alias` (query) | `ResultObject` |
| GET | `/v1/groups/uri` | Get group by URI | `uri` (query) | `Group` |

### Key Notes

- **`children`** returns resource IDs of mixed types (connectors, groups, customers, etc.)
- **`children/{type}`** filters by resource type integer — useful for targeted queries
- **Link/unlink** operations (`POST children`, `POST removeChildren`) accept arrays of resource IDs in the request body
- **`childByNameOrAlias`** requires at least one of `name` or `alias` query parameters

### Create Model: `CreateGroupRequest`

| Field | Type |
|-------|------|
| `name` | string |
| `description` | string |
| `alias` | string |
| `parentId` | string |
| `groupPage` | string |
| `memberPage` | string |

---

## 4. Cases

**24 endpoints** (15 common + 9 unique)

Cases represent security incidents tracked through a lifecycle (QUEUED → INITIAL → FOLLOW_UP → FINAL → CLOSED).

### Unique Endpoints

| Method | Path | Description | Parameters | Response |
|--------|------|-------------|------------|----------|
| GET | `/v1/cases/open` | Get open cases for user(s) | `userIds` (query, required) | `OpenCases` |
| GET | `/v1/cases/severities` | Get supported severity levels | `locale` (query, optional) | `Severity[]` |
| GET | `/v1/cases/count` | Aggregate case counts | `startTime`, `endTime`, `timeZone` (required), `aggGranularity`, `stage`, `state`, `severity`, `assignee`, `aggBy` (optional) | `CaseAggregateData` |
| GET | `/v1/cases/closureStats` | Case closure statistics by group/user | `startTime`, `endTime` (required), `groupIds`, `numGroupResults`, `numUserResults`, `metricType`, `sla` (optional) | `ClosureStatsResponse` |
| GET | `/v1/cases/closureVelocity` | SOC-wide closure velocity | `startTime`, `endTime` (required) | `ClosureVelocityResponse` |
| GET | `/v1/cases/stageTransitions` | Duration between stage transitions | `startTime`, `endTime` (required), `severity`, `assignee` (optional) | `StageTransitionsResponse` |
| GET | `/v1/cases/{id}/eventIds` | Get event IDs linked to case | `id` (path) | `integer[]` |
| POST | `/v1/cases/{id}/eventIds` | Add event IDs to case | `id` (path), body: `integer[]` | 204 |
| GET | `/v1/cases/personalAndSharedResourceRoots` | Get personal/shared resource roots | `resourceId`, `relationshipType` (query) | `string[]` |

### Case Stages

```
QUEUED → INITIAL → FOLLOW_UP → FINAL → CLOSED
```

### Create Model: `CreateCaseRequest`

| Field | Type | Values |
|-------|------|--------|
| `name` | string | — |
| `description` | string | — |
| `alias` | string | — |
| `externalID` | string | — |
| `parentId` | string | — |
| `ticketType` | enum | `INTERNAL`, `CLIENT`, `INCIDENT` |
| `stage` | enum | `QUEUED`, `INITIAL`, `FOLLOW_UP`, `FINAL`, `CLOSED` |
| `consequenceSeverity` | enum | `NONE`, `INSIGNIFICANT`, `MARGINAL`, `CRITICAL`, `CATASTROPHIC` |
| `operationalImpact` | enum | `NO_IMPACT`, `NO_IMMEDIATE_IMPACT`, `LOW_PRIORITY_IMPACT`, `HIGH_PRIORITY_IMPACT`, `IMMEDIATE_IMPACT` |
| `frequency` | enum | `NEVER_OR_ONCE`, `LESS_THAN_TEN`, `TEN_TO_FIFTEEN`, `FIFTEEN`, `MORE_THAN_FIFTEEN` |
| `securityClassification` | enum | `UNCLASSIFIED`, `CONFIDENTIAL`, `SECRET`, `TOP_SECRET` |
| `estimatedRestoreTime` | integer | Epoch millis |

---

## 5. Events

**4 endpoints** (no common CRUD — events are a special resource type)

Events represent security events ingested by ESM from connectors.

### Endpoints

| Method | Path | Description | Parameters | Response |
|--------|------|-------------|------------|----------|
| POST | `/v1/events/retrieve` | Retrieve events by IDs and time range | body: `SecurityEventsRequest` | `SecurityEvent[]` |
| GET | `/v1/events/count` | Count events in time range | `startTime`, `endTime` (query, integer, epoch millis) | `countResponse` |
| POST | `/v1/events/annotationStage` | Change event annotation stage | body: `SecurityEventsAnnotationStageRequest` | 204 |
| GET | `/v1/events/getEventFieldInfoMap` | Get full list of event fields | — | `Map<string, FieldType>` |

### SecurityEventsRequest

| Field | Type | Description |
|-------|------|-------------|
| `ids` | integer[] | Event IDs to retrieve |
| `startTime` | integer | Start time (epoch millis) |
| `endTime` | integer | End time (epoch millis) |

### SecurityEventsAnnotationStageRequest

| Field | Type | Description |
|-------|------|-------------|
| `eventId` | integer | Target event ID |
| `stageId` | string | New stage ID |
| `userId` | string | User performing the change |
| `comment` | string | Annotation comment |

### countResponse

| Field | Type |
|-------|------|
| `count` | integer |
| `correlationEventCount` | integer |
| `eventCount` | integer |
| `startTime` | integer |

---

## 6. Rules

**20 endpoints** (15 common + 5 unique)

Rules define real-time correlation logic in ESM.

### Unique Endpoints

| Method | Path | Description | Parameters | Response |
|--------|------|-------------|------------|----------|
| POST | `/v1/rules/deploy` | Deploy rule to Real-Time | body: `Rule` | 204 |
| POST | `/v1/rules/undeploy` | Undeploy rule from Real-Time | body: `Rule` | 204 |
| POST | `/v1/rules/deployRuleGroup` | Deploy rule group to Real-Time | body: group object | 204 |
| POST | `/v1/rules/undeployRuleGroup` | Undeploy rule group from Real-Time | body: group object | 204 |
| GET | `/v1/rules/getRealTimeRulesFolder` | Get Real-Time rules folder | — | `Group` |

### Create Model: `CreateRuleRequest`

| Field | Type | Values |
|-------|------|--------|
| `name` | string | — |
| `description` | string | — |
| `alias` | string | — |
| `parentId` | string | — |
| `inRealTime` | boolean | — |
| `ruleType` | enum | `Standard`, `Lightweight`, `Prepersist` |
| `ruleState` | enum | `RULE_STATE_ACTIVE_BY_USER`, `RULE_STATE_INACTIVE_BY_USER`, `RULE_STATE_ACTIVE`, `RULE_STATE_INACTIVE`, `RULE_STATE_INACTIVE_NOT_REACTIVATED` |
| `ruleCondition` | RuleCondition | Condition tree |
| `aggregation` | Aggregation | Aggregation config |
| `actions` | object | Action definitions |

---

## 7. Active Lists

**19 endpoints** (15 common + 4 unique)

Active Lists are in-memory key-value stores used by rules for stateful correlation.

### Unique Endpoints

| Method | Path | Description | Parameters | Response |
|--------|------|-------------|------------|----------|
| GET | `/v1/activelists/{id}/entries` | Get all entries | `id` (path) | `ActiveListEntryList` |
| POST | `/v1/activelists/{id}/entries` | Add entries | `id` (path), body: `ActiveListEntryList` | 204 |
| POST | `/v1/activelists/{id}/deleteEntries` | Delete specific entries | `id` (path), body: `ActiveListEntryList` | 204 |
| DELETE | `/v1/activelists/{id}/entries` | Clear all entries | `id` (path) | 204 |

### ActiveListEntryList

| Field | Type | Description |
|-------|------|-------------|
| `fields` | string[] | Field names (column headers) |
| `entries` | ActiveListEntry[] | Entry rows |

### Create Model: `CreateActiveList`

| Field | Type | Values |
|-------|------|--------|
| `name` | string | — |
| `description` | string | — |
| `alias` | string | — |
| `groupId` | string | Parent group |
| `activeListType` | enum | `EVENT_BASED`, `FIELD_BASED` |
| `cacheModel` | enum | `READ_OPTIMIZED`, `WRITE_SYNCHRONIZED`, `UNCHANGED` |
| `caseSensitiveType` | enum | `CASE_SENSITIVE`, `KEY_CASE_INSENSITIVE`, `KEY_AND_VALUE_INSENSITIVE` |
| `capacity` | integer | Max entries |
| `countLimit` | integer | Count limit |
| `entryTimeToLive` | integer | TTL in seconds |
| `fields` | DataListEntryField[] | Field definitions |
| `multiMap` | boolean | Allow duplicate keys |
| `partialCache` | boolean | Partial caching |
| `timePartitioned` | boolean | Time-based partitioning |

---

## 8. Session Lists

**19 endpoints** (15 common + 4 unique)

Session Lists are time-bounded lists used for session correlation. Entries have start/end times.

### Unique Endpoints

| Method | Path | Description | Parameters | Response |
|--------|------|-------------|------------|----------|
| GET | `/v1/sessionlists/{id}/entries` | Get all entries | `id` (path) | `SessionListEntryList` |
| POST | `/v1/sessionlists/{id}/entries` | Add entries | `id` (path), body: `SessionListEntryList` | 204 |
| POST | `/v1/sessionlists/{id}/deleteEntries` | Delete specific entries | `id` (path), body: `SessionListEntryList` | 204 |
| DELETE | `/v1/sessionlists/{id}/entries` | Clear all entries | `id` (path) | 204 |

### SessionListEntryList

| Field | Type | Description |
|-------|------|-------------|
| `fields` | string[] | Field names |
| `entries` | SessionListEntry[] | Entry rows with time bounds |

### SessionListEntry

| Field | Type |
|-------|------|
| `fields` | string[] |
| `startTime` | string |
| `endTime` | string |
| `creationTime` | string |

### Create Model: `CreateSessionList`

| Field | Type |
|-------|------|
| `name` | string |
| `description` | string |
| `alias` | string |
| `groupId` | string |
| `caseSensitiveType` | enum: `CASE_SENSITIVE`, `KEY_CASE_INSENSITIVE`, `KEY_AND_VALUE_INSENSITIVE` |
| `entryExpirationTime` | integer |
| `expiredEntryTTLDays` | integer |
| `inMemoryCapacity` | integer |
| `maxWaitTime` | integer |
| `minWaitTime` | integer |
| `fields` | DataListEntryField[] |
| `overlap` | boolean |

---

## 9. Query Viewers

**17 endpoints** (15 common + 2 unique)

Query Viewers execute and display query results as matrix data.

### Unique Endpoints

| Method | Path | Description | Parameters | Response |
|--------|------|-------------|------------|----------|
| GET | `/v1/queryviewers/matrixData/{id}` | Get matrix data for query viewer | `id` (path) | `MatrixData` |
| POST | `/v1/queryviewers/matrixDataForDrilldown` | Get drilldown matrix data | body: `MatrixDataForDrilldownRequest` | `MatrixData` |

### MatrixData

| Field | Type | Description |
|-------|------|-------------|
| `columnHeaders` | string[] | Column names |
| `rows` | object[] | Data rows |
| `startTimestamp` | integer | Query start time |
| `endTimestamp` | integer | Query end time |
| `colHeaderTS` | integer | Column header timestamp |
| `maxColumns` | integer | Max column count |
| `timestamp` | integer | Data timestamp |
| `properties` | object | Additional properties |

### MatrixDataForDrilldownRequest

| Field | Type |
|-------|------|
| `drilldownSourceId` | string |
| `drilldownId` | string |
| `fieldValueList` | MapEntry[] |

---

## 10. Filters

**15 endpoints** (15 common, 0 unique)

Filters define conditions for event filtering used by rules, query viewers, and other resources.

### Create Model: `CreateFilterRequest`

| Field | Type |
|-------|------|
| `name` | string |
| `description` | string |
| `alias` | string |
| `parentId` | string |
| `condition` | Condition |

### Condition Types

The `Condition` model has several subtypes:

| Type | Description |
|------|-------------|
| `AndCondition` | Logical AND of child conditions |
| `OrCondition` | Logical OR of child conditions |
| `NotCondition` | Logical NOT of child condition |
| `BasicCondition` | Base comparison condition |
| `EventBasicCondition` | Event field comparison (6 props: `fieldName`, `operator`, `value`, `negated`, etc.) |
| `InActiveListCondition` | Check if value exists in active list |
| `MatchFilterCondition` | Match against another filter |
| `ConstantCondition` | Always true/false |
| `AliasCondition` | Reference to named condition (6 props) |
| `AssetsCondition` | Asset-based condition |
| `JoinCondition` | Join between two conditions (2 props: `left`, `right`) |

---

## 11. Files

**15 endpoints** (14 common + 1 unique)

File resources represent files stored in ESM.

### Unique Endpoints

| Method | Path | Description | Parameters | Response |
|--------|------|-------------|------------|----------|
| GET | `/v1/files/{id}/download` | Get download ticket | `id` (path) | `ResultObject` |

### Download Flow

1. Call `GET /v1/files/{id}/download` to get a download ticket
2. Use the ticket to download: `GET https://host:port/detect-api/fileservlet?file.command=download&file.id={ticket}`

---

## 12. Users

**18 endpoints** (15 common + 3 unique)

Users represent ESM user accounts.

### Unique Endpoints

| Method | Path | Description | Parameters | Response |
|--------|------|-------------|------------|----------|
| GET | `/v1/users` | Get all user resources | — | `User[]` |
| POST | `/v1/users/changePassword` | Change user password | body: `ChangePasswordRequest` (required) | 204 |
| GET | `/v1/users/ownergroups` | Get current user's groups | — | `Group[]` |

### ChangePasswordRequest

| Field | Type |
|-------|------|
| `resourceId` | string |
| `oldPassword` | string |
| `newPassword` | string |

### Create Model: `CreateUserRequest`

| Field | Type | Values |
|-------|------|--------|
| `name` | string | Username |
| `password` | string | — |
| `firstName` | string | — |
| `lastName` | string | — |
| `email` | string | — |
| `phone` | string | — |
| `fax` | string | — |
| `pager` | string | — |
| `title` | string | — |
| `department` | string | — |
| `externalId` | string | — |
| `parentId` | string | — |
| `loginEnabled` | boolean | — |
| `userType` | enum | `Normal_User`, `Management_Tool`, `Forwarding_Connector`, `Archive_Utility`, `Connector_Installer`, `Web_User` |

---

## 13. License

**14 endpoints** (all unique — no common CRUD pattern)

License endpoints provide ESM licensing and version information.

### Endpoints

| Method | Path | Description | Response |
|--------|------|-------------|----------|
| GET | `/v1/license/esmVersion` | ESM software version | `ResultObject` |
| GET | `/v1/license/info` | Full license information | `ResultObject` |
| GET | `/v1/license/valid` | Is license valid? | `boolean` |
| GET | `/v1/license/expires` | Does license expire? | `boolean` |
| GET | `/v1/license/trial` | Is trial license? | `boolean` |
| GET | `/v1/license/errors` | Has license errors? | `boolean` |
| GET | `/v1/license/errorMessage` | License error messages | `ResultObject` |
| GET | `/v1/license/expirationDate` | License expiration date | `ResultObject` |
| GET | `/v1/license/activationDateMillis` | Activation date (epoch millis) | `ResultObject` |
| GET | `/v1/license/customerName` | Licensed customer name | `ResultObject` |
| GET | `/v1/license/customerNumber` | Licensed customer number | `ResultObject` |
| GET | `/v1/license/property` | Get property value by key | `ResultObject` |
| GET | `/v1/license/serviceMajorVersion` | Service major version | `integer` |
| GET | `/v1/license/serviceMinorVersion` | Service minor version | `integer` |

The `property` endpoint accepts `key` as an optional query parameter.

---

## 14. Resources

**7 endpoints** (all unique — cross-resource utility operations)

### Endpoints

| Method | Path | Description | Parameters | Response |
|--------|------|-------------|------------|----------|
| GET | `/v1/resources/ESMVersion` | Get ESM version | — | `ResultObject` |
| GET | `/v1/resources/namesAndAliases` | Get names/aliases for resource IDs | `ids` (query, array, required) | `string[]` |
| GET | `/v1/resources/visibleResourceTypes` | Get resource types visible to current user | — | `string[]` |
| GET | `/v1/resources/{id}/valid` | Is resource ID valid? | `id` (path) | `ResultObject` |
| GET | `/v1/resources/{id}/readPermission` | Check read permission | `id` (path), `targetId` (query) | `ResultObject` |
| GET | `/v1/resources/{id}/writePermission` | Check write permission | `id` (path), `targetId` (query) | `ResultObject` |
| GET | `/v1/resources/{id}/executePermission` | Check execute permission | `id` (path), `targetId` (query) | `ResultObject` |

### Permission Check Pattern

```
Does user {id} have {read|write|execute} permission on resource {targetId}?

GET /v1/resources/{userId}/readPermission?targetId={resourceId}
→ ResultObject with boolean result
```

---

## Data Models

### Connector (41 properties)

| Property | Type | Description |
|----------|------|-------------|
| `resourceId` | string | Unique resource identifier |
| `name` | string | Connector name |
| `displayName` | string | Display name |
| `alias` | string | Alias |
| `description` | string | Description |
| `operationalStatus` | string | RUNNING, STOPPED, PAUSED, UNKNOWN |
| `alive` | boolean | Whether connector is alive |
| `disabled` | boolean | Whether connector is disabled |
| `disabledReason` | string | Reason for disabling |
| `inactive` | boolean | Whether connector is inactive |
| `inactiveReason` | string | Reason for inactivity |
| `agentConfig` | ConnectorConfig | Agent configuration |
| `networks` | Network[] | Associated networks |
| `linkedUser` | User | Linked user account |
| `owningServer` | string | Owning ESM server |
| `codeVersion` | string | Connector code version |
| `configVersion` | string | Config version |
| `configDefinition` | string | Config definition |
| `subType` | enum | `FieldSet_NonSortable`, `FieldSet_Sortable` |
| `type` | integer | Resource type integer |
| `typeName` | string | Resource type name |
| `uri` | string | Resource URI |
| `localID` | integer | Local integer ID |
| `externalID` | string | External system ID |
| `state` | integer | Resource state |
| `reference` | ResourceReference | Resource reference |
| `signature` | ResourceSignature | Resource signature |
| `createdTimestamp` | integer | Creation time (epoch) |
| `modifiedTimestamp` | integer | Last modification time (epoch) |
| `creatorName` | string | Creator username |
| `modifierName` | string | Last modifier username |
| `contentVersionID` | string | Content version |
| `versionID` | string | Version ID |
| `modificationCount` | integer | Modification counter |
| `notificationGroupIDs` | string[] | Notification group IDs |
| `referencePage` | string | Reference page |
| `deprecated` | boolean | Is deprecated |
| `initialized` | boolean | Is initialized |
| `inCache` | boolean | Is in cache |
| `isAdditionalLoaded` | boolean | Additional data loaded |
| `attributeInitializationInProgress` | boolean | Attribute init in progress |

### ConnectorConfig (24 properties)

| Property | Type | Description |
|----------|------|-------------|
| `connectorId` | string | Connector resource ID |
| `connectorName` | string | Connector name |
| `connectorType` | string | Connector type |
| `connectorVersion` | string | Connector version |
| `connectorLocation` | string | Location |
| `deviceLocation` | string | Device location |
| `transportMode` | string | Transport mode |
| `heartbeatFreq` | integer | Heartbeat frequency |
| `lastModified` | integer | Last modified time |
| `lastStatus` | integer | Last status code |
| `modifiedBy` | string | Modified by user |
| `currentConfig` | integer | Current config index |
| `default` | boolean | Is default config |
| `parent` | boolean | Is parent config |
| `explicitUTF8` | boolean | Explicit UTF-8 encoding |
| `password` | string | Connection password |
| `version` | string | Config version |
| `comment` | string | Config comment |
| `defaultConnectorConfig` | ConnectorConfig | Default config reference |
| `parentConfig` | ConnectorConfig | Parent config reference |
| `alternateConnectorConfig` | ConnectorConfig[] | Alternate configs |
| `commandGroups` | ConnectorCommandGroup[] | Available command groups |
| `timeInterval` | ConfigTimeInterval | Time interval config |
| `getvPreprocessors` | EventPreprocessor[] | Event preprocessors |

### Customer (38 properties)

| Property | Type | Description |
|----------|------|-------------|
| `resourceId` | string | Unique resource identifier |
| `name` | string | Customer name |
| `displayName` | string | Display name |
| `alias` | string | Alias |
| `description` | string | Description |
| `address` | string | Street address line 1 |
| `address2` | string | Street address line 2 |
| `city` | string | City |
| `addressState` | string | State/province |
| `postalCode` | string | Postal/ZIP code |
| `country` | string | Country |
| `disabled` | boolean | Whether disabled |
| `inactive` | boolean | Whether inactive |
| `type` | integer | Resource type integer |
| `localID` | integer | Local integer ID |
| `externalID` | string | External system ID |
| `uri` | string | Resource URI |
| *(+ common resource fields)* | | Same as Connector common fields |

### Case (87 properties)

Key properties (full model has 87 fields):

| Property | Type | Description |
|----------|------|-------------|
| `resourceId` | string | Unique ID |
| `name` | string | Case name |
| `displayID` | integer | Human-readable case number |
| `description` | string | Description |
| `stage` | enum | `QUEUED`, `INITIAL`, `FOLLOW_UP`, `FINAL`, `CLOSED` |
| `ticketType` | enum | `INTERNAL`, `CLIENT`, `INCIDENT` |
| `consequenceSeverity` | enum | `NONE`, `INSIGNIFICANT`, `MARGINAL`, `CRITICAL`, `CATASTROPHIC` |
| `operationalImpact` | enum | `NO_IMPACT`, `NO_IMMEDIATE_IMPACT`, `LOW_PRIORITY_IMPACT`, `HIGH_PRIORITY_IMPACT`, `IMMEDIATE_IMPACT` |
| `securityClassification` | enum | `UNCLASSIFIED`, `CONFIDENTIAL`, `SECRET`, `TOP_SECRET` |
| `frequency` | enum | `NEVER_OR_ONCE`, `LESS_THAN_TEN`, `TEN_TO_FIFTEEN`, `FIFTEEN`, `MORE_THAN_FIFTEEN` |
| `action` | enum | `BLOCK_OR_SHUTDOWN`, `MONITORING`, `OTHER` |
| **Attack Details** | | |
| `attackAgent` | enum | `INSIDER`, `COLLABORATIVE`, `OUTSIDER`, `UNKNOWN` |
| `attackMechanism` | enum | `PHYSICAL`, `OPERATIONAL`, `INFORMATIONAL`, `UNKNOWN` |
| `attackAddress` | string | Attack source address |
| `attackNode` | string | Attack node |
| `attackOS` | string | Attack OS |
| `attackProtocol` | string | Attack protocol |
| `attackService` | string | Attack service |
| `attackTarget` | string | Attack target |
| `attackTime` | ServiceDate | Attack time |
| **Vulnerability** | | |
| `vulnerability` | enum | `DESIGN`, `OPERATIONAL`, `ENVIRONMENT`, `UNKNOWN` |
| `vulnerabilityType1` | enum | `ACCIDENTAL`, `INTENTIONAL` |
| `vulnerabilityType2` | enum | `EMI_RFI`, `INSERTION_OF_DATA`, `THEFT_OF_SERVICE`, `UNAUTHORIZED`, `PROBES`, `ROOT_COMPROMISE`, `DOS_ATTACK`, `USER_ACCOUNT` |
| `vulnerabilityData` | string | Vulnerability details |
| `vulnerabilityEvidence` | string | Evidence |
| `vulnerabilitySource` | string | Source |
| **Event Links** | | |
| `eventIDs` | integer[] | Associated event IDs |
| `attachmentIDs` | string[] | Attachment resource IDs |
| **Timestamps** | | |
| `detectionTime` | ServiceDate | When detected |
| `estimatedStartTime` | ServiceDate | Estimated start |
| `estimatedRestoreTime` | ServiceDate | Estimated restore |
| `lastOccurenceTime` | ServiceDate | Last occurrence |

### SecurityEvent (175 properties)

Key properties (full model has 175 fields, including 80+ domain-specific extension fields):

| Property | Type | Description |
|----------|------|-------------|
| `eventId` | integer | Unique event ID |
| `name` | string | Event name |
| `message` | string | Event message |
| `severity` | integer | Severity level |
| `priority` | integer | Priority level |
| **Type & Classification** | | |
| `type` | enum | `BASE`, `AGGREGATED`, `CORRELATION`, `ACTION`, `UNKOWN` |
| `deviceEventClassId` | string | Device event class ID |
| `deviceEventCategory` | string | Device event category |
| `deviceAction` | string | Device action taken |
| `eventOutcome` | string | Event outcome |
| `applicationProtocol` | string | Application protocol |
| `transportProtocol` | string | Transport protocol |
| **Source & Destination** | | |
| `source` | EndPointDescriptor | Source endpoint (23 props: address, hostName, port, user, etc.) |
| `destination` | EndPointDescriptor | Destination endpoint |
| **Device** | | |
| `device` | DeviceDescriptor | Reporting device (24 props) |
| `finalDevice` | DeviceDescriptor | Final device in chain |
| `agent` | AgentDescriptor | Reporting agent (20 props) |
| `originalAgent` | AgentDescriptor | Original agent |
| **Timing** | | |
| `startTime` | integer | Event start (epoch millis) |
| `endTime` | integer | Event end (epoch millis) |
| `deviceReceiptTime` | integer | Device receipt time |
| `agentReceiptTime` | integer | Agent receipt time |
| `managerReceiptTime` | integer | Manager receipt time |
| **Aggregation** | | |
| `aggregatedEventCount` | integer | Aggregated event count |
| `baseEventCount` | integer | Base event count |
| `correlatedEventCount` | integer | Correlated event count |
| `baseEventIds` | integer[] | Base event IDs |
| **Annotation** | | |
| `eventAnnotation` | EventAnnotation | Annotation details (stage, comment, audit trail) |
| **Data** | | |
| `bytesIn` | integer | Bytes received |
| `bytesOut` | integer | Bytes sent |
| `rawEvent` | string | Raw event string |
| `file` | FileDescriptor | File details (9 props) |
| `customer` | ResourceReference | Customer reference |
| **Custom Fields** | | |
| `deviceCustomString1-6` | string | Device custom strings |
| `deviceCustomNumber1-3` | integer | Device custom numbers |
| `deviceCustomFloatingPoint1-4` | number | Device custom floats |
| `deviceCustomDate1-2` | integer | Device custom dates |
| `deviceCustomIPv6Address1-4` | string[] | Device custom IPv6 |
| `flexString1-2` | string | Flex strings (with labels) |
| `flexNumber1-2` | integer | Flex numbers (with labels) |
| `flexDate1` | integer | Flex date (with label) |
| **Domain Fields** | | |
| `domainString1-34` | string | Domain extension strings |
| `domainNumber1-13` | integer | Domain extension numbers |
| `domainDate1-6` | integer | Domain extension dates |
| `domainFp1-8` | number | Domain extension floats |
| `domainIpv4addr1-4` | integer | Domain IPv4 addresses |
| `domainIpv6addr1-4` | string[] | Domain IPv6 addresses |
| `domainBlob1-4` | string[] | Domain blobs |
| `domainClob1-4` | string[] | Domain CLOBs |
| `domainResourceRef1-4` | ResourceReference | Domain resource references |

### Group (37 properties)

| Property | Type | Description |
|----------|------|-------------|
| `resourceId` | string | Unique ID |
| `name` | string | Group name |
| `displayName` | string | Display name |
| `description` | string | Description |
| `containedResourceType` | integer | Type of resources this group contains |
| `subGroupCount` | integer | Number of sub-groups |
| `virtual` | boolean | Whether group is virtual |
| `memberReferencePage` | string | Member reference page |
| `attributeIDs` | integer[] | Attribute IDs |
| *(+ common resource fields)* | | Same as Connector common fields |

### DeviceDetail (3 properties)

| Property | Type |
|----------|------|
| `deviceVendor` | string |
| `deviceProduct` | string |
| `deviceVersion` | string |

### DeviceDescriptor (24 properties)

| Property | Type | Description |
|----------|------|-------------|
| `address` | integer | IP address (integer form) |
| `addressAsBytes` | string[] | IP as byte array |
| `hostName` | string | Hostname |
| `dnsDomain` | string | DNS domain |
| `ntDomain` | string | NT domain |
| `macAddress` | integer | MAC address |
| `product` | string | Device product |
| `vendor` | string | Device vendor |
| `version` | string | Device version |
| `facility` | string | Syslog facility |
| `processName` | string | Process name |
| `externalId` | string | External ID |
| `assetId` | string | Asset ID |
| `assetLocalId` | integer | Asset local ID |
| `assetName` | string | Asset name |
| `inboundInterface` | string | Inbound interface |
| `outboundInterface` | string | Outbound interface |
| `timeZone` | string | Device timezone |
| `zone` | ResourceReference | Zone reference |
| `translatedAddress` | integer | NAT translated address |
| `translatedAddressAsBytes` | string[] | NAT translated as bytes |
| `translatedZone` | ResourceReference | Translated zone |
| `descriptorId` | integer | Descriptor ID |
| `mutable` | boolean | Is mutable |

### EndPointDescriptor (23 properties)

Used for source and destination in SecurityEvent:

| Property | Type | Description |
|----------|------|-------------|
| `address` | integer | IP address |
| `hostName` | string | Hostname |
| `port` | integer | Port number |
| `userId` | string | User ID |
| `userName` | string | Username |
| `userPrivileges` | string | User privileges |
| `processName` | string | Process name |
| `processId` | integer | Process ID |
| `dnsDomain` | string | DNS domain |
| `ntDomain` | string | NT domain |
| `macAddress` | integer | MAC address |
| `translatedAddress` | integer | NAT address |
| `translatedPort` | integer | NAT port |
| `zone` | ResourceReference | Zone |
| `translatedZone` | ResourceReference | NAT zone |
| `geo` | GeoDescriptor | Geolocation (latitude, longitude, country, etc.) |
| *(+ asset fields, descriptor fields)* | | |

### EventAnnotation (13 properties)

| Property | Type | Description |
|----------|------|-------------|
| `eventId` | integer | Event ID |
| `stage` | ResourceReference | Current stage |
| `stageEventId` | integer | Stage event ID |
| `stageUpdateTime` | integer | Stage update timestamp |
| `stageUser` | ResourceReference | User who set stage |
| `comment` | string | Annotation comment |
| `auditTrail` | string | Full audit trail |
| `flags` | integer | Annotation flags |
| `version` | integer | Annotation version |
| `modificationTime` | integer | Last modification time |
| `modifiedBy` | ResourceReference | Modified by user |
| `endTime` | integer | End time |
| `managerReceiptTime` | integer | Manager receipt time |

### ConnectorCommandAction (7 properties)

| Property | Type | Description |
|----------|------|-------------|
| `cmdName` | string | Command name (START, STOP, etc.) |
| `displayName` | string | Display name |
| `cmdGroupName` | string | Command group name |
| `cmdGroupDisplayName` | string | Command group display name |
| `parameterRequired` | boolean | Whether parameters are needed |
| `parameterDescriptorList` | ParameterDescriptor[] | Parameter definitions |
| `marshalledValues` | string | Marshalled parameter values |

### Supporting Models

#### ResourceReference (9 properties)

| Property | Type |
|----------|------|
| `id` | string |
| `externalID` | string |
| `isModifiable` | boolean |
| `managerID` | string |
| `referenceID` | integer |
| `referenceString` | string |
| `referenceType` | integer |
| `type` | integer |
| `uri` | string |

#### CopyResourceRequest (3 properties)

| Property | Type | Description |
|----------|------|-------------|
| `parentId` | string | Source group ID |
| `newParentId` | string | Destination group ID |
| `newName` | string | New resource name |

#### ClosureStatsResponse

| Property | Type |
|----------|------|
| `startTime` | integer |
| `endTime` | integer |
| `groupCaseStats` | GroupCaseClosureStats[] |

#### ClosureVelocityResponse

| Property | Type | Description |
|----------|------|-------------|
| `startTime` | integer | Period start |
| `endTime` | integer | Period end |
| `averageTimeToCloseAfterCreation` | integer | Avg time from creation to close |
| `averageTimeToCloseAfterLastAnnotation` | integer | Avg time from last annotation to close |
| `closedCasesTrend` | number | Trend direction |

#### StageTransition

| Property | Type |
|----------|------|
| `from` | string |
| `to` | string |
| `numberOfCases` | integer |
| `timeTaken` | integer |

#### OpenCases

| Property | Type |
|----------|------|
| `userId` | string |
| `assignedCases` | AssignedCase[] |

#### AssignedCase (7 properties)

| Property | Type |
|----------|------|
| `caseId` | string |
| `displayId` | integer |
| `name` | string |
| `stage` | string |
| `consequenceSeverity` | string |
| `operationalImpact` | string |
| `ticketType` | string |

#### Severity

| Property | Type |
|----------|------|
| `level` | string |
| `name` | string |

#### VersionResponse

| Property | Type |
|----------|------|
| `return` | string |

#### ResultObject

| Property | Type |
|----------|------|
| `return` | object |

Generic wrapper — the `return` field contains the actual value (string, boolean, integer, or object depending on the endpoint).

---

## Integration Patterns

### 1. Customer-to-Connector Resolution (4-Step Bridge)

Used in our codebase at `src/lib/arcsight-client.ts`:

```typescript
// Step 1: Get group hierarchy
const groupIds = await fetch('/v1/customers/{id}/allPathsToRoot');

// Step 2: Get children from each group (mixed types)
const childIds = await Promise.all(
  groupIds.map(gid => fetch(`/v1/groups/${gid}/children`))
);

// Step 3 & 4: Fetch connectors and devices in parallel
const [connectors, deviceMap] = await Promise.all([
  fetch(`/v1/connectors/ids?ids=${flatChildIds.join(',')}`),
  fetch('/v1/connectors/devices')  // 45s timeout
]);
```

**Optimization:** Use `GET /v1/groups/{groupId}/children/{type}` to filter by connector resource type, potentially eliminating the need for Step 3's silent-failure approach.

### 2. Connector Command Execution

```
1. GET  /v1/connectors/{id}/allCommands  → list available commands
2. POST /v1/connectors/{id}/command      → send command (START/STOP/PAUSE/RESTART/CONTINUE/TERMINATE)
3. GET  /v1/connectors/{id}              → verify new operationalStatus
```

### 3. Event Retrieval with Time Ranges

```
POST /v1/events/retrieve
Body: {
  "ids": [eventId1, eventId2, ...],
  "startTime": 1700000000000,  // epoch millis
  "endTime":   1700086400000
}
```

For counting without retrieving: `GET /v1/events/count?startTime=...&endTime=...`

### 4. Case Management Lifecycle

```
1. POST /v1/cases                        → Create case (stage: QUEUED)
2. POST /v1/cases/update/{id}            → Update stage: INITIAL → FOLLOW_UP → FINAL
3. POST /v1/cases/{id}/eventIds          → Link events to case
4. GET  /v1/cases/closureStats           → Monitor team performance
5. GET  /v1/cases/stageTransitions       → Analyze stage durations
6. POST /v1/cases/update/{id}            → Close case (stage: CLOSED)
```

### 5. Rule Deployment

```
1. POST /v1/rules                        → Create rule
2. POST /v1/rules/deploy                 → Deploy to Real-Time engine
3. GET  /v1/rules/getRealTimeRulesFolder → Verify deployment location
4. POST /v1/rules/undeploy               → Remove from Real-Time
```

### 6. Active List Management

```
1. POST /v1/activelists                  → Create active list with field definitions
2. POST /v1/activelists/{id}/entries     → Populate entries
3. GET  /v1/activelists/{id}/entries     → Read entries
4. POST /v1/activelists/{id}/deleteEntries → Remove specific entries
5. DELETE /v1/activelists/{id}/entries   → Clear all entries
```

---

## Endpoint Summary

| Category | Total Endpoints | Common CRUD | Unique |
|----------|----------------|-------------|--------|
| Connectors | 20 | 15 | 5 (live/dead, devices, operationalStatus, allCommands, command) |
| Customers | 15 | 15 | 0 |
| Groups | 22 | 15 | 7 (children CRUD, children/{type}, childByNameOrAlias, uri) |
| Cases | 24 | 15 | 9 (open, severities, count, closureStats, closureVelocity, stageTransitions, eventIds R/W, roots) |
| Events | 4 | 0 | 4 (retrieve, count, annotationStage, getEventFieldInfoMap) |
| Rules | 20 | 15 | 5 (deploy, undeploy, deployRuleGroup, undeployRuleGroup, getRealTimeRulesFolder) |
| Active Lists | 19 | 15 | 4 (entries CRUD) |
| Session Lists | 19 | 15 | 4 (entries CRUD) |
| Query Viewers | 17 | 15 | 2 (matrixData, matrixDataForDrilldown) |
| Filters | 15 | 15 | 0 |
| Files | 15 | 14 | 1 (download) |
| Users | 18 | 15 | 3 (list all, changePassword, ownergroups) |
| License | 14 | 0 | 14 (all unique) |
| Resources | 7 | 0 | 7 (all unique) |
| **Total** | **229** | **179** | **50** |
